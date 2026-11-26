import { describe, expect, it } from "vitest";
import { annotate, loadStored, merge, parseImport, storedShape, toCsv, toJson, type Sighting } from "../src/notebookData";

const THUMB = "data:image/jpeg;base64,/9j/AAAA";
const jay: Sighting = {
  species: "Blue Jay", firstSeen: "2026-05-01T08:00:00.000Z", lastSeen: "2026-05-03T09:30:00.000Z", count: 2, thumb: THUMB,
};
const wren: Sighting = {
  species: "Rock Wren", firstSeen: "2026-04-10T12:00:00.000Z", lastSeen: "2026-04-10T12:00:00.000Z", count: 1, thumb: THUMB,
};

describe("loadStored (versioned storage)", () => {
  it("is empty when nothing is stored", () => {
    expect(loadStored(null, null)).toEqual([]);
  });

  it("migrates a v1 array unchanged, entries keep working without a note or place", () => {
    expect(loadStored(null, JSON.stringify([jay, wren]))).toEqual([jay, wren]);
  });

  it("prefers v2 over v1 once migrated", () => {
    const v2 = JSON.stringify(storedShape([{ ...wren, note: "on the scree" }]));
    expect(loadStored(v2, JSON.stringify([jay]))).toEqual([{ ...wren, note: "on the scree" }]);
  });

  it("round-trips note and place through the v2 shape", () => {
    const s = [{ ...jay, note: "two at the feeder", place: "Back garden" }, wren];
    expect(loadStored(JSON.stringify(storedShape(s)), null)).toEqual(s);
  });

  it("falls back to v1 when v2 is corrupt, and to empty when both are", () => {
    expect(loadStored("{not json", JSON.stringify([jay]))).toEqual([jay]);
    expect(loadStored("{not json", "also not")).toEqual([]);
  });

  it("drops stored entries that are not sightings rather than crashing", () => {
    expect(loadStored(null, JSON.stringify([jay, null, { species: 4 }, "x"]))).toEqual([jay]);
  });
});

describe("annotate (inline note and place)", () => {
  it("sets a trimmed note and place", () => {
    expect(annotate(jay, { note: "  pair at feeder ", place: " Back garden\n" })).toEqual({
      ...jay, note: "pair at feeder", place: "Back garden",
    });
  });

  it("clears a field that is emptied, so nothing is stored empty", () => {
    const noted = { ...jay, note: "x", place: "y" };
    expect(annotate(noted, { note: "   " })).toEqual({ ...jay, place: "y" });
    expect(annotate(noted, { place: "" })).toEqual({ ...jay, note: "x" });
  });

  it("leaves fields it is not given alone and does not mutate the input", () => {
    const noted = { ...jay, note: "x" };
    expect(annotate(noted, { place: "Pond" })).toEqual({ ...jay, note: "x", place: "Pond" });
    expect(noted).toEqual({ ...jay, note: "x" });
  });

  it("caps long text", () => {
    expect(annotate(jay, { note: "a".repeat(2000) }).note).toHaveLength(1000);
    expect(annotate(jay, { place: "b".repeat(500) }).place).toHaveLength(120);
  });
});

describe("toCsv", () => {
  it("writes a header and one CRLF-terminated row per sighting, without thumbnails", () => {
    expect(toCsv([wren])).toBe(
      "species,first_seen,last_seen,count,place,note\r\n" +
      "Rock Wren,2026-04-10T12:00:00.000Z,2026-04-10T12:00:00.000Z,1,,\r\n",
    );
  });

  it("is just the header for an empty notebook", () => {
    expect(toCsv([])).toBe("species,first_seen,last_seen,count,place,note\r\n");
  });

  it("quotes fields with commas, quotes or line breaks and doubles inner quotes", () => {
    const row = toCsv([{ ...jay, species: "Brewer's Blackbird", place: "Lake, north shore", note: 'said "hi"\nthen left' }])
      .split("\r\n")[1];
    expect(row).toBe(
      "Brewer's Blackbird,2026-05-01T08:00:00.000Z,2026-05-03T09:30:00.000Z,2," +
      '"Lake, north shore","said ""hi""\nthen left"',
    );
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    const row = toCsv([{ ...jay, place: "=HYPERLINK(1)", note: "+1 -2 @x" }]).split("\r\n")[1];
    expect(row.endsWith(`,'=HYPERLINK(1),'+1 -2 @x`)).toBe(true);
  });
});

