import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findBySlug, groupByKind, groupOf, slugify, speciesHref, type SpeciesInfo } from "../src/species";

const pub = (p: string) => JSON.parse(readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8"));
const NAMES: string[] = pub("model/labels.json").species;
const INFO: SpeciesInfo[] = pub("species/species.json");

describe("slugify", () => {
  it("lower-cases and hyphenates", () => {
    expect(slugify("Blue Jay")).toBe("blue-jay");
    expect(slugify("Black-and-white Warbler")).toBe("black-and-white-warbler");
  });

  it("drops apostrophes rather than splitting on them", () => {
    expect(slugify("Chuck-will's-widow")).toBe("chuck-wills-widow");
    expect(slugify("LeConte's Sparrow")).toBe("lecontes-sparrow");
  });

  it("gives each of the 200 species its own slug", () => {
    expect(new Set(NAMES.map(slugify)).size).toBe(200);
  });
});

describe("speciesHref", () => {
  it("links to the species page route", () => {
    expect(speciesHref("Brewer's Blackbird")).toBe("#/species/brewers-blackbird");
  });
});

describe("groupByKind", () => {
  it("groups by the last word, pluralised, with singletons under Others", () => {
    expect(groupByKind(["Song Sparrow", "Fox Sparrow", "Bobolink", "Blue Jay", "Green Jay", "Gadwall"])).toEqual([
      ["Jays", ["Blue Jay", "Green Jay"]],
      ["Sparrows", ["Song Sparrow", "Fox Sparrow"]],
      ["Others", ["Bobolink", "Gadwall"]],
    ]);
  });

  it("pluralises -ss as -sses and leaves an -s alone", () => {
    expect(groupByKind(["A Albatross", "B Albatross"])[0][0]).toBe("Albatrosses");
  });
});

describe("groupOf", () => {
  it("returns the same group the species index shows it under", () => {
    expect(groupOf("Song Sparrow", NAMES)).toBe("Sparrows");
    expect(groupOf("Western Wood-Pewee", NAMES)).toBe("Others");
    expect(groupOf("Bobolink", NAMES)).toBe("Others");
  });
});

describe("findBySlug", () => {
  it("finds a species by its slug, or undefined", () => {
    expect(findBySlug(INFO, "blue-jay")?.name).toBe("Blue Jay");
    expect(findBySlug(INFO, "dodo")).toBeUndefined();
  });
});

describe("species.json", () => {
  it("covers all 200 species, in label order, with matching slugs", () => {
    expect(INFO.map((s) => s.name)).toEqual(NAMES);
    for (const s of INFO) expect(s.slug).toBe(slugify(s.name));
  });

  it("has a description, a Wikipedia link and a credited, openly licensed photo for each", () => {
    for (const s of INFO) {
      expect(s.wikipedia.description.length, s.name).toBeGreaterThan(40);
      expect(s.wikipedia.url, s.name).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
      expect(["CC0", "CC BY 4.0", "CC BY-SA 4.0"], s.name).toContain(s.photo.license);
      expect(s.photo.photographer, s.name).not.toBe("");
      expect(s.photo.observation, s.name).toMatch(/^https:\/\/www\.inaturalist\.org\/observations\/\d+$/);
      expect(readFileSync(new URL(`../public/species/${s.photo.file}`, import.meta.url)).length, s.name)
        .toBeGreaterThan(2000);
    }
  });
});
