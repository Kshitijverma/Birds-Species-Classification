"""Fetch the species pages' data: a Wikipedia summary and one CC-licensed photo per species.

Runs at build time, not on the site: the result is committed, so the site makes
no calls to outside APIs. For each of the 200 names in web/public/model/labels.json:

- the article summary from Wikipedia's REST API (text is CC BY-SA 4.0, credited
  and linked on each page), checked to be about a bird;
- one research-grade iNaturalist photo licensed CC0, CC BY or CC BY-SA, with its
  photographer, licence and observation link, resized to a ~480 px JPEG;
- an All About Birds guide link, when Cornell has a page for the species
  (AAB_PAGES lists the exceptions, checked by hand).

Writes web/public/species/<slug>.jpg and web/public/species/species.json.

Photos are picked automatically (the most-faved eligible observation) unless
PHOTO_PINS names an observation: the automatic pick is sometimes a drawing, an
egg, a dead bird or a distant speck, so check the contact sheet
(--contact-sheet) and pin a better observation by id.

Usage: python fetch_species.py [--cache DIR] [--only "Blue Jay,Gadwall"] [--contact-sheet out.jpg]
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import time
from pathlib import Path
from urllib.parse import quote

import requests
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
WEB = ROOT.parent / "web" / "public"
OUT = WEB / "species"
LABELS = WEB / "model" / "labels.json"

HEADERS = {"User-Agent": "bird-classifier-species-pages/1.0 (open-source field guide; build-time data fetch)"}
WIKI = "https://en.wikipedia.org/api/rest_v1/page/summary/"
INAT = "https://api.inaturalist.org/v1"
AAB = "https://www.allaboutbirds.org/guide/"
LICENSES = {
    "cc0": ("CC0", "https://creativecommons.org/publicdomain/zero/1.0/"),
    "cc-by": ("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"),
    "cc-by-sa": ("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
}
PHOTO_SIZE = 480  # longest side, px
MAX_DESCRIPTION = 700  # characters; longer summaries are cut at a sentence end

# Names whose Wikipedia article has a different title (or would land on a
# disambiguation page or the wrong bird).
WIKI_TITLES = {
    "Frigatebird": "Frigatebird",
    "Phoebe": "Sayornis",
    "Roadrunner": "Roadrunner",
    "Myrtle Warbler": "Yellow-rumped warbler",
    "Florida Scrub-Jay": "Florida scrub jay",
    "Gray-crowned Rosy Finch": "Grey-crowned rosy finch",
    "White-breasted Kingfisher": "White-throated kingfisher",
    "Cape Glossy Starling": "Cape starling",
    "Green Violetear": "Mexican violetear",
    "Eared Grebe": "Black-necked grebe",
    "Winter Wren": "Winter wren",
    "Ovenbird": "Ovenbird",
    "Mallard": "Mallard",
    "Common Raven": "Common raven",
    "Northern Fulmar": "Northern fulmar",
    "Pacific Loon": "Pacific loon",
    "Horned Lark": "Horned lark",
    "Great Grey Shrike": "Great grey shrike",
    "Spotted Catbird": "Spotted catbird",
    "House Wren": "Northern house wren",  # "House wren" is a disambiguation page
    "Cliff Swallow": "American cliff swallow",  # "Cliff swallow" is the genus
    "Herring Gull": "American herring gull",  # CUB's are North American
}

# iNaturalist taxon to take a photo from, by scientific name, where the common
# name is ambiguous, a genus, a subspecies or out of date.
INAT_TAXA = {
    "Frigatebird": "Fregata magnificens",  # CUB's frigatebirds are mostly Magnificent
    "Phoebe": "Sayornis",
    "Roadrunner": "Geococcyx californianus",
    "Myrtle Warbler": "Setophaga coronata coronata",
    "White-breasted Kingfisher": "Halcyon smyrnensis",
    "Cape Glossy Starling": "Lamprotornis nitens",
    "Green Violetear": "Colibri thalassinus",
    "Winter Wren": "Troglodytes hiemalis",
    "Great Grey Shrike": "Lanius excubitor",
    "Spotted Catbird": "Ailuroedus maculosus",
    "White-necked Raven": "Corvus albicollis",
    "Gray-crowned Rosy Finch": "Leucosticte tephrocotis",
    "Florida Scrub-Jay": "Aphelocoma coerulescens",
    "Eared Grebe": "Podiceps nigricollis",
    "Pied Kingfisher": "Ceryle rudis",
    "Ringed Kingfisher": "Megaceryle torquata",
    "European Goldfinch": "Carduelis carduelis",
    "Northern Flicker": "Colaptes auratus",
    "Palm Warbler": "Setophaga palmarum",
    "Fox Sparrow": "Passerella iliaca",
    "Dark-eyed Junco": "Junco hyemalis",
    "Yellow Warbler": "Setophaga petechia",
    "Marsh Wren": "Cistothorus palustris",
    "House Wren": "Troglodytes aedon",
    "Herring Gull": "Larus smithsonianus",
}

# All About Birds guide pages whose slug isn't the name with underscores.
# None: Cornell has no page (mostly birds from outside North America).
AAB_PAGES: dict[str, str | None] = {
    "Phoebe": "Eastern_Phoebe",
    "Roadrunner": "Greater_Roadrunner",
    "Frigatebird": "Magnificent_Frigatebird",
    "Myrtle Warbler": "Yellow-rumped_Warbler",
    "Gray-crowned Rosy Finch": "Gray-crowned_Rosy-Finch",
    "Great Grey Shrike": "Northern_Shrike",
    "Spotted Catbird": None,  # Australia / New Guinea
    "Cape Glossy Starling": None,  # southern Africa
    "Pied Kingfisher": None,  # Africa / Asia
    "White-breasted Kingfisher": None,  # Asia
    "White-necked Raven": None,  # Africa
    "Sooty Albatross": None,  # southern oceans
    "Green Violetear": None,  # Mexico to Central America; no Cornell guide page found
}

# Observation ids picked by eye where the automatic pick was a poor photo
# (drawing, egg, dead bird, wrong species, distant or cluttered).
PHOTO_PINS: dict[str, int] = {
    "Crested Auklet": 113244294,
    "Parakeet Auklet": 389573029,
    "Rhinoceros Auklet": 333779439,
    "Red-faced Cormorant": 114608629,
    "American Crow": 72146984,
    "Black-billed Cuckoo": 283816722,
    "Gray-crowned Rosy Finch": 35900763,
    "Northern Flicker": 383939455,
    "Great Crested Flycatcher": 377538095,
    "Yellow-bellied Flycatcher": 44371471,
    "Eared Grebe": 117438101,
    "Pied-billed Grebe": 267652956,
    "Blue Grosbeak": 174403449,
    "Heermann's Gull": 51215609,
    "Anna's Hummingbird": 261658421,
    "Long-tailed Jaeger": 402582951,
    "Pomarine Jaeger": 363604184,
    "Green Jay": 119898013,
    "Dark-eyed Junco": 17134505,
    "Tropical Kingbird": 294187225,
    "Green Kingfisher": 172881805,
    "White-breasted Kingfisher": 120023758,
    "Red-legged Kittiwake": 174837642,
    "Horned Lark": 340953503,
    "Mallard": 107276403,
    "Common Nighthawk": 94667725,
    "Orchard Oriole": 332520622,
    "Western Wood-Pewee": 106390678,
    "Phoebe": 325953889,
    "Horned Puffin": 302549526,
    "Common Raven": 362764607,
    "White-necked Raven": 275581235,
    "Great Grey Shrike": 69932147,
    "House Sparrow": 255108840,
    "Fox Sparrow": 100231639,
    "Grasshopper Sparrow": 17843038,
    "Seaside Sparrow": 139810750,
    "Vesper Sparrow": 348875358,
    "Cape Glossy Starling": 46350616,
    "Bank Swallow": 148445938,
    "Black Tern": 115112943,
    "Common Tern": 2599993,
    "Elegant Tern": 37677989,
    "Forster's Tern": 47359581,
    "Green-tailed Towhee": 364542473,
    "Red-eyed Vireo": 48484004,
    "Warbling Vireo": 124341254,
    "Yellow-throated Vireo": 196632710,
    "Palm Warbler": 2964355,
    "Prothonotary Warbler": 219807511,
    "Wilson's Warbler": 47064378,
    "Pileated Woodpecker": 279638557,
    "Red-bellied Woodpecker": 280038514,
    "Red-cockaded Woodpecker": 340999227,
    "Common Yellowthroat": 367949571,
}


def slugify(name: str) -> str:
    """'Chuck-will's-widow' -> 'chuck-wills-widow'. Must match slugify() in web/src/species.ts."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("'", "")).strip("-")


