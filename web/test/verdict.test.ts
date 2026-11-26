import { describe, expect, it } from "vitest";
import { verdict } from "../src/verdict";

const SPECIES = ["Blue Jay", "Northern Cardinal", "Painted Bunting", "Cedar Waxwing", "Rock Wren"];

describe("verdict", () => {
  it("names the most confident species and lists the next two as also possible", () => {
    expect(verdict([0.05, 0.8, 0.03, 0.1, 0.02], SPECIES, 0.5)).toEqual({
      kind: "species",
      species: "Northern Cardinal",
      confidence: 0.8,
      alsoPossible: [
        { species: "Cedar Waxwing", confidence: 0.1 },
        { species: "Blue Jay", confidence: 0.05 },
      ],
    });
  });

  it("says can't tell below the threshold, with the three closest matches", () => {
    expect(verdict([0.3, 0.25, 0.2, 0.15, 0.1], SPECIES, 0.5)).toEqual({
      kind: "cant-tell",
      closest: [
        { species: "Blue Jay", confidence: 0.3 },
        { species: "Northern Cardinal", confidence: 0.25 },
        { species: "Painted Bunting", confidence: 0.2 },
      ],
    });
  });

  it("names a species whose confidence equals the threshold", () => {
    expect(verdict([0.5, 0.2, 0.1, 0.1, 0.1], SPECIES, 0.5).kind).toBe("species");
  });
});
