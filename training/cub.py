"""CUB-200-2011: species names and the train / val / test splits.

- test: CUB's official test split (5,794 photos). Not looked at until export.
- val:  10% of CUB's official train split, stratified by species (seed 1234).
- train: the rest of the official train split.

Download CUB_200_2011.tgz from https://data.caltech.edu/records/65de6-vp158
and extract it; pass its folder with --cub or set CUB_DIR.
"""

from __future__ import annotations

import os
import random
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

VAL_FRACTION = 0.10
SEED = 1234


@dataclass(frozen=True)
class Photo:
    path: Path
    species: int  # 0-based index into species_names()
    split: str    # "train" | "val" | "test"


def cub_dir(arg: str | None = None) -> Path:
    path = Path(arg or os.environ.get("CUB_DIR", "data/CUB_200_2011")).expanduser().resolve()
    if not (path / "images.txt").exists():
        raise SystemExit(f"CUB-200-2011 not found at {path}: download it and pass --cub or set CUB_DIR")
    return path


def _rows(path: Path) -> list[list[str]]:
    return [line.split() for line in path.read_text().splitlines() if line.strip()]


# CUB drops apostrophes and uses a few genus names, typos or shortened names.
# Display names follow common English usage.
NAME_FIXES = {
    "Brewer Blackbird": "Brewer's Blackbird",
    "Cardinal": "Northern Cardinal",
    "Chuck-will Widow": "Chuck-will's-widow",
    "Brandt Cormorant": "Brandt's Cormorant",
    "Heermann Gull": "Heermann's Gull",
    "Anna Hummingbird": "Anna's Hummingbird",
    "Florida Jay": "Florida Scrub-Jay",
    "Mockingbird": "Northern Mockingbird",
    "Nighthawk": "Common Nighthawk",
    "Clark Nutcracker": "Clark's Nutcracker",
    "Scott Oriole": "Scott's Oriole",
    "White Pelican": "American White Pelican",
    "Western Wood Pewee": "Western Wood-Pewee",
    "Sayornis": "Phoebe",
    "Whip-poor Will": "Eastern Whip-poor-will",
    "Geococcyx": "Roadrunner",
    "Baird Sparrow": "Baird's Sparrow",
    "Brewer Sparrow": "Brewer's Sparrow",
    "Harris Sparrow": "Harris's Sparrow",
    "Henslow Sparrow": "Henslow's Sparrow",
    "Le Conte Sparrow": "LeConte's Sparrow",
    "Lincoln Sparrow": "Lincoln's Sparrow",
    "Nelson Sharp-tailed Sparrow": "Nelson's Sparrow",
    "Tree Sparrow": "American Tree Sparrow",
    "Artic Tern": "Arctic Tern",
    "Forsters Tern": "Forster's Tern",
    "Swainson Warbler": "Swainson's Warbler",
    "Wilson Warbler": "Wilson's Warbler",
    "Bewick Wren": "Bewick's Wren",
}


def clean_name(label: str) -> str:
    """'001.Black_footed_Albatross' -> 'Black-footed Albatross'."""
    name = label.split(".", 1)[1]
    words = name.split("_")
    # CUB writes hyphenated words with underscores and a lower-case second
    # half ("Black_footed"): rejoin those with a hyphen.
    out: list[str] = []
    for w in words:
        if out and w[:1].islower():
            out[-1] = f"{out[-1]}-{w}"
        else:
            out.append(w)
    joined = " ".join(out)
    return NAME_FIXES.get(joined, joined)


def species_names(root: Path) -> list[str]:
    return [clean_name(label) for _, label in sorted(_rows(root / "classes.txt"), key=lambda r: int(r[0]))]


def photos(root: Path) -> list[Photo]:
    paths = {int(i): p for i, p in _rows(root / "images.txt")}
    labels = {int(i): int(c) - 1 for i, c in _rows(root / "image_class_labels.txt")}
    is_train = {int(i): t == "1" for i, t in _rows(root / "train_test_split.txt")}

    by_species: dict[int, list[int]] = defaultdict(list)
    for i in sorted(paths):
        if is_train[i]:
            by_species[labels[i]].append(i)
    rng = random.Random(SEED)
    val: set[int] = set()
    for ids in by_species.values():
        ids = ids[:]
        rng.shuffle(ids)
        val.update(ids[: max(1, round(len(ids) * VAL_FRACTION))])

    return [
        Photo(root / "images" / paths[i], labels[i],
              "test" if not is_train[i] else ("val" if i in val else "train"))
        for i in sorted(paths)
    ]
