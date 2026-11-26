# Field Guide: Bird Classifier

Show it a photo of a bird and it names the species, out of **200 North American species** from [CUB-200-2011](https://www.vision.caltech.edu/datasets/cub_200_2011/). If it isn't confident, it says **Can't be sure** and shows its closest matches instead of guessing. If the photo looks like none of the 200, it says **Not a bird I know**.

**Live:** https://kshitijverma.github.io/Birds-Species-Classification/

Everything runs in your browser: a DINOv2 ViT-S/14 model with a linear head, run through [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/). Your photo is never uploaded. Species you identify can go into your own **field notebook** (a life list kept in your browser), and the species index shows how many of the 200 you've spotted. Each species has its own page (`#/species/<slug>`) with a photo, a short description, your sightings and links to Wikipedia and All About Birds.

## How good is it?

Measured once, on CUB's 5,794 official test photos, in the same runtime the site uses:

| | |
|---|---|
| Named answers that are right | **94.0%** |
| Photos that get a named answer | 80.4% (the rest get *Can't be sure*, or *Not a bird I know* for 0.6%) |
| Right species in the top 3 | 95.4% |
| Top-1 accuracy with no cut-off | 85.5% |
| Confidence needed to name a species | 0.65 |
| Calibration error (ECE) | 2.6% (Confidence is on average 2.6 points from how often it's right) |
| Model download | 24 MB (int8), cached after first use |

Each photo is scored together with its mirror image and the two answers averaged. On test that made named answers more accurate (93.7% → 94.0%) for slightly fewer of them (80.7% → 80.4%), at twice the compute per photo. Confidences are calibrated with a temperature fitted on val (1.14); the About page shows a reliability chart.

**Not a bird I know.** A photo whose DINOv2 features are further from every species' average than 99% of val photos gets *Not a bird I know* instead of a guess. Of 39 out-of-distribution pictures ([`training/ood.py`](training/ood.py): noise, plain colours, gradients and patterns, plus 22 CC0 iNaturalist photos of insects, frogs, turtles, deer, squirrels, cats, dogs, fungi, leaves, a phone and a roof), 37 got it and 2 (a squirrel, a turtle) got *Can't be sure*; none was named as a bird. It isn't a promise: some non-birds will still get a guess, and a bird outside the 200 usually looks close enough to one of them to get a wrong guess or *Can't be sure*.

All numbers, the Threshold and the max distance are in [`web/public/model/metrics.json`](web/public/model/metrics.json). The ship gate was fixed before the test set was first scored, and every setting is chosen on the val split (see [`docs/adr/0001`](docs/adr/0001-in-browser-frozen-dinov2-on-cub.md)).

## Layout

- `web/` is the site (Vite + React 18 + TypeScript).
  - `npm run dev` starts it locally.
  - `npm test` runs the verdict rule tests and the preprocessing parity test.
  - `npm run build` builds it to `web/dist`.
  - `npm run e2e` (after a build) serves `web/dist` under `/Birds-Species-Classification/` and runs the Playwright tests in `web/e2e/`: a smoke test (two example photos, a noise image, the notebook, every page, no console errors) and an axe accessibility check of each page in light and dark. It needs Chromium once: `npx playwright install --only-shell chromium`.
  - `web/pwa/` is the service worker that makes the site installable and offline: the site is cached on the first visit, the model on the first identification. Each build lists its files' content hashes in `sw.js`, so a retrained model replaces the cached one.
- `training/` holds the reproducible training pipeline (Python; a 4-core CPU is enough).
- `legacy/` is the original 2020 project: attribute-based classifiers, a Keras CNN, and the report.
- `.github/workflows/ci.yml` lints, tests and builds on every PR, runs the end-to-end and accessibility tests, and deploys to GitHub Pages on every push to `master` once both pass.

Domain terms (Species, Verdict, Threshold, Notebook…) are defined in [`CONTEXT.md`](CONTEXT.md).

## Retraining

Download `CUB_200_2011.tgz` (1.1 GB) from [Caltech](https://data.caltech.edu/records/65de6-vp158) and extract it. Then:

```bash
cd training
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
export CUB_DIR=/path/to/CUB_200_2011
.venv/bin/python train.py       # frozen DINOv2 features + linear head, temperature, species centroids (~20 min on CPU) -> checkpoints/
.venv/bin/python export.py      # ONNX + int8, val-chosen settings, metrics, parity fixture -> web/ (needs Node 24 and npm ci in web/; ~1-2 h on 4 cores)
```

`export.py` scores the int8 model with onnxruntime-web (`web/scripts/score.ts`) and exits with an error unless, on the test set, named answers are at least 90% right and at least half of photos get one. `training/preprocess.py` and `web/src/preprocess.ts` must stay identical, and `web/test/parity.test.ts` checks this. `ood.py` re-downloads the out-of-distribution photos into `training/ood/`. `fetch_examples.py` re-downloads the site's CC0 example photos, and `fetch_species.py` rebuilds the species pages' data (Wikipedia summaries and iNaturalist photos, into `web/public/species/`); photos it picks badly are replaced by pinning an observation id in `PHOTO_PINS`.

## Credits

- **Training data:** CUB-200-2011. C. Wah, S. Branson, P. Welinder, P. Perona and S. Belongie, *The Caltech-UCSD Birds-200-2011 Dataset*, Caltech, 2011. Its photos are not included in this repo or on the site.
- **Example photos:** CC0, from iNaturalist observations. Each one is listed in [`web/public/examples/examples.json`](web/public/examples/examples.json).
- **Species descriptions:** adapted from the [Wikipedia](https://en.wikipedia.org/) article for each species, available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Each species page names and links its article.
- **Species photos:** one iNaturalist photo per species, each under CC0, CC BY 4.0 or CC BY-SA 4.0. The photographer, licence and observation link for every photo are in [`web/public/species/species.json`](web/public/species/species.json), on each species page and on the site's About page.
- **Model:** [DINOv2](https://github.com/facebookresearch/dinov2) (Meta AI, Apache-2.0), via [timm](https://github.com/huggingface/pytorch-image-models).

This started in 2020 as a course project on classifying birds from their attributes. It was rebuilt in 2026 as an in-browser classifier.
