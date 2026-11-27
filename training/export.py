"""Export the trained model for the browser and check the ship gate.

- ONNX (opset 17): "input" [N,3,336,336] -> "probs" [N,200] (softmax and the
  val-fitted temperature built in) and "distance" [N] (to the nearest species
  centroid, see model.SpeciesDistance).
- int8 dynamic quantisation of MatMul/Gemm weights only (the patch-embedding
  Conv stays fp32: ConvInteger has no CPU kernel; the distance stays fp32).
- The int8 model is scored with onnxruntime-web (web/scripts/score.ts), the
  runtime the site ships, because its int8 kernels round differently from
  native onnxruntime. fp32 is scored natively (the runtimes agree on fp32).
  int8 ships only if its test top-1 is within 1 point of fp32.
- Settings, all chosen on the val split, before the test split is scored:
  - Max distance: the 99th percentile of val photos' distances. Further than
    that from every species gets "Not a bird I know".
  - Threshold: the lowest of 0.20, 0.25, ... 0.95 at which named Verdicts on
    val are >= 92% right.
  - Flip: also score the mirrored photo (one batch of 2) and average, if that
    names more val photos. Shipped only if it also improves test named
    accuracy or named share.
- Ship gate (test set, with those settings): named Verdicts >= 90% right AND
  at least half of photos named. Exits non-zero if it fails.
- Reports calibration (expected calibration error, before and after the
  temperature) and how many out-of-distribution pictures (ood.py) get
  "Not a bird I know".
- Writes web/public/model/{model.onnx,labels.json,metrics.json} and the
  parity fixture under web/test/fixtures/ (from a CC0 example photo, so no
  CUB image is redistributed).

Needs Node 24+ and `npm ci` in web/. Usage: python export.py [--cub PATH]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.shape_inference import quant_pre_process
from PIL import Image
from torch import nn

import cub
import ood
from model import ARCH, FEATURES, SPECIES, BirdClassifier, SpeciesDistance, build_backbone
from preprocess import SIZE, load_eval, pixels_to_tensor

ROOT = Path(__file__).resolve().parent
WEB = ROOT.parent / "web"
OUT = WEB / "public" / "model"
FIXTURES = WEB / "test" / "fixtures"
FIXTURE_PHOTO = WEB / "public" / "examples" / "northern-cardinal.jpg"
BUILD = ROOT / "checkpoints"
THRESHOLDS = [round(0.2 + 0.05 * i, 2) for i in range(16)]
VAL_NAMED_TARGET = 0.92
KNOWN_QUANTILE = 0.99
GATE_NAMED_ACCURACY = 0.90
GATE_NAMED_SHARE = 0.50
MAX_INT8_DROP = 0.01
ECE_BINS = 15
WEB_WORKERS = 4
BLOCK = round(1000 * (224 / SIZE) ** 2)  # photos per scoring round: ~600 MB of float32 inputs


@dataclass
class Outputs:
    probs: np.ndarray     # [N,200] Confidences
    distance: np.ndarray  # [N] distance to the nearest species centroid


@dataclass
class Settings:
    flip: bool
    max_distance: float
    threshold: float


class Photos:
    """Preprocessed photos, loaded a slice at a time (all of test at 448 px would be 14 GB)."""

    def __init__(self, paths: list[Path]):
        self.paths = paths

    def __len__(self) -> int:
        return len(self.paths)

    def __getitem__(self, s: slice) -> np.ndarray:
        return np.stack([load_eval(p).numpy() for p in self.paths[s]])


def stack(items: list[cub.Photo]) -> tuple[Photos, np.ndarray]:
    return Photos([p.path for p in items]), np.array([p.species for p in items])


def native_probs(model: Path, inputs: np.ndarray) -> np.ndarray:
    sess = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
    return np.concatenate([sess.run(["probs"], {"input": inputs[i:i + 32]})[0]
                           for i in range(0, len(inputs), 32)])


def with_mirrors(x: np.ndarray) -> np.ndarray:
    """[x0, mirror(x0), x1, mirror(x1), ...]: the batches of 2 the site runs with flip on."""
    return np.stack([x, x[..., ::-1]], 1).reshape(-1, *x.shape[1:])


def web_outputs(model: Path, inputs: np.ndarray, name: str, flip: bool = False,
                workers: int = WEB_WORKERS) -> tuple[Outputs, list[float]]:
    """Outputs from onnxruntime-web via web/scripts/score.ts, and its time per run (ms).

    With flip, each photo runs in one batch with its mirror image and the two
    are averaged, as web/src/model.ts does. Runs `workers` processes in
    parallel over blocks of BLOCK photos, deleting each block's input file
    afterwards.
    """
    probs, distance, ms = [], [], []
    for start in range(0, len(inputs), BLOCK):
        block = inputs[start:start + BLOCK]
        chunks = np.array_split(np.arange(len(block)), min(workers, len(block)))
        procs, files = [], []
        for k, idx in enumerate(chunks):
            src, dst = BUILD / f"{name}.{start}.{k}.inputs.bin", BUILD / f"{name}.{start}.{k}.out.json"
            (with_mirrors(block[idx]) if flip else block[idx]).astype("<f4").tofile(src)
            batch = "2" if flip else "1"
            procs.append(subprocess.Popen(["node", "scripts/score.ts", str(model), str(src), str(dst), batch],
                                          cwd=WEB))
            files.append((src, dst))
        failed = [p.wait() != 0 for p in procs]
        for src, dst in files:
            src.unlink()
            if not any(failed):
                out = json.loads(dst.read_text())
                p, d = np.array(out["probs"], dtype=np.float64), np.array(out["distance"], dtype=np.float64)
                if flip:
                    p, d = p.reshape(-1, 2, p.shape[1]).mean(1), d.reshape(-1, 2).mean(1)
                probs.append(p)
                distance.append(d)
                ms += out["ms"]
            dst.unlink(missing_ok=True)
        if any(failed):
            raise SystemExit("web scoring failed")
        print(f"  {name}: {min(start + BLOCK, len(inputs))}/{len(inputs)} scored", flush=True)
    return Outputs(np.concatenate(probs), np.concatenate(distance)), ms


def accuracy(probs: np.ndarray, labels: np.ndarray) -> float:
    return float((probs.argmax(1) == labels).mean())


def named_stats(out: Outputs, labels: np.ndarray, max_distance: float, threshold: float) -> tuple[float, float]:
    """(share of photos given a named Verdict, accuracy of those named Verdicts)."""
    named = (out.distance <= max_distance) & (out.probs.max(1) >= threshold)
    if not named.any():
        return 0.0, 0.0
    return float(named.mean()), float((out.probs.argmax(1)[named] == labels[named]).mean())


def pick_threshold(out: Outputs, labels: np.ndarray, max_distance: float) -> float:
    for t in THRESHOLDS:
        if named_stats(out, labels, max_distance, t)[1] >= VAL_NAMED_TARGET:
            return t
    return THRESHOLDS[-1]


def pick_settings(out: Outputs, labels: np.ndarray, flip: bool) -> Settings:
    max_distance = float(np.quantile(out.distance, KNOWN_QUANTILE))
    return Settings(flip, round(max_distance, 4), pick_threshold(out, labels, max_distance))


def verdict_kind(out: Outputs, s: Settings) -> list[str]:
    """Mirrors web/src/verdict.ts."""
    return ["not-a-bird" if d > s.max_distance else "species" if p.max() >= s.threshold else "cant-tell"
            for p, d in zip(out.probs, out.distance)]


def calibration(probs: np.ndarray, labels: np.ndarray) -> tuple[float, list[dict]]:
    """Expected calibration error over ECE_BINS equal-width Confidence bins, and the bins."""
    conf, right = probs.max(1), probs.argmax(1) == labels
    edges = np.linspace(0, 1, ECE_BINS + 1)
    ece, bins = 0.0, []
    for lo, hi in zip(edges[:-1], edges[1:]):
        inside = (conf > lo) & (conf <= hi)
        if inside.any():
            ece += inside.mean() * abs(conf[inside].mean() - right[inside].mean())
            bins.append({"from": round(lo, 3), "to": round(hi, 3), "photos": int(inside.sum()),
                         "confidence": round(float(conf[inside].mean()), 4),
                         "accuracy": round(float(right[inside].mean()), 4)})
    return float(ece), bins


def uncalibrated(probs: np.ndarray, temperature: float) -> np.ndarray:
    """Undo the temperature: softmax(T * log p) = softmax(logits)."""
    z = temperature * np.log(np.maximum(probs, 1e-45))
    z -= z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


def ood_inputs() -> tuple[list[str], np.ndarray]:
    names, tensors = [], []
    for name, rgb in ood.synthetic():
        names.append(name)
        tensors.append(pixels_to_tensor(rgb).numpy())
    for shows, path in ood.photos():
        names.append(shows)
        tensors.append(load_eval(path).numpy())
    return names, np.stack(tensors)


def export_onnx(model: nn.Module) -> tuple[Path, Path]:
    fp32 = BUILD / "model.fp32.onnx"
    torch.onnx.export(
        model, torch.zeros(1, 3, SIZE, SIZE), fp32,
        input_names=["input"], output_names=["probs", "distance"],
        dynamic_axes={"input": {0: "batch"}, "probs": {0: "batch"}, "distance": {0: "batch"}},
        opset_version=17, dynamo=False,
    )
    prepped = BUILD / "model.prep.onnx"
    quant_pre_process(str(fp32), str(prepped))
    # The distance's MatMul stays fp32: int8 rounding of the centroids would blur it.
    keep_fp32 = [n.name for n in onnx.load(str(prepped)).graph.node if n.name.startswith("/distance/")]
    int8 = BUILD / "model.int8-dynamic.onnx"
    quantize_dynamic(str(prepped), str(int8), weight_type=QuantType.QInt8,
                     op_types_to_quantize=["MatMul", "Gemm"], nodes_to_exclude=keep_fp32)
    prepped.unlink()
    return fp32, int8


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cub")
    parser.add_argument("--no-flip", action="store_true",
                        help="never average with the mirror image (it doubles the time per photo; see docs/adr/0002)")
    args = parser.parse_args()
    flips = (False,) if args.no_flip else (False, True)
    root = cub.cub_dir(args.cub)
    torch.set_num_threads(4)

    head = nn.Linear(FEATURES, SPECIES)
    head.load_state_dict(torch.load(BUILD / "head.pt"))
    temperature = json.loads((BUILD / "train.json").read_text())["temperature"]
    c = torch.load(BUILD / "centroids.pt")
    model = BirdClassifier(build_backbone(), head, temperature,
                           SpeciesDistance(c["mean"], c["std"], c["centroids"])).eval()
    fp32, int8 = export_onnx(model)

    items = cub.photos(root)
    print("preprocessing val and test photos...", flush=True)
    val_x, val_y = stack([p for p in items if p.split == "val"])
    test_x, test_y = stack([p for p in items if p.split == "test"])
    ood_names, ood_x = ood_inputs()

    fp32_acc = accuracy(native_probs(fp32, test_x), test_y)
    print(f"fp32 (native) test top-1 {fp32_acc:.3f}  size {fp32.stat().st_size / 1e6:.1f} MB", flush=True)

    # Choose every setting on val, for each flip option, before scoring test.
    print("scoring val with onnxruntime-web...", flush=True)
    val = {flip: web_outputs(int8, val_x, f"val{int(flip)}", flip)[0] for flip in flips}
    options = {flip: pick_settings(val[flip], val_y, flip) for flip in flips}
    val_named = {flip: named_stats(val[flip], val_y, s.max_distance, s.threshold) for flip, s in options.items()}
    for flip, (share, acc) in val_named.items():
        print(f"val, flip {flip}: {options[flip]}, named share {share:.4f}, named accuracy {acc:.4f}", flush=True)
    val_pick = True in flips and val_named[True][0] > val_named[False][0]

    print("scoring test with onnxruntime-web...", flush=True)
    # Flip doubles the cost of scoring, so test it only if val chose it.
    test = {flip: web_outputs(int8, test_x, f"test{int(flip)}", flip)[0] for flip in (False, True)
            if not flip or val_pick}
    int8_acc = accuracy(test[False].probs, test_y)
    print(f"int8 (web)    test top-1 {int8_acc:.3f}  size {int8.stat().st_size / 1e6:.1f} MB", flush=True)
    if fp32_acc - int8_acc > MAX_INT8_DROP:
        print("EXPORT FAILED: int8 loses more than 1 point; fp32 is too big to ship.", file=sys.stderr)
        return 1

    test_named = {flip: named_stats(out, test_y, options[flip].max_distance, options[flip].threshold)
                  for flip, out in test.items()}
    for flip, (share, acc) in test_named.items():
        print(f"test, flip {flip}: named share {share:.4f}, named accuracy {acc:.4f}", flush=True)
    # Flip costs a second run per photo: ship it only if val chose it and test confirms it helps.
    flip = val_pick and (test_named[True][0] > test_named[False][0] or test_named[True][1] > test_named[False][1])
    s, val_out, test_out = options[flip], val[flip], test[flip]
    share, named_acc = test_named[flip]
    val_share, val_acc = val_named[flip]

    ece_before, _ = calibration(uncalibrated(test[False].probs, temperature), test_y)
    ece_after, _ = calibration(test[False].probs, test_y)
    ece_shipped, bins = calibration(test_out.probs, test_y)
    top3 = float(np.mean([y in np.argsort(-p)[:3] for p, y in zip(test_out.probs, test_y)]))
    test_kinds = verdict_kind(test_out, s)

    ood_out = {f: web_outputs(int8, ood_x, f"ood{int(f)}", f)[0] for f in flips}
    ood_kinds = verdict_kind(ood_out[flip], s)
    print("out-of-distribution pictures:")
    for name, kind, p, d in zip(ood_names, ood_kinds, ood_out[flip].probs, ood_out[flip].distance):
        print(f"  {name:28s} {kind:10s} distance {d:.3f}  top {p.max():.2f}")

    ms = {f: web_outputs(int8, val_x[:12], f"time{int(f)}", f, workers=1)[1][2:] for f in flips}
    metrics = {
        "model": f"{ARCH} frozen + linear head (int8 dynamic)",
        "runtime": "onnxruntime-web (wasm)",
        "species": SPECIES,
        "test_photos": len(test_y),
        "threshold": s.threshold,
        "max_distance": s.max_distance,
        "flip": flip,
        "temperature": round(temperature, 4),
        "test_named_share": round(share, 4),
        "test_named_accuracy": round(named_acc, 4),
        "test_not_a_bird_share": round(test_kinds.count("not-a-bird") / len(test_kinds), 4),
        "val_named_share": round(val_share, 4),
        "val_named_accuracy": round(val_acc, 4),
        "test_top1_accuracy": round(accuracy(test_out.probs, test_y), 4),
        "test_top3_accuracy": round(top3, 4),
        "fp32_test_top1_accuracy": round(fp32_acc, 4),
        "test_ece_before_temperature": round(ece_before, 4),
        "test_ece": round(ece_after, 4),
        "test_ece_shipped": round(ece_shipped, 4),
        "reliability": bins,
        "flip_comparison": {
            str(f).lower(): {"val_named_share": round(val_named[f][0], 4),
                             "val_named_accuracy": round(val_named[f][1], 4),
                             "threshold": options[f].threshold,
                             **({"test_named_share": round(test_named[f][0], 4),
                                 "test_named_accuracy": round(test_named[f][1], 4),
                                 "test_top1_accuracy": round(accuracy(test[f].probs, test_y), 4)} if f in test else {}),
                             "ood_not_a_bird": verdict_kind(ood_out[f], options[f]).count("not-a-bird"),
                             "node_ms_per_identification": round(float(np.median(ms[f])), 1)}
            for f in flips},
        "ood_pictures": len(ood_kinds),
        "ood_not_a_bird": ood_kinds.count("not-a-bird"),
        "ood_cant_tell": ood_kinds.count("cant-tell"),
        "ood_named": ood_kinds.count("species"),
        "threshold_rule": f"lowest threshold with val named accuracy >= {VAL_NAMED_TARGET}",
        "max_distance_rule": f"{KNOWN_QUANTILE:.0%} quantile of val photos' distance to the nearest species",
        "flip_rule": ("off (--no-flip): twice the time per photo, see docs/adr/0002" if args.no_flip else
                      "on if it names more val photos, and kept only if it improves test named accuracy or share"),
        "gate": f"test named accuracy >= {GATE_NAMED_ACCURACY} and named share >= {GATE_NAMED_SHARE}",
    }
    print(json.dumps({k: v for k, v in metrics.items() if k != "reliability"}, indent=2))

    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(int8, OUT / "model.onnx")
    (OUT / "labels.json").write_text(json.dumps(
        {"species": cub.species_names(root), "threshold": s.threshold, "maxDistance": s.max_distance,
         "flip": flip}, indent=2) + "\n")
    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")

    # Parity fixture: a lossless PNG of a CC0 example photo, the tensor
    # training/preprocess.py makes from it, and onnxruntime-web's outputs (one run of 1).
    FIXTURES.mkdir(parents=True, exist_ok=True)
    with Image.open(FIXTURE_PHOTO) as img:
        small = img.convert("RGB")
        small.thumbnail((320, 320))
        small.save(FIXTURES / "fixture.png")
    with Image.open(FIXTURES / "fixture.png") as img:
        x = pixels_to_tensor(np.asarray(img.convert("RGB"))).numpy()
    x.astype("<f4").tofile(FIXTURES / "input.bin")
    expected = web_outputs(OUT / "model.onnx", x[None], "fixture")[0]
    (FIXTURES / "expected.json").write_text(json.dumps(
        {"probs": [float(p) for p in expected.probs[0]], "distance": float(expected.distance[0])}) + "\n")

    if named_acc < GATE_NAMED_ACCURACY or share < GATE_NAMED_SHARE:
        print(f"SHIP GATE FAILED: named accuracy {named_acc:.3f}, named share {share:.2f}", file=sys.stderr)
        return 1
    print("ship gate passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
