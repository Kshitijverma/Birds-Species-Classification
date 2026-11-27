# Raise the input resolution to 336 px, without flip averaging

Issue #15 asked for more accuracy than the frozen 224 px ViT-S/14 gives (test top-1 85.5%). The options were a higher input resolution, fine-tuning, a bigger backbone, or more species. Each candidate goes through the rules of ADR 0001: settings chosen on val, the int8 model measured in onnxruntime-web, the same Threshold rule and ship gate. We also kept an eye on download size and time per photo, since the model runs on the visitor's device in one wasm thread.

## Decision

Ship **ViT-S/14 at 336 px** (shorter side resized to 384, centre crop 336), still frozen with a linear head, and **turn flip averaging off** (`export.py --no-flip`).

## Candidates

All rows are on the CUB test split (5,794 photos), int8 in onnxruntime-web, unless marked. "Time" is the median time per identification in Node's onnxruntime-web (wasm, one thread, measured in `export.py`), on a 4-core aarch64 box that other jobs were also using. It is only a proxy for a visitor's browser, but it is fair between candidates.

| | 224 + flip (shipped before, #21) | **336, no flip (shipped)** | 336 + flip | 448 |
|---|---|---|---|---|
| Named accuracy | 94.0% | **93.1%** | 93.4% | not measured |
| Named share | 80.4% | **85.5%** | 84.7% | not measured |
| Top-1, no cut-off | 85.5% | **86.8%** | 86.7% | not measured |
| Top-3 | 95.4% | **96.0%** | 96.2% | not measured |
| ECE | 2.6% | **2.0%** | 2.0% | not measured |
| Threshold (val rule) | 0.65 | 0.60 | 0.60 | n/a |
| Val named share / accuracy | 81.2% / 92.8% | **86.2% / 92.8%** | 87.0% / 92.3% | n/a |
| Val top-1, fp32 linear probe | 84.5% | 86.7% | n/a | 87.8% |
| Out-of-distribution set → Not a bird I know | 37 / 39 | 37 / 39 | 37 / 39 | n/a |
| int8 model | 23.8 MB | 24.3 MB | 24.3 MB | 25.0 MB |
| Time per identification (Node proxy) | 1.9 s | **2.3 s** | 4.7 s | 5.5 s (19 s with flip) |

The shipped column is [`web/public/model/metrics.json`](../../web/public/model/metrics.json), produced by the `--no-flip` export. Its val row comes from that export (86.2% / 92.8%).

## Why

- **336 px is a real gain.** Compared with the model it replaces, 5 more photos in 100 get a named answer (80.4% → 85.5%) and top-1 rises 1.3 points, for 0.5 MB more download. Named accuracy drops 0.9 points (94.0% → 93.1%). That is expected: the Threshold falls from 0.65 to 0.60 under the same val rule (named Verdicts ≥ 92% right on val), so the model names more photos at a slightly lower bar. Both the gate and the val target still hold.
- **Flip off.** At 336 px, the #10 flip rule would turn flip on: it names more val photos (87.0% vs 86.2%), and on test it raises named accuracy by 0.4 points while lowering named share by 0.8. But it doubles the work per photo, from 2.3 s to 4.7 s in the proxy (about 2.5× the cost of the old model). We set a budget of roughly what visitors already wait. Within that budget there were two candidates: 224 + flip (1.9 s) and 336 without flip (2.3 s). We chose between them on val, where 336 without flip names 86.2% of photos against 81.2%, with the same 92.8% named accuracy. Test agreed. Flip averaging stays in the code (`labels.json` `"flip"`), so it can come back if inference gets faster.
- **448 px: not shipped.** It is the most accurate on val (fp32 linear probe 87.8%, against 86.7% at 336), but each identification is 5.5 s (19 s with flip) in the proxy, which is too slow on a phone. Scoring it in onnxruntime-web would have taken about 10 hours on this box, so it was screened on val only and not measured on test.
- **ViT-B/14 at 224: not tried.** It has 85.7 M parameters against ViT-S's 21.6 M. At the int8 rate we see for ViT-S (23.8 MB for 21.6 M), it would be about 92 MB, well over the ~60 MB limit #15 set, and roughly 4× slower.
- **Fine-tuning the last ViT blocks: skipped.** It doesn't fit in about 3 hours of CPU. Caching the input to the last two blocks would take one pass over the 10,788 train photos and mirrors (about 20 min at 224, 2.1 GB on disk), then about 10 min per epoch for forward and backward through two blocks. Ten to fifteen epochs makes 2 to 2.5 h, plus a full re-export (2 to 3 h of onnxruntime-web scoring). Cached inputs also rule out random-crop augmentation, which is where most fine-tuning gains on a 6,000-photo dataset come from. With augmentation, every epoch is a full forward pass, which comes to more than 5 h. This is worth revisiting with a GPU.
- **More species (iNaturalist photos beyond CUB's 200): left open.** It means licence-filtered downloads, remapping names, a credits page and a new test set. It's a separate project, not an accuracy fix.

## Consequences

- Preprocessing changes in both `training/preprocess.py` and `web/src/preprocess.ts`, which `web/test/parity.test.ts` keeps identical. The browser worker gets the input size from `preprocess.ts`.
- `export.py` loads photos a block at a time, because test at 336 px is 7.8 GB as one float32 array. It scores the flip test pass only when val chose flip, and takes `--no-flip`.
- At 336 the weight-decay sweep picked its largest value (0.5), and the val-fitted temperature is 1.00, so the head is already calibrated. A wider sweep might add a little.
- Fine-tuning remains the next step if more accuracy is needed.
