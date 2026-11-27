"""Train the linear head on frozen DINOv2 features.

1. Extract features for train (each photo plus its mirror image) and val,
   using the same preprocessing as the browser. Cached in checkpoints/.
2. Fit a linear layer for a few weight-decay values; keep the one with the
   best val accuracy.
3. Fit a temperature on val (lowest negative log-likelihood); export.py
   folds it into the head so Confidences are calibrated.
4. Store each species' centroid of standardised train features, for the
   Not-a-bird-I-know distance check (checkpoints/centroids.pt).

The test split is never read here.

Usage: python train.py [--cub PATH]
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import DataLoader, Dataset

import cub
from model import FEATURES, SPECIES, build_backbone, features
from preprocess import SIZE, load_eval

ROOT = Path(__file__).resolve().parent
CHECKPOINTS = ROOT / "checkpoints"
WEIGHT_DECAYS = [1e-3, 1e-2, 5e-2, 0.1, 0.2, 0.5]
EPOCHS = 60


class Photos(Dataset):
    def __init__(self, items: list[cub.Photo]):
        self.items = items

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, i):
        return load_eval(self.items[i].path), self.items[i].species


@torch.no_grad()
def extract(backbone: nn.Module, items: list[cub.Photo], mirror: bool) -> tuple[torch.Tensor, torch.Tensor]:
    feats, labels = [], []
    loader = DataLoader(Photos(items), batch_size=32, num_workers=3)
    start = time.time()
    for n, (x, y) in enumerate(loader, 1):
        feats.append(features(backbone, x))
        labels.append(y)
        if mirror:
            feats.append(features(backbone, x.flip(3)))
            labels.append(y)
        if n % 20 == 0:
            print(f"  {n * 32}/{len(items)} photos, {time.time() - start:.0f}s", flush=True)
    return torch.cat(feats), torch.cat(labels)


def cached(name: str, make) -> tuple[torch.Tensor, torch.Tensor]:
    path = CHECKPOINTS / f"features-{name}-{SIZE}.pt"
    if path.exists():
        return torch.load(path)
    out = make()
    torch.save(out, path)
    return out


def fit(x: torch.Tensor, y: torch.Tensor, weight_decay: float) -> nn.Linear:
    torch.manual_seed(0)
    head = nn.Linear(FEATURES, SPECIES)
    opt = torch.optim.AdamW(head.parameters(), lr=1e-3, weight_decay=weight_decay)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, EPOCHS)
    loss_fn = nn.CrossEntropyLoss()
    for _ in range(EPOCHS):
        for idx in torch.randperm(len(x)).split(256):
            opt.zero_grad()
            loss_fn(head(x[idx]), y[idx]).backward()
            opt.step()
        sched.step()
    return head


def fit_temperature(logits: torch.Tensor, y: torch.Tensor) -> float:
    """The T minimising the negative log-likelihood of softmax(logits / T)."""
    log_t = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([log_t], lr=0.1, max_iter=200)

    def closure():
        opt.zero_grad()
        loss = F.cross_entropy(logits / log_t.exp(), y)
        loss.backward()
        return loss

    opt.step(closure)
    return float(log_t.exp())


@torch.no_grad()
def accuracy(head: nn.Linear, x: torch.Tensor, y: torch.Tensor) -> float:
    return float((head(x).argmax(1) == y).float().mean())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cub")
    args = parser.parse_args()
    root = cub.cub_dir(args.cub)
    CHECKPOINTS.mkdir(exist_ok=True)
    torch.set_num_threads(4)

    items = cub.photos(root)
    train = [p for p in items if p.split == "train"]
    val = [p for p in items if p.split == "val"]
    print(f"{len(train)} train, {len(val)} val photos", flush=True)

    backbone = build_backbone()
    tx, ty = cached("train", lambda: extract(backbone, train, mirror=True))
    vx, vy = cached("val", lambda: extract(backbone, val, mirror=False))
    # Standardise features with train statistics; folded into the head at the end.
    mean, std = tx.mean(0), tx.std(0) + 1e-6
    txn, vxn = (tx - mean) / std, (vx - mean) / std

    results = {}
    for wd in WEIGHT_DECAYS:
        head = fit(txn, ty, wd)
        results[wd] = (accuracy(head, vxn, vy), head)
        print(f"weight decay {wd:g}: val top-1 {results[wd][0]:.3f}", flush=True)
    wd = max(results, key=lambda k: results[k][0])
    best = results[wd][1]

    # Fold the standardisation into the linear layer: W((x-m)/s)+b = (W/s)x + (b - W(m/s)).
    folded = nn.Linear(FEATURES, SPECIES)
    with torch.no_grad():
        folded.weight.copy_(best.weight / std)
        folded.bias.copy_(best.bias - (best.weight * (mean / std)).sum(1))
    assert abs(accuracy(folded, vx, vy) - results[wd][0]) < 1e-3

    with torch.no_grad():
        val_logits = best(vxn)
    temperature = fit_temperature(val_logits, vy)
    with torch.no_grad():
        nll = (F.cross_entropy(val_logits, vy).item(), F.cross_entropy(val_logits / temperature, vy).item())
    print(f"temperature {temperature:.3f}: val NLL {nll[0]:.3f} -> {nll[1]:.3f}", flush=True)

    # Centroid of each species' standardised train features (photos and mirrors).
    counts = torch.bincount(ty, minlength=SPECIES).clamp_min(1).unsqueeze(1)
    centroids = torch.zeros(SPECIES, FEATURES).index_add_(0, ty, txn) / counts

    torch.save(folded.state_dict(), CHECKPOINTS / "head.pt")
    torch.save({"mean": mean, "std": std, "centroids": centroids}, CHECKPOINTS / "centroids.pt")
    (CHECKPOINTS / "train.json").write_text(json.dumps(
        {"weight_decay": wd, "val_top1": results[wd][0],
         "sweep": {str(k): v[0] for k, v in results.items()},
         "temperature": temperature, "val_nll": nll[0], "val_nll_calibrated": nll[1]}, indent=2))
    print(f"kept weight decay {wd:g}, val top-1 {results[wd][0]:.3f}, temperature {temperature:.3f}"
          " -> checkpoints/head.pt, centroids.pt")


if __name__ == "__main__":
    main()
