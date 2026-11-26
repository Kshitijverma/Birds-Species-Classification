"""Fetch the site's example photos: CC0, research-grade iNaturalist observations.

CUB-200-2011 photos come from Flickr and aren't ours to redistribute, so the
"try an example" photos (and the test fixture made from one) are CC0 instead.
Writes web/public/examples/<slug>.jpg and web/public/examples/examples.json.

Usage: python fetch_examples.py
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "web" / "public" / "examples"
API = "https://api.inaturalist.org/v1/observations"
HEADERS = {"User-Agent": "bird-classifier-examples/1.0"}

# (display name as in labels.json, iNaturalist observation id). Picked by eye
# from CC0 research-grade observations: the most-voted ones are often
# drawings, skeletons or distant specks.
EXAMPLES = [
    ("Northern Cardinal", 416918492),
    ("Blue Jay", 414709353),
    ("Painted Bunting", 2800791),
    ("Belted Kingfisher", 412516275),
    ("American Goldfinch", 53187208),
    ("Pileated Woodpecker", 388551192),
]


def slug(name: str) -> str:
    return name.lower().replace("'", "").replace(" ", "-")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    credits = []
    for name, obs_id in EXAMPLES:
        obs = requests.get(f"{API}/{obs_id}", headers=HEADERS, timeout=30).json()["results"][0]
        photo = next(p for p in obs["photos"] if p.get("license_code") == "cc0")
        url = photo["url"].replace("/square.", "/medium.")
        (OUT / f"{slug(name)}.jpg").write_bytes(requests.get(url, headers=HEADERS, timeout=60).content)
        credits.append({"species": name, "file": f"{slug(name)}.jpg", "license": "CC0",
                        "attribution": photo.get("attribution", ""),
                        "url": f"https://www.inaturalist.org/observations/{obs['id']}"})
        print(f"{name}: {credits[-1]['url']}", flush=True)
        time.sleep(1.5)
    (OUT / "examples.json").write_text(json.dumps(credits, indent=2) + "\n")


if __name__ == "__main__":
    main()
