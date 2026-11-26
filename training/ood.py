"""The out-of-distribution (OOD) set: pictures that are not one of the 200 Species.

export.py reports how many of these get *Not a bird I know*. Nothing here is
used to choose a setting: the distance cut-off comes from the val split only.

- Synthetic pictures (noise, plain colours, gradients, patterns), made here
  from a fixed seed, so nothing to download or license.
- Non-bird photos: CC0 iNaturalist observations, downloaded once by
  `python ood.py` into training/ood/ and credited in training/ood/ood.json.

Usage: python ood.py   (re-downloads the photos)
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
PHOTOS = ROOT / "ood"
API = "https://api.inaturalist.org/v1/observations"
HEADERS = {"User-Agent": "bird-classifier-ood/1.0"}
SIZE = 320

# (what it shows, iNaturalist observation id). CC0 research-grade
# observations, picked by eye so that no bird is in frame.
PHOTO_OBSERVATIONS = [
    ("monarch butterflies", 101410048),
    ("monarch caterpillar", 75438242),
    ("honey bee swarm", 128011193),
    ("bullfrog", 105058408),
    ("toad in water", 149453852),
    ("red-eared slider", 105925502),
    ("red-eared slider on a log", 73968070),
    ("white-tailed deer", 2710551),
    ("white deer", 16376548),
    ("grey squirrel", 275108556),
    ("black squirrel", 50334412),
    ("cat", 142389012),
    ("cartoon cat", 339927644),
    ("dog on a beach", 191739611),
    ("dog on a road", 361958995),
    ("fly agaric", 246329501),
    ("fly agaric on a lawn", 109875469),
    ("dandelion clock", 19421695),
    ("oak leaves", 42761568),
    ("oak leaf", 48430951),
    ("phone on the ground", 291649679),
    ("roof", 91913552),
]


def synthetic() -> list[tuple[str, np.ndarray]]:
    """(name, HxWx3 uint8 RGB) pictures with nothing in them."""
    rng = np.random.default_rng(7)
    s = SIZE
    ramp = np.linspace(0, 255, s)
    yy, xx = np.mgrid[0:s, 0:s]
    out: list[tuple[str, np.ndarray]] = [
        ("uniform noise", rng.integers(0, 256, (s, s, 3))),
        ("grey noise", np.repeat(rng.integers(0, 256, (s, s, 1)), 3, 2)),
        ("blocky noise", np.kron(rng.integers(0, 256, (s // 16, s // 16, 3)), np.ones((16, 16, 1)))),
    ]
    for name, rgb in [("black", (0, 0, 0)), ("white", (255, 255, 255)), ("grey", (128, 128, 128)),
                      ("red", (220, 30, 30)), ("green", (40, 160, 60)), ("blue", (30, 60, 200)),
                      ("sky blue", (135, 190, 235)), ("sand", (210, 190, 150))]:
        out.append((f"plain {name}", np.broadcast_to(np.array(rgb), (s, s, 3))))
    out += [
        ("grey gradient", np.broadcast_to(ramp[None, :, None], (s, s, 3))),
        ("sky gradient", np.stack([90 + 0.5 * ramp, 140 + 0.4 * ramp, 230 - 0.1 * ramp], 1)[:, None].repeat(s, 1)),
        ("rainbow gradient", np.stack([ramp[None, :].repeat(s, 0), ramp[::-1, None].repeat(s, 1),
                                       np.full((s, s), 128)], 2)),
        ("checkerboard", np.repeat((((yy // 40) + (xx // 40)) % 2 * 255)[..., None], 3, 2)),
        ("stripes", np.repeat(((xx // 20) % 2 * 255)[..., None], 3, 2)),
        ("circle", np.repeat(((yy - s / 2) ** 2 + (xx - s / 2) ** 2 < (s / 4) ** 2)[..., None] * 255, 3, 2)),
    ]
    return [(name, np.clip(img, 0, 255).astype(np.uint8)) for name, img in out]


def photos() -> list[tuple[str, Path]]:
    """(what it shows, file) for the downloaded CC0 photos."""
    credits = json.loads((PHOTOS / "ood.json").read_text())
    return [(c["shows"], PHOTOS / c["file"]) for c in credits]


def main() -> None:
    import requests
    from PIL import Image

    PHOTOS.mkdir(exist_ok=True)
    credits = []
    for shows, obs_id in PHOTO_OBSERVATIONS:
        obs = requests.get(f"{API}/{obs_id}", headers=HEADERS, timeout=30).json()["results"][0]
        photo = next(p for p in obs["photos"] if p.get("license_code") == "cc0")
        url = photo["url"].replace("/square.", "/medium.")
        file = PHOTOS / f"{obs_id}.jpg"
        tmp = PHOTOS / f"{obs_id}.download"
        tmp.write_bytes(requests.get(url, headers=HEADERS, timeout=60).content)
        with Image.open(tmp) as img:
            img.convert("RGB").save(file, quality=90)
        tmp.unlink()
        credits.append({"shows": shows, "file": file.name, "license": "CC0",
                        "attribution": photo.get("attribution", ""),
                        "taxon": obs.get("taxon", {}).get("name", ""),
                        "url": f"https://www.inaturalist.org/observations/{obs_id}"})
        print(f"{shows}: {credits[-1]['url']}", flush=True)
        time.sleep(1.5)
    (PHOTOS / "ood.json").write_text(json.dumps(credits, indent=2) + "\n")


if __name__ == "__main__":
    main()
