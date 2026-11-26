import { describe, expect, it } from "vitest";
import { initialCrop, minCropSize, moveCrop, resizeCrop, scaleCrop, toRegion } from "../src/crop";

// A 400x300 photo: the shorter side is 300, so a crop can be at most 300 px.
const W = 400;
const H = 300;

describe("initialCrop", () => {
  it("is a centred square, 60% of the shorter side", () => {
    expect(initialCrop(W, H)).toEqual({ x: 110, y: 60, size: 180 });
  });

  it("works for portrait photos too", () => {
    expect(initialCrop(300, 400)).toEqual({ x: 60, y: 110, size: 180 });
  });
});

describe("minCropSize", () => {
  it("is a tenth of the shorter side, but never under 16 px", () => {
    expect(minCropSize(W, H)).toBe(30);
    expect(minCropSize(100, 80)).toBe(16);
  });

  it("never exceeds the shorter side of a tiny photo", () => {
    expect(minCropSize(10, 12)).toBe(10);
  });
});

describe("moveCrop", () => {
  const start = { x: 100, y: 100, size: 100 };

  it("moves by the given offset", () => {
    expect(moveCrop(start, 20, -30, W, H)).toEqual({ x: 120, y: 70, size: 100 });
  });

  it("stops at the photo's edges", () => {
    expect(moveCrop(start, -500, 500, W, H)).toEqual({ x: 0, y: 200, size: 100 });
    expect(moveCrop(start, 500, -500, W, H)).toEqual({ x: 300, y: 0, size: 100 });
  });
});

describe("resizeCrop", () => {
  const start = { x: 100, y: 100, size: 100 };

  it("grows from the bottom-right corner, keeping the top-left corner put", () => {
    expect(resizeCrop(start, "se", 40, 10, W, H)).toEqual({ x: 100, y: 100, size: 140 });
  });

  it("follows whichever axis moved further, so it stays square", () => {
    expect(resizeCrop(start, "se", 5, 30, W, H)).toEqual({ x: 100, y: 100, size: 130 });
    expect(resizeCrop(start, "se", -20, 0, W, H)).toEqual({ x: 100, y: 100, size: 80 });
  });

  it("grows from the top-left corner, keeping the bottom-right corner put", () => {
    expect(resizeCrop(start, "nw", -50, -20, W, H)).toEqual({ x: 50, y: 50, size: 150 });
  });

  it("handles the other two corners", () => {
    expect(resizeCrop(start, "ne", 30, 0, W, H)).toEqual({ x: 100, y: 70, size: 130 });
    expect(resizeCrop(start, "sw", 0, 30, W, H)).toEqual({ x: 70, y: 100, size: 130 });
  });

  it("stops growing at the photo's edge", () => {
    // Top-left is anchored at (100, 100); the bottom edge is 200 px away.
    expect(resizeCrop(start, "se", 500, 500, W, H)).toEqual({ x: 100, y: 100, size: 200 });
    // Bottom-right is anchored at (200, 200); the top and left edges are 200 px away.
    expect(resizeCrop(start, "nw", -500, -500, W, H)).toEqual({ x: 0, y: 0, size: 200 });
  });

  it("stops shrinking at the minimum size", () => {
    expect(resizeCrop(start, "se", -500, -500, W, H)).toEqual({ x: 100, y: 100, size: 30 });
    expect(resizeCrop(start, "nw", 500, 500, W, H)).toEqual({ x: 170, y: 170, size: 30 });
  });
});

describe("scaleCrop", () => {
  it("grows and shrinks around the centre", () => {
    expect(scaleCrop({ x: 100, y: 100, size: 100 }, 20, W, H)).toEqual({ x: 90, y: 90, size: 120 });
    expect(scaleCrop({ x: 100, y: 100, size: 100 }, -20, W, H)).toEqual({ x: 110, y: 110, size: 80 });
  });

  it("slides back inside the photo when growing near an edge", () => {
    expect(scaleCrop({ x: 0, y: 0, size: 100 }, 40, W, H)).toEqual({ x: 0, y: 0, size: 140 });
  });

  it("is limited to the shorter side and the minimum size", () => {
    expect(scaleCrop({ x: 100, y: 0, size: 280 }, 100, W, H)).toEqual({ x: 90, y: 0, size: 300 });
    expect(scaleCrop({ x: 100, y: 100, size: 40 }, -100, W, H)).toEqual({ x: 105, y: 105, size: 30 });
  });
});

describe("toRegion", () => {
  it("rounds to whole photo pixels and stays inside the photo", () => {
    expect(toRegion({ x: 10.4, y: 20.6, size: 99.7 }, W, H)).toEqual({ x: 10, y: 21, width: 100, height: 100 });
    expect(toRegion({ x: 300.6, y: 200.6, size: 99.6 }, W, H)).toEqual({ x: 300, y: 200, width: 100, height: 100 });
  });
});
