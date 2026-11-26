# Field Guide: Bird Classifier

Show it a photo of a bird and it names the species, out of **200 North American species** from [CUB-200-2011](https://www.vision.caltech.edu/datasets/cub_200_2011/). If it isn't confident, it says **Can't be sure** and shows its closest matches instead of guessing.

**Live:** https://kshitijverma.github.io/Birds-Species-Classification/

Everything runs in your browser: a DINOv2 ViT-S/14 model with a linear head, run through [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/). Your photo is never uploaded. Species you identify can go into your own **field notebook** (a life list kept in your browser), and the species index shows how many of the 200 you've spotted. Each species has its own page (`#/species/<slug>`) with a photo, a short description, your sightings and links to Wikipedia and All About Birds.

## How good is it?

Measured once, on CUB's 5,794 official test photos, in the same runtime the site uses:

| | |
|---|---|
| Named answers that are right | **92.7%** |
| Photos that get a named answer | 84.2% (the rest get *Can't be sure*) |
| Right species in the top 3 | 95.4% |
| Top-1 accuracy with no cut-off | 85.4% |
| Confidence needed to name a species | 0.65 |
| Model download | 23 MB (int8), cached after first use |

It can't tell a non-bird from a bird. A photo of random noise got named *California Gull* at 66%. Anything outside the 200 species gets a wrong guess or *Can't be sure*.

All numbers, and the Threshold, are in [`web/public/model/metrics.json`](web/public/model/metrics.json). The ship gate was fixed before the test set was first scored (see [`docs/adr/0001`](docs/adr/0001-in-browser-frozen-dinov2-on-cub.md)).

## Layout

- `web/` is the site (Vite + React 18 + TypeScript).
  - `npm run dev` starts it locally.
  - `npm test` runs the verdict rule tests and the preprocessing parity test.
  - `npm run build` builds it to `web/dist`.
- `training/` holds the reproducible training pipeline (Python; a 4-core CPU is enough).
- `legacy/` is the original 2020 project: attribute-based classifiers, a Keras CNN, and the report.
- `.github/workflows/ci.yml` lints, tests and builds on every PR, and deploys to GitHub Pages on every push to `master`.

Domain terms (Species, Verdict, Threshold, Notebook…) are defined in [`CONTEXT.md`](CONTEXT.md).

## Retraining

Download `CUB_200_2011.tgz` (1.1 GB) from [Caltech](https://data.caltech.edu/records/65de6-vp158) and extract it. Then:

```bash
cd training
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
export CUB_DIR=/path/to/CUB_200_2011
.venv/bin/python train.py       # frozen DINOv2 features + linear head (~20 min on CPU) -> checkpoints/head.pt
.venv/bin/python export.py      # ONNX + int8, metrics, parity fixture -> web/ (needs Node 24 and npm ci in web/)
```

`export.py` scores the int8 model with onnxruntime-web (`web/scripts/score.ts`) and exits with an error unless, on the test set, named answers are at least 90% right and at least half of photos get one. `training/preprocess.py` and `web/src/preprocess.ts` must stay identical, and `web/test/parity.test.ts` checks this. `fetch_examples.py` re-downloads the site's CC0 example photos, and `fetch_species.py` rebuilds the species pages' data (Wikipedia summaries and iNaturalist photos, into `web/public/species/`); photos it picks badly are replaced by pinning an observation id in `PHOTO_PINS`.

## Credits

- **Training data:** CUB-200-2011. C. Wah, S. Branson, P. Welinder, P. Perona and S. Belongie, *The Caltech-UCSD Birds-200-2011 Dataset*, Caltech, 2011. Its photos are not included in this repo or on the site.
- **Example photos:** CC0, from iNaturalist observations. Each one is listed in [`web/public/examples/examples.json`](web/public/examples/examples.json).
- **Species descriptions:** adapted from the [Wikipedia](https://en.wikipedia.org/) article for each species, available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Each species page names and links its article.
- **Species photos:** one iNaturalist photo per species, each under CC0, CC BY 4.0 or CC BY-SA 4.0. The photographer, licence and observation link for every photo are in [`web/public/species/species.json`](web/public/species/species.json), on each species page and on the site's About page.
- **Model:** [DINOv2](https://github.com/facebookresearch/dinov2) (Meta AI, Apache-2.0), via [timm](https://github.com/huggingface/pytorch-image-models).

This started in 2020 as a course project on classifying birds from their attributes. It was rebuilt in 2026 as an in-browser classifier.
