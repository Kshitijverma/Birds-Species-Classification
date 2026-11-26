/**
 * The Notebook's data, as pure functions: the stored shape and its migration,
 * export to JSON and CSV, strict import validation, and merging. No DOM or
 * storage access here; notebook.ts wires these to localStorage.
 */

/** One Species in the visitor's Notebook. */
export interface Sighting {
  species: string;
  firstSeen: string; // ISO date-time
  lastSeen: string;
  count: number;
  thumb: string; // small JPEG data URL of the first photo
  note?: string; // optional, never stored empty
  place?: string;
}

export const KEY_V1 = "field-notebook-v1";
export const KEY_V2 = "field-notebook-v2";
const VERSION = 2;

interface StoredV2 {
  version: 2;
  sightings: Sighting[];
}

export function storedShape(sightings: Sighting[]): StoredV2 {
  return { version: VERSION, sightings };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Lenient: storage is our own data, so keep what looks like a Sighting and drop the rest. */
function fromStorage(v: unknown): Sighting | null {
  if (!isObject(v) || typeof v.species !== "string" || !v.species) return null;
  const s: Sighting = {
    species: v.species,
    firstSeen: typeof v.firstSeen === "string" ? v.firstSeen : "",
    lastSeen: typeof v.lastSeen === "string" ? v.lastSeen : "",
    count: typeof v.count === "number" && v.count > 0 ? v.count : 1,
    thumb: typeof v.thumb === "string" ? v.thumb : "",
  };
  if (!s.lastSeen) s.lastSeen = s.firstSeen;
  if (typeof v.note === "string" && v.note) s.note = v.note;
  if (typeof v.place === "string" && v.place) s.place = v.place;
  return s;
}

function parseList(raw: string | null, unwrap: (v: unknown) => unknown): Sighting[] | null {
  if (raw === null) return null;
  try {
    const list = unwrap(JSON.parse(raw));
    if (!Array.isArray(list)) return null;
    return list.map(fromStorage).filter((s): s is Sighting => s !== null);
  } catch {
    return null;
  }
}

/**
 * The Notebook from storage: the v2 shape if present and readable, else the
 * v1 array (migrated as is: v1 Sightings are v2 Sightings without a note or place).
 */
export function loadStored(v2raw: string | null, v1raw: string | null): Sighting[] {
  return (
    parseList(v2raw, (v) => (isObject(v) && v.version === VERSION ? v.sightings : null)) ??
    parseList(v1raw, (v) => v) ??
    []
  );
}

export const NOTE_MAX = 1000;
export const PLACE_MAX = 120;

/** A Sighting with its note and/or place edited: trimmed, capped, and removed when empty. */
export function annotate(s: Sighting, edit: { note?: string; place?: string }): Sighting {
  const next = { ...s };
  for (const [field, max] of [["note", NOTE_MAX], ["place", PLACE_MAX]] as const) {
    const value = edit[field];
    if (value === undefined) continue;
    const text = value.trim().slice(0, max);
    if (text) next[field] = text;
    else delete next[field];
  }
  return next;
}

const CSV_COLUMNS = ["species", "first_seen", "last_seen", "count", "place", "note"];

/** One CSV field (RFC 4180), with formula-like text prefixed by ' so spreadsheets show it as text. */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The Notebook as CSV for spreadsheets. Thumbnails are left out; JSON is the full backup. */
export function toCsv(sightings: Sighting[]): string {
  const rows = sightings.map((s) =>
    [s.species, s.firstSeen, s.lastSeen, String(s.count), s.place ?? "", s.note ?? ""].map(csvField).join(","),
  );
  return [CSV_COLUMNS.join(","), ...rows].map((r) => `${r}\r\n`).join("");
}

const FORMAT = "field-guide-notebook";

/** The Notebook as a JSON backup file: everything needed to restore it, thumbnails included. */
export function toJson(sightings: Sighting[], now = new Date()): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: now.toISOString(), sightings }, null, 2);
}

export type ImportResult = { ok: true; sightings: Sighting[] } | { ok: false; errors: string[] };

const FIELDS = new Set(["species", "firstSeen", "lastSeen", "count", "thumb", "note", "place"]);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const THUMB_MAX = 1_000_000;
const SPECIES_MAX = 200;
const MAX_ERRORS = 10;

const isIso = (v: unknown): v is string => typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(v));
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/**
 * Reads a JSON export strictly: every problem is reported, by sighting and
 * field, and nothing is imported unless the whole file is valid.
 * `known` (the 200 Species names), when given, also rejects unknown species.
 */