class Client:
    """requests with a ~1 request/second rate limit and an optional on-disk cache."""

    def __init__(self, cache: Path | None):
        self.cache = cache
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self.last = 0.0
        if cache:
            cache.mkdir(parents=True, exist_ok=True)

    def get(self, url: str, binary: bool = False, allow_404: bool = False):
        key = self.cache / hashlib.sha1(url.encode()).hexdigest() if self.cache else None
        if key and key.exists():
            data = key.read_bytes()
            if data == b"404":
                return None
            return data if binary else json.loads(data)
        wait = 1.0 - (time.monotonic() - self.last)
        if wait > 0:
            time.sleep(wait)
        for attempt in range(4):
            self.last = time.monotonic()
            r = self.session.get(url, timeout=60)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(5 * (attempt + 1))
                continue
            break
        if r.status_code == 404 and allow_404:
            if key:
                key.write_bytes(b"404")
            return None
        r.raise_for_status()
        if key:
            key.write_bytes(r.content)
        return r.content if binary else r.json()


def describe(text: str) -> str:
    text = " ".join(text.split())
    if len(text) <= MAX_DESCRIPTION:
        return text
    cut = text[:MAX_DESCRIPTION]
    end = max(cut.rfind(". "), cut.rfind(". "))
    return cut[: end + 1] if end > 200 else cut.rsplit(" ", 1)[0] + "…"


