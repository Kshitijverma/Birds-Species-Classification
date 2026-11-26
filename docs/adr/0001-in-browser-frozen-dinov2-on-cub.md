# In-browser classifier: frozen DINOv2 + linear head, trained on CUB-200-2011

The 2020 project classified CUB-200-2011 birds from hand-labelled attributes (scikit-learn) and a small Keras CNN, with no way to try it. We rebuilt it as a site where anyone can identify a bird from their own photo. The model runs in the visitor's browser (DINOv2 ViT-S/14 through onnxruntime-web, int8), served from GitHub Pages, so there is no server to run and photos never leave the device.

## Considered Options

- **Training data: iNaturalist instead of CUB.** Rejected for now: about 30,000 licence-filtered downloads (roughly 12 hours at iNaturalist's rate limits) and remapping outdated CUB names. CUB keeps the original 200 species and gives numbers comparable with published results. CUB photos come from Flickr and aren't ours to redistribute, so the site's example photos and the test fixture are CC0 iNaturalist photos instead.
- **Fine-tuning the backbone** (as the Crocodilian Classifier does). Not needed unless the frozen baseline misses the gate: a frozen DINOv2 with a linear head is the standard strong baseline on CUB and trains in minutes on CPU instead of hours.
- **Predicting the 312 CUB attributes as an explanation.** Deferred: a second head to train and validate, for an explanation of uncertain value.
- **Firebase Hosting.** Rejected in favour of GitHub Pages: no project or secret to set up.

## Consequences

- The ship gate was fixed before the test set was first scored. The Threshold is the lowest value where named Verdicts on val are at least 92% right. Shipping needs named Verdicts on test to be at least 90% right, with at least half of test photos named. All of this is measured in onnxruntime-web, whose int8 kernels round differently from native onnxruntime.
- The model knows only these 200 Species. A non-bird, or a bird outside the list, gets a wrong guess or Can't be sure. The site says so instead of adding a second "is it a bird?" model.
- Routing uses URL hashes (`#/notebook`), because GitHub Pages can't rewrite paths to `index.html`.
