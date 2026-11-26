"""Export the trained model for the browser and check the ship gate.

- ONNX (opset 17), softmax built in: "input" [N,3,224,224] -> "probs" [N,200].
- int8 dynamic quantisation of MatMul/Gemm weights only (the patch-embedding
  Conv stays fp32: ConvInteger has no CPU kernel).
- The int8 model is scored with onnxruntime-web (web/scripts/score.ts), the
  runtime the site ships, because its int8 kernels round differently from
  native onnxruntime. fp32 is scored natively (the runtimes agree on fp32).
  int8 ships only if its test top-1 is within 1 point of fp32.
- Threshold: the lowest of 0.20, 0.25, ... 0.95 at which named Verdicts on the
  val set are >= 92% right. Fixed before the test set was first scored.
- Ship gate (test set, at that Threshold): named Verdicts >= 90% right AND at
  least half of photos named. Exits non-zero if it fails.
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
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.shape_inference import quant_pre_process
from PIL import Image
from torch import nn

import cub
from model import ARCH, FEATURES, SPECIES, BirdClassifier, build_backbone
from preprocess import load_eval, pixels_to_tensor

ROOT = Path(__file__).resolve().parent
WEB = ROOT.parent / "web"
OUT = WEB / "public" / "model"
FIXTURES = WEB / "test" / "fixtures"
FIXTURE_PHOTO = WEB / "public" / "examples" / "northern-cardinal.jpg"
BUILD = ROOT / "checkpoints"
THRESHOLDS = [round(0.2 + 0.05 * i, 2) for i in range(16)]
VAL_NAMED_TARGET = 0.92
GATE_NAMED_ACCURACY = 0.90
GATE_NAMED_SHARE = 0.50
MAX_INT8_DROP = 0.01
WEB_WORKERS = 4
BLOCK = 1000


def stack(items: list[cub.Photo]) -> tuple[np.ndarray, np.ndarray]:
    return (np.stack([load_eval(p.path).numpy() for p in items]),
            np.array([p.species for p in items]))


def native_probs(model: Path, inputs: np.ndarray) -> np.ndarray:
    sess = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
    return np.concatenate([sess.run(["probs"], {"input": inputs[i:i + 32]})[0]
                           for i in range(0, len(inputs), 32)])


def web_probs(model: Path, inputs: np.ndarray, name: str) -> np.ndarray:
    """Confidences from onnxruntime-web, via web/scripts/score.ts.

    Runs WEB_WORKERS processes in parallel over blocks of BLOCK photos, deleting
    each block's input file afterwards (every photo is 600 KB as float32).
    """
    results = []
    for start in range(0, len(inputs), BLOCK):
        block = inputs[start:start + BLOCK]
        chunks = np.array_split(np.arange(len(block)), min(WEB_WORKERS, len(block)))
        procs, files = [], []
        for k, idx in enumerate(chunks):
            src, dst = BUILD / f"{name}.{start}.{k}.inputs.bin", BUILD / f"{name}.{start}.{k}.probs.json"
            block[idx].astype("<f4").tofile(src)
            procs.append(subprocess.Popen(["node", "scripts/score.ts", str(model), str(src), str(dst)], cwd=WEB))
            files.append((src, dst))
        failed = [p.wait() != 0 for p in procs]
        for src, dst in files:
            src.unlink()
            if not any(failed):
                results.append(np.array(json.loads(dst.read_text()), dtype=np.float64))
            dst.unlink(missing_ok=True)
        if any(failed):
            raise SystemExit("web scoring failed")
        print(f"  {name}: {min(start + BLOCK, len(inputs))}/{len(inputs)} scored", flush=True)
    return np.concatenate(results)


def accuracy(probs: np.ndarray, labels: np.ndarray) -> float:
    return float((probs.argmax(1) == labels).mean())


def named_stats(probs: np.ndarray, labels: np.ndarray, threshold: float) -> tuple[float, float]:
    """(share of photos given a named Verdict, accuracy of those named Verdicts)."""
    named = probs.max(1) >= threshold
    if not named.any():
        return 0.0, 0.0
    return float(named.mean()), float((probs.argmax(1)[named] == labels[named]).mean())


def pick_threshold(probs: np.ndarray, labels: np.ndarray) -> float:
    for t in THRESHOLDS:
        if named_stats(probs, labels, t)[1] >= VAL_NAMED_TARGET:
            return t
    return THRESHOLDS[-1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cub")
    args = parser.parse_args()
    root = cub.cub_dir(args.cub)
    torch.set_num_threads(4)

    head = nn.Linear(FEATURES, SPECIES)
    head.load_state_dict(torch.load(BUILD / "head.pt"))
    model = BirdClassifier(build_backbone(), head).eval()

    fp32 = BUILD / "model.fp32.onnx"
    torch.onnx.export(
        model, torch.zeros(1, 3, 224, 224), fp32,
        input_names=["input"], output_names=["probs"],
        dynamic_axes={"input": {0: "batch"}, "probs": {0: "batch"}},
        opset_version=17, dynamo=False,
    )
    prepped = BUILD / "model.prep.onnx"
    quant_pre_process(str(fp32), str(prepped))
    int8 = BUILD / "model.int8-dynamic.onnx"
    quantize_dynamic(str(prepped), str(int8), weight_type=QuantType.QInt8,
                     op_types_to_quantize=["MatMul", "Gemm"])

    items = cub.photos(root)
    print("preprocessing val and test photos...", flush=True)
    val_x, val_y = stack([p for p in items if p.split == "val"])
    test_x, test_y = stack([p for p in items if p.split == "test"])

    fp32_acc = accuracy(native_probs(fp32, test_x), test_y)
    print(f"fp32 (native) test top-1 {fp32_acc:.3f}  size {fp32.stat().st_size / 1e6:.1f} MB", flush=True)
    print("scoring int8 with onnxruntime-web...", flush=True)
    val_p, test_p = web_probs(int8, val_x, "val"), web_probs(int8, test_x, "test")
    int8_acc = accuracy(test_p, test_y)
    print(f"int8 (web)    test top-1 {int8_acc:.3f}  size {int8.stat().st_size / 1e6:.1f} MB", flush=True)
    if fp32_acc - int8_acc > MAX_INT8_DROP:
        print("EXPORT FAILED: int8 loses more than 1 point; fp32 is too big to ship.", file=sys.stderr)
        return 1

    threshold = pick_threshold(val_p, val_y)
    val_share, val_named = named_stats(val_p, val_y, threshold)
    share, named_acc = named_stats(test_p, test_y, threshold)
    top3 = float(np.mean([y in np.argsort(-p)[:3] for p, y in zip(test_p, test_y)]))
    metrics = {
        "model": f"{ARCH} frozen + linear head (int8 dynamic)",
        "runtime": "onnxruntime-web (wasm)",
        "species": SPECIES,
        "test_photos": len(test_y),
        "threshold": threshold,
        "test_named_share": round(share, 4),
        "test_named_accuracy": round(named_acc, 4),
        "val_named_share": round(val_share, 4),
        "val_named_accuracy": round(val_named, 4),
        "test_top1_accuracy": round(int8_acc, 4),
        "test_top3_accuracy": round(top3, 4),
        "fp32_test_top1_accuracy": round(fp32_acc, 4),
        "threshold_rule": f"lowest threshold with val named accuracy >= {VAL_NAMED_TARGET}",
        "gate": f"test named accuracy >= {GATE_NAMED_ACCURACY} and named share >= {GATE_NAMED_SHARE}",
    }
    print(json.dumps(metrics, indent=2))

    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(int8, OUT / "model.onnx")
    (OUT / "labels.json").write_text(json.dumps(
        {"species": cub.species_names(root), "threshold": threshold}, indent=2) + "\n")
    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")

    # Parity fixture: a lossless PNG of a CC0 example photo, the tensor
    # training/preprocess.py makes from it, and onnxruntime-web's Confidences.
    FIXTURES.mkdir(parents=True, exist_ok=True)
    with Image.open(FIXTURE_PHOTO) as img:
        small = img.convert("RGB")
        small.thumbnail((320, 320))
        small.save(FIXTURES / "fixture.png")
    with Image.open(FIXTURES / "fixture.png") as img:
        x = pixels_to_tensor(np.asarray(img.convert("RGB"))).numpy()
    x.astype("<f4").tofile(FIXTURES / "input.bin")
    expected = web_probs(OUT / "model.onnx", x[None], "fixture")[0]
    (FIXTURES / "expected.json").write_text(json.dumps({"probs": [float(p) for p in expected]}) + "\n")

    if named_acc < GATE_NAMED_ACCURACY or share < GATE_NAMED_SHARE:
        print(f"SHIP GATE FAILED: named accuracy {named_acc:.3f}, named share {share:.2f}", file=sys.stderr)
        return 1
    print("ship gate passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