describe("toJson / parseImport", () => {
  const NOW = new Date("2026-06-01T10:00:00.000Z");
  const notebook: Sighting[] = [{ ...jay, note: 'two, "noisy"\non the feeder', place: "Back garden" }, wren];
  const exported = (sightings: unknown[], extra: Record<string, unknown> = {}) =>
    JSON.stringify({ format: "field-guide-notebook", version: 2, exportedAt: NOW.toISOString(), sightings, ...extra });
  const errorsOf = (text: string) => {
    const r = parseImport(text);
    if (r.ok) throw new Error("expected the import to be rejected");
    return r.errors;
  };

  it("exports a labelled, versioned file", () => {
    expect(JSON.parse(toJson(notebook, NOW))).toEqual({
      format: "field-guide-notebook", version: 2, exportedAt: "2026-06-01T10:00:00.000Z", sightings: notebook,
    });
  });

  it("round-trips the notebook exactly", () => {
    expect(parseImport(toJson(notebook, NOW))).toEqual({ ok: true, sightings: notebook });
    expect(parseImport(toJson([], NOW))).toEqual({ ok: true, sightings: [] });
  });

  it("rejects text that is not JSON, or JSON that is not a notebook export", () => {
    expect(errorsOf("hello")).toEqual(["This file isn't valid JSON."]);
    expect(errorsOf("[1,2]")).toEqual(["This isn't a Field Guide notebook export."]);
    expect(errorsOf(JSON.stringify({ sightings: [] }))).toEqual(["This isn't a Field Guide notebook export."]);
  });

  it("rejects other versions by name", () => {
    expect(errorsOf(exported([], { version: 3 }))).toEqual([
      "This export is notebook version 3; this site reads version 2.",
    ]);
  });

  it("rejects a missing sightings list", () => {
    expect(errorsOf(exported([], { sightings: "nope" }))).toEqual(["The export has no list of sightings."]);
  });

  it("names the sighting and field for each problem", () => {
    expect(errorsOf(exported([
      { ...jay, count: 0 },
      { ...wren, firstSeen: "yesterday", thumb: "https://example.com/x.jpg" },
      { ...wren, species: "" },
      "a string",
    ]))).toEqual([
      "Sighting 1 (Blue Jay): count must be a whole number of at least 1.",
      "Sighting 2 (Rock Wren): firstSeen must be an ISO date-time.",
      "Sighting 2 (Rock Wren): thumb must be an image data URL.",
      "Sighting 3: species must be a non-empty name.",
      "Sighting 4: must be an object.",
    ]);
  });

  it("rejects unknown fields, empty or overlong notes, and last seen before first seen", () => {
    expect(errorsOf(exported([
      { ...jay, colour: "blue", note: "" },
      { ...wren, place: "p".repeat(121), lastSeen: "2026-04-01T00:00:00.000Z" },
    ]))).toEqual([
      "Sighting 1 (Blue Jay): unknown field \"colour\".",
      "Sighting 1 (Blue Jay): note must be non-empty text of at most 1000 characters.",
      "Sighting 2 (Rock Wren): place must be non-empty text of at most 120 characters.",
      "Sighting 2 (Rock Wren): lastSeen is before firstSeen.",
    ]);
  });

  it("rejects the same species twice", () => {
    expect(errorsOf(exported([jay, wren, jay]))).toEqual(["Sighting 3 (Blue Jay): Blue Jay appears more than once."]);
  });

  it("checks species against the known list when given one", () => {
    const r = parseImport(exported([jay, { ...wren, species: "Dodo" }]), new Set(["Blue Jay", "Rock Wren"]));
    expect(r).toEqual({ ok: false, errors: ["Sighting 2 (Dodo): Dodo isn't one of the 200 species."] });
  });

  it("caps a long error list", () => {
    const bad = Array.from({ length: 30 }, (_, i) => ({ ...jay, species: `Bird ${i}`, count: -1 }));
    const errors = errorsOf(exported(bad));
    expect(errors).toHaveLength(11);
    expect(errors[10]).toBe("…and 20 more problems.");
  });
});

describe("merge", () => {
  const cardinal: Sighting = {
    species: "Northern Cardinal", firstSeen: "2026-05-20T07:00:00.000Z", lastSeen: "2026-05-20T07:00:00.000Z", count: 1, thumb: THUMB,
  };

  it("adds new species and keeps the notebook newest-first", () => {
    expect(merge([jay], [wren, cardinal])).toEqual({ sightings: [cardinal, jay, wren], added: 2, updated: 0 });
  });

  it("is a no-op when importing the same notebook again", () => {
    const mine = [{ ...jay, note: "n" }, wren];
    expect(merge(mine, mine)).toEqual({ sightings: mine, added: 0, updated: 0 });
  });

  it("combines a species on both sides: earliest first seen with its photo, latest last seen, higher count", () => {
    const mine = { ...jay, firstSeen: "2026-05-02T00:00:00.000Z", count: 3, thumb: "data:image/jpeg;base64,MINE" };
    const theirs = { ...jay, lastSeen: "2026-05-01T09:00:00.000Z", count: 1, thumb: "data:image/jpeg;base64,THEIRS" };
    expect(merge([mine], [theirs])).toEqual({
      sightings: [{ ...jay, firstSeen: jay.firstSeen, lastSeen: jay.lastSeen, count: 3, thumb: "data:image/jpeg;base64,THEIRS" }],
      added: 0,
      updated: 1,
    });
  });

  it("keeps my note and place, filling them from the import only when mine are missing", () => {
    const mine = { ...jay, note: "mine" };
    const theirs = { ...jay, note: "theirs", place: "Their pond" };
    expect(merge([mine], [theirs]).sightings).toEqual([{ ...jay, note: "mine", place: "Their pond" }]);
  });
});