BIRD_WORDS = re.compile(r"\b(birds?|passerine|species of|genus of|family of|seabird|songbird|waterfowl|duck|gull|tern)\b", re.I)


def wikipedia(client: Client, name: str) -> dict:
    title = WIKI_TITLES.get(name, name)
    s = client.get(WIKI + quote(title.replace(" ", "_"), safe=""))
    if s.get("type") != "standard":
        raise ValueError(f"{name}: Wikipedia '{title}' is a {s.get('type')} page")
    blurb = f"{s.get('description', '')} {s.get('extract', '')}"
    if not BIRD_WORDS.search(blurb):
        raise ValueError(f"{name}: Wikipedia '{s['title']}' doesn't look like a bird article: {blurb[:120]}")
    return {
        "title": s["title"],
        "url": s["content_urls"]["desktop"]["page"],
        "description": describe(s["extract"]),
        "license": "CC BY-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
    }


def taxon(client: Client, name: str) -> dict:
    query = INAT_TAXA.get(name, name)
    res = client.get(f"{INAT}/taxa?q={quote(query)}&is_active=true&per_page=10")["results"]
    birds = [t for t in res if t.get("iconic_taxon_name") == "Aves"]
    q = query.lower()
    exact = [t for t in birds if q in (t["name"].lower(), (t.get("preferred_common_name") or "").lower())]
    if not (exact or birds):
        raise ValueError(f"{name}: no iNaturalist bird taxon for '{query}'")
    return (exact or birds)[0]


def candidates(client: Client, taxon_id: int, per_page: int = 30) -> list[tuple[dict, dict]]:
    """Eligible (observation, photo) pairs, most-faved first: wild, research grade, openly licensed.

    Prefers observations annotated as adult (iNaturalist annotation term 1 = 2),
    which keeps out chicks, eggs and nests; falls back to unannotated ones for
    rarely photographed species. Dead birds and drawings still slip through:
    check the contact sheet.
    """
    base = (f"{INAT}/observations?taxon_id={taxon_id}&quality_grade=research&photos=true"
            f"&photo_license=cc0,cc-by,cc-by-sa&captive=false&order_by=votes&per_page={per_page}")
    out = []
    for query in (f"{base}&term_id=1&term_value_id=2", base):
        for o in client.get(query)["results"]:
            p = o["photos"][0]  # the observer's lead photo; later ones are often extras
            if p.get("license_code") in LICENSES and o["id"] not in {x["id"] for x, _ in out}:
                out.append((o, p))
        if len(out) >= 5:
            break
    return out


def pick_photo(client: Client, name: str, taxon_id: int) -> tuple[dict, dict]:
    if name in PHOTO_PINS:
        o = client.get(f"{INAT}/observations/{PHOTO_PINS[name]}")["results"][0]
        photo = next((p for p in o["photos"] if p.get("license_code") in LICENSES), None)
        if photo is None:
            raise ValueError(f"{name}: pinned observation {o['id']} has no CC0/CC BY/CC BY-SA photo")
        return o, photo
    found = candidates(client, taxon_id)
    if not found:
        raise ValueError(f"{name}: no CC0/CC BY/CC BY-SA photo found")
    return found[0]


def save_photo(client: Client, photo: dict, path: Path) -> tuple[int, int]:
    url = re.sub(r"/square\.", "/large.", photo["url"])
    img = Image.open(io.BytesIO(client.get(url, binary=True))).convert("RGB")
    img.thumbnail((PHOTO_SIZE, PHOTO_SIZE), Image.LANCZOS)
    img.save(path, "JPEG", quality=78, optimize=True, progressive=True)
    return img.size