export function parseImport(text: string, known?: Set<string>): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["This file isn't valid JSON."] };
  }
  if (!isObject(data) || data.format !== FORMAT) {
    return { ok: false, errors: ["This isn't a Field Guide notebook export."] };
  }
  if (data.version !== VERSION) {
    return { ok: false, errors: [`This export is notebook version ${JSON.stringify(data.version)}; this site reads version ${VERSION}.`] };
  }
  if (!Array.isArray(data.sightings)) {
    return { ok: false, errors: ["The export has no list of sightings."] };
  }

  const errors: string[] = [];
  const sightings: Sighting[] = [];
  const seen = new Set<string>();
  data.sightings.forEach((item: unknown, i: number) => {
    if (!isObject(item)) {
      errors.push(`Sighting ${i + 1}: must be an object.`);
      return;
    }
    const label = `Sighting ${i + 1}${isText(item.species, SPECIES_MAX) ? ` (${item.species})` : ""}`;
    const problems: string[] = [];
    for (const key of Object.keys(item)) if (!FIELDS.has(key)) problems.push(`unknown field ${JSON.stringify(key)}.`);
    if (!isText(item.species, SPECIES_MAX)) problems.push("species must be a non-empty name.");
    if (!isIso(item.firstSeen)) problems.push("firstSeen must be an ISO date-time.");
    if (!isIso(item.lastSeen)) problems.push("lastSeen must be an ISO date-time.");
    if (!Number.isInteger(item.count) || (item.count as number) < 1) problems.push("count must be a whole number of at least 1.");
    if (typeof item.thumb !== "string" || item.thumb.length > THUMB_MAX || !DATA_URL.test(item.thumb)) {
      problems.push("thumb must be an image data URL.");
    }
    if ("note" in item && !isText(item.note, NOTE_MAX)) problems.push(`note must be non-empty text of at most ${NOTE_MAX} characters.`);
    if ("place" in item && !isText(item.place, PLACE_MAX)) problems.push(`place must be non-empty text of at most ${PLACE_MAX} characters.`);
    if (isIso(item.firstSeen) && isIso(item.lastSeen) && Date.parse(item.lastSeen) < Date.parse(item.firstSeen)) {
      problems.push("lastSeen is before firstSeen.");
    }
    if (typeof item.species === "string" && item.species) {
      if (seen.has(item.species)) problems.push(`${item.species} appears more than once.`);
      else if (known && !known.has(item.species)) problems.push(`${item.species} isn't one of the 200 species.`);
      seen.add(item.species);
    }
    errors.push(...problems.map((p) => `${label}: ${p}`));
    if (problems.length === 0) {
      const s: Sighting = {
        species: item.species as string,
        firstSeen: item.firstSeen as string,
        lastSeen: item.lastSeen as string,
        count: item.count as number,
        thumb: item.thumb as string,
      };
      if (item.note !== undefined) s.note = item.note as string;
      if (item.place !== undefined) s.place = item.place as string;
      sightings.push(s);
    }
  });

  if (errors.length > MAX_ERRORS) {
    const more = errors.length - MAX_ERRORS;
    return { ok: false, errors: [...errors.slice(0, MAX_ERRORS), `…and ${more} more problem${more === 1 ? "" : "s"}.`] };
  }
  return errors.length ? { ok: false, errors } : { ok: true, sightings };
}

const time = (iso: string) => Date.parse(iso) || 0;

function combine(mine: Sighting, theirs: Sighting): Sighting {
  const first = time(theirs.firstSeen) < time(mine.firstSeen) ? theirs : mine;
  const s: Sighting = {
    species: mine.species,
    firstSeen: first.firstSeen,
    lastSeen: time(theirs.lastSeen) > time(mine.lastSeen) ? theirs.lastSeen : mine.lastSeen,
    count: Math.max(mine.count, theirs.count),
    thumb: first.thumb,
  };
  const note = mine.note ?? theirs.note;
  const place = mine.place ?? theirs.place;
  if (note !== undefined) s.note = note;
  if (place !== undefined) s.place = place;
  return s;
}

const same = (a: Sighting, b: Sighting) =>
  [...FIELDS].every((f) => a[f as keyof Sighting] === b[f as keyof Sighting]);

/**
 * Merges an imported notebook into mine, by Species. Counts take the higher
 * side rather than adding up, so importing the same backup twice changes nothing.
 * My note and place win; the import only fills ones I don't have.
 */
export function merge(mine: Sighting[], imported: Sighting[]): { sightings: Sighting[]; added: number; updated: number } {
  const bySpecies = new Map(mine.map((s) => [s.species, s]));
  let added = 0;
  let updated = 0;
  for (const theirs of imported) {
    const current = bySpecies.get(theirs.species);
    if (!current) {
      bySpecies.set(theirs.species, theirs);
      added++;
      continue;
    }
    const combined = combine(current, theirs);
    if (!same(combined, current)) {
      bySpecies.set(theirs.species, combined);
      updated++;
    }
  }
  const sightings = [...bySpecies.values()].sort((a, b) => time(b.firstSeen) - time(a.firstSeen));
  return { sightings, added, updated };
}
