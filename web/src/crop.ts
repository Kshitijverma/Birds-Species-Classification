/**
 * Geometry for the square crop box a visitor draws over the bird.
 * Everything is in photo pixels (the decoded image's natural size), so the
 * box means the same thing whatever size the photo is shown at.
 */

/** A square: top-left corner and side length, in photo pixels. */
export interface Crop {
  x: number;
  y: number;
  size: number;
}

/** A rectangle in whole photo pixels, as handed to the model. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which corner handle is being dragged. */
export type Corner = "nw" | "ne" | "sw" | "se";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The smallest box allowed: a tenth of the shorter side, at least 16 px (but never more than the photo). */
export function minCropSize(width: number, height: number) {
  const short = Math.min(width, height);
  return Math.min(short, Math.max(16, Math.round(short * 0.1)));
}

/** Where the box starts: centred, 60% of the shorter side. */
export function initialCrop(width: number, height: number): Crop {
  const size = Math.round(Math.min(width, height) * 0.6);
  return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size };
}

/** Move the box by (dx, dy), stopping at the photo's edges. */
export function moveCrop(start: Crop, dx: number, dy: number, width: number, height: number): Crop {
  return {
    x: clamp(start.x + dx, 0, width - start.size),
    y: clamp(start.y + dy, 0, height - start.size),
    size: start.size,
  };
}

/**
 * Drag one corner by (dx, dy) while the opposite corner stays put. The box
 * stays square by following whichever axis moved further.
 */
export function resizeCrop(start: Crop, corner: Corner, dx: number, dy: number, width: number, height: number): Crop {
  const sx = corner.endsWith("e") ? 1 : -1;
  const sy = corner.startsWith("s") ? 1 : -1;
  const ax = sx > 0 ? start.x : start.x + start.size;
  const ay = sy > 0 ? start.y : start.y + start.size;
  const a = dx * sx;
  const b = dy * sy;
  const grow = Math.abs(a) >= Math.abs(b) ? a : b;
  const room = Math.min(sx > 0 ? width - ax : ax, sy > 0 ? height - ay : ay);
  const size = Math.min(room, Math.max(minCropSize(width, height), start.size + grow));
  return { x: sx > 0 ? ax : ax - size, y: sy > 0 ? ay : ay - size, size };
}

/** Grow (or shrink, with a negative delta) the box around its centre, keeping it inside the photo. */
export function scaleCrop(start: Crop, delta: number, width: number, height: number): Crop {
  const size = clamp(start.size + delta, minCropSize(width, height), Math.min(width, height));
  const cx = start.x + start.size / 2;
  const cy = start.y + start.size / 2;
  return moveCrop({ x: cx - size / 2, y: cy - size / 2, size }, 0, 0, width, height);
}

/** The box in whole photo pixels, still inside the photo after rounding. */
export function toRegion(crop: Crop, width: number, height: number): Region {
  const size = clamp(Math.round(crop.size), 1, Math.min(width, height));
  const x = clamp(Math.round(crop.x), 0, width - size);
  const y = clamp(Math.round(crop.y), 0, height - size);
  return { x, y, width: size, height: size };
}
