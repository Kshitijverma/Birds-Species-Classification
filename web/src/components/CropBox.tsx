import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { moveCrop, resizeCrop, scaleCrop, type Corner, type Crop } from "../crop";

const CORNERS: { corner: Corner; label: string }[] = [
  { corner: "nw", label: "top-left" },
  { corner: "ne", label: "top-right" },
  { corner: "sw", label: "bottom-left" },
  { corner: "se", label: "bottom-right" },
];

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

interface Drag {
  pointer: number;
  mode: "move" | Corner;
  x: number;
  y: number;
  start: Crop;
}

/** Where a crop sits over the photo, as CSS percentages. */
export function cropStyle(crop: Crop, width: number, height: number) {
  return {
    left: `${(crop.x / width) * 100}%`,
    top: `${(crop.y / height) * 100}%`,
    width: `${(crop.size / width) * 100}%`,
    height: `${(crop.size / height) * 100}%`,
  };
}

/** Dims the photo outside the crop. Clipped to the photo, unlike the box and its handles. */
export function CropShade({ crop, width, height }: { crop: Crop; width: number; height: number }) {
  return (
    <div className="crop-shade" aria-hidden>
      <div style={cropStyle(crop, width, height)} />
    </div>
  );
}

/**
 * A square crop box laid over the photo. Drag it to move, drag a corner to
 * resize, or press anywhere else on the photo to move it there. Keyboard:
 * arrows move the box (or resize, on a corner), + and - resize, Enter
 * identifies, Escape cancels. Shift makes each step bigger.
 */
export function CropBox({ crop, width, height, onChange, onSubmit, onCancel }: {
  crop: Crop;
  /** The photo's natural size in pixels. */
  width: number;
  height: number;
  onChange: (crop: Crop) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const step = (shift: boolean) => Math.max(1, Math.round(Math.min(width, height) * (shift ? 0.1 : 0.02)));

  /** Photo pixels per screen pixel. */
  const scale = () => width / (root.current?.clientWidth || width);

  function begin(e: PointerEvent, mode: Drag["mode"], start = crop) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    root.current?.setPointerCapture(e.pointerId);
    drag.current = { pointer: e.pointerId, mode, x: e.clientX, y: e.clientY, start };
    (e.currentTarget as HTMLElement).focus();
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const k = scale();
    const dx = (e.clientX - d.x) * k;
    const dy = (e.clientY - d.y) * k;
    onChange(d.mode === "move"
      ? moveCrop(d.start, dx, dy, width, height)
      : resizeCrop(d.start, d.mode, dx, dy, width, height));
  }

  function end(e: PointerEvent) {
    if (drag.current?.pointer === e.pointerId) drag.current = null;
  }

  /** Pressing outside the box re-centres it there, then drags it from there. */
  function onBackdropDown(e: PointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const k = scale();
    const px = (e.clientX - rect.left) * k;
    const py = (e.clientY - rect.top) * k;
    const moved = moveCrop(crop, px - (crop.x + crop.size / 2), py - (crop.y + crop.size / 2), width, height);
    onChange(moved);
    begin(e, "move", moved);
    root.current?.querySelector<HTMLElement>(".crop-box")?.focus();
  }

  function onBoxKey(e: KeyboardEvent) {
    const s = step(e.shiftKey);
    const arrow = ARROWS[e.key];
    if (arrow) onChange(moveCrop(crop, arrow[0] * s, arrow[1] * s, width, height));
    else if (e.key === "+" || e.key === "=") onChange(scaleCrop(crop, s, width, height));
    else if (e.key === "-" || e.key === "_") onChange(scaleCrop(crop, -s, width, height));
    else if (e.key === "Enter") onSubmit();
    else if (e.key === "Escape") onCancel();
    else return;
    e.preventDefault();
  }

  function onHandleKey(e: KeyboardEvent, corner: Corner) {
    const arrow = ARROWS[e.key];
    if (!arrow) return;
    e.preventDefault();
    e.stopPropagation();
    const s = step(e.shiftKey);
    onChange(resizeCrop(crop, corner, arrow[0] * s, arrow[1] * s, width, height));
  }

  return (
    <div
      ref={root}
      className="crop-layer"
      onPointerDown={onBackdropDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <CropShade crop={crop} width={width} height={height} />
      <div
        className="crop-box"
        style={cropStyle(crop, width, height)}
        tabIndex={0}
        role="group"
        aria-roledescription="crop box"
        aria-label={`Crop box, ${Math.round(crop.size)} by ${Math.round(crop.size)} pixels. Arrow keys move it, plus and minus resize it, Enter identifies the crop, Escape cancels.`}
        onPointerDown={(e) => begin(e, "move")}
        onKeyDown={onBoxKey}
      >
        {CORNERS.map(({ corner, label }) => (
          <button
            key={corner}
            type="button"
            className={`crop-handle ${corner}`}
            aria-label={`Resize from the ${label} corner (arrow keys)`}
            onPointerDown={(e) => begin(e, corner)}
            onKeyDown={(e) => onHandleKey(e, corner)}
          />
        ))}
      </div>
    </div>
  );
}
