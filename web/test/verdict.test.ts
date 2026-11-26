import { describe, expect, it } from "vitest";
import { averageBatch, verdict } from "../src/verdict";

const SPECIES = ["Blue Jay", "Northern Cardinal", "Painted Bunting", "Cedar Waxwing", "Rock Wren"];
const RULES = { species: SPECIES, threshold: 0.5, maxDistance: 1 };
const NEAR = 0.6;

describe("verdict", () => {
  it("names the most confident species and lists the next two as also possible", () => {
    expect(verdict({ confidences: [0.05, 0.8, 0.03, 0.1, 0.02], distance: NEAR }, RULES)).toEqual({
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
    expect(verdict({ confidences: [0.3, 0.25, 0.2, 0.15, 0.1], distance: NEAR }, RULES)).toEqual({
      kind: "cant-tell",
      closest: [
        { species: "Blue Jay", confidence: 0.3 },
        { species: "Northern Cardinal", confidence: 0.25 },
        { species: "Painted Bunting", confidence: 0.2 },
      ],
    });
  });

  it("names a species whose confidence equals the threshold", () => {
    expect(verdict({ confidences: [0.5, 0.2, 0.1, 0.1, 0.1], distance: NEAR }, RULES).kind).toBe("species");
  });

  it("says not a bird I know when the photo is further than the max distance from every species", () => {
    expect(verdict({ confidences: [0.05, 0.8, 0.03, 0.1, 0.02], distance: 1.2 }, RULES)).toEqual({
      kind: "not-a-bird",
    });
  });

  it("still judges a photo exactly at the max distance by its confidence", () => {
    expect(verdict({ confidences: [0.05, 0.8, 0.03, 0.1, 0.02], distance: 1 }, RULES).kind).toBe("species");
  });
});

describe("averageBatch", () => {
  it("averages the photo and its mirror image into one model output", () => {
    const out = averageBatch({ probs: [0.6, 0.4, 0.2, 0.8], distance: [0.5, 0.7] });
    const [a, b] = Array.from(out.confidences);
    expect(out.confidences).toHaveLength(2);
    expect(a).toBeCloseTo(0.4);
    expect(b).toBeCloseTo(0.6);
    expect(out.distance).toBeCloseTo(0.6);
  });

  it("passes a batch of one through unchanged", () => {
    const out = averageBatch({ probs: [0.3, 0.7], distance: [0.9] });
    expect(Array.from(out.confidences)).toEqual([0.3, 0.7]);
    expect(out.distance).toBe(0.9);
  });
});