def all_about_birds(name: str) -> str | None:
    """Cornell's guide URL. Not checked over the network: the site refuses scripted requests."""
    if name in AAB_PAGES:
        page = AAB_PAGES[name]
        return f"{AAB}{page}/overview" if page else None
    return f"{AAB}{re.sub(r'[^A-Za-z0-9-]+', '_', name.replace(chr(39), ''))}/overview"


def contact_sheet(entries: list[dict], path: Path, cols: int = 10, cell: int = 180) -> None:
    rows = (len(entries) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 16)), "white")
    draw = ImageDraw.Draw(sheet)
    for i, e in enumerate(entries):
        img = Image.open(OUT / e["photo"]["file"])
        img.thumbnail((cell, cell))
        x, y = (i % cols) * cell, (i // cols) * (cell + 16)
        sheet.paste(img, (x + (cell - img.width) // 2, y + (cell - img.height) // 2))
        draw.text((x + 2, y + cell), f"{i} {e['name']}"[:30], fill="black")
    sheet.save(path, quality=85)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", type=Path, help="cache API responses and photos here")
    ap.add_argument("--only", help="comma-separated names to refetch; others are kept from species.json")
    ap.add_argument("--contact-sheet", type=Path, help="also write a contact sheet of all photos here")
    ap.add_argument("--candidates", help="instead, show one species' candidate photos (with observation ids) "
                    "in the --contact-sheet, to choose a PHOTO_PINS entry")
    args = ap.parse_args()

    if args.candidates:
        client = Client(args.cache)
        found = candidates(client, taxon(client, args.candidates)["id"])
        sheet = Image.new("RGB", (5 * 240, ((min(len(found), 20) + 4) // 5) * 256), "white")
        draw = ImageDraw.Draw(sheet)
        for i, (o, p) in enumerate(found[:20]):
            img = Image.open(io.BytesIO(client.get(p["url"].replace("/square.", "/small."), binary=True)))
            img = img.convert("RGB")
            img.thumbnail((240, 240))
            x, y = (i % 5) * 240, (i // 5) * 256
            sheet.paste(img, (x, y))
            draw.text((x + 2, y + 241), f"{i} obs {o['id']}", fill="black")
        sheet.save(args.contact_sheet or "candidates.jpg", quality=85)
        return

    names = json.loads(LABELS.read_text())["species"]
    OUT.mkdir(parents=True, exist_ok=True)
    out_json = OUT / "species.json"
    old = {e["name"]: e for e in json.loads(out_json.read_text())} if out_json.exists() else {}
    only = {n.strip() for n in args.only.split(",")} if args.only else None
    client = Client(args.cache)

    entries, problems = [], []
    for i, name in enumerate(names):
        if only is not None and name not in only and name in old:
            entries.append(old[name])
            continue
        try:
            slug = slugify(name)
            wiki = wikipedia(client, name)
            t = taxon(client, name)
            obs, photo = pick_photo(client, name, t["id"])
            w, h = save_photo(client, photo, OUT / f"{slug}.jpg")
            label, license_url = LICENSES[photo["license_code"]]
            user = obs.get("user") or {}
            entries.append({
                "name": name,
                "slug": slug,
                "scientificName": t["name"],
                "wikipedia": wiki,
                "allAboutBirds": all_about_birds(name),
                "photo": {
                    "file": f"{slug}.jpg",
                    "width": w,
                    "height": h,
                    "photographer": user.get("name") or user.get("login") or "unknown",
                    "attribution": photo.get("attribution", ""),
                    "license": label,
                    "licenseUrl": license_url,
                    "observation": f"https://www.inaturalist.org/observations/{obs['id']}",
                },
            })
            print(f"{i:3} {name}: {wiki['title']} | {t['name']} | obs {obs['id']} {label}", flush=True)
        except Exception as e:  # report every problem at the end, not just the first
            problems.append(f"{name}: {e}")
            print(f"{i:3} {name}: FAILED {e}", flush=True)
            if name in old:
                entries.append(old[name])

    out_json.write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n")
    if args.contact_sheet:
        contact_sheet(entries, args.contact_sheet)
    total = sum(f.stat().st_size for f in OUT.glob("*.jpg"))
    print(f"{len(entries)} species, photos {total / 1e6:.1f} MB")
    if problems:
        raise SystemExit("Problems:\n" + "\n".join(problems))


if __name__ == "__main__":
    main()
