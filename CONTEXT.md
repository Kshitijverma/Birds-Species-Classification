# Bird Classifier

Tells a visitor which bird species is in a photo they upload, out of the 200 species in CUB-200-2011, or that it can't be sure.

## Language

### Birds

**Species**:
One of the 200 answers the classifier can give, as listed in CUB-200-2011 and shown under a cleaned-up common name (e.g. "Brewer's Blackbird" for CUB's `Brewer_Blackbird`). A few CUB "species" are really a genus (Phoebe, Roadrunner) or a subspecies (Myrtle Warbler); they are still one Species each.
_Avoid_: Class, label, category

**Species page**:
The page about one Species (`#/species/<slug>`): its photo, a short description, the visitor's Sightings of it, and links out to Wikipedia and All About Birds. Its data is fetched at build time, so the site makes no calls to outside APIs.

### Answers

**Verdict**:
What the site tells the visitor about one photo: either a named Species with its Confidence, or Can't be sure.

**Confidence**:
The model's probability for a Species, between 0 and 1. The 200 Confidences for a photo sum to 1.
_Avoid_: Score, certainty

**Threshold**:
The Confidence a Species needs before the site names it.

**Can't be sure**:
The Verdict when no Species reaches the Threshold. The site then shows the Closest matches instead of an answer.
_Avoid_: Unknown, not a bird (the model can't tell a non-bird apart)

**Also possible**:
The two next most confident Species shown under a named Verdict.

**Closest matches**:
The three most confident Species shown with a Can't-be-sure Verdict.

### The visitor's side

**Notebook**:
The visitor's own list of Species they have recorded, kept only in their browser. A visitor adds a Species to it; the site never adds one by itself, since a Verdict can be wrong.
_Avoid_: History, log

**Sighting**:
One Species in the Notebook, with when it was first and last recorded, how many times, a small thumbnail of the first photo, and the visitor's optional note and place.
_Avoid_: Entry, record

**Export**:
A copy of the Notebook saved as a file: JSON (the full backup, thumbnails included, which Import reads back exactly) or CSV (for spreadsheets, without thumbnails).
_Avoid_: Backup file, dump

**Import**:
Reading a JSON Export back into the Notebook, either replacing it or merging into it by Species. A file with any problem is rejected whole.

**Share card**:
A PNG picture of a named Verdict (photo, Species, Confidence, date, "Field Guide" branding) that the visitor can share or save.
_Avoid_: Screenshot, image export

### Data

**Split**:
Which part of the data a photo belongs to: train (fits the model), val (chooses settings and the Threshold) or test (measured once, at export). Test is CUB's official test split; val is 10% of CUB's official train split.
