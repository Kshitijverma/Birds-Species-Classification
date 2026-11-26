import { download, today } from "./download";

/**
 * The share card: a field card (photo, Species, Confidence, date) drawn on a
 * canvas as a PNG in the "Field Guide" style, for sharing or saving. Always in
 * the light, paper palette, since it leaves the site.
 */

const W = 1080;
const H = 1350;
const C = {
  paper: "#f3ede0",
  dots: "#d8cfba",
  card: "#fbf8f1",
  ink: "#23271f",
  soft: "#5d6156",
  track: "#ebe3d1",
  accent: "#b4432b",
  onAccent: "#fbf8f1",
  tape: "rgba(222, 196, 120, 0.72)",
};
const SERIF = `Fraunces, Georgia, "Times New Roman", serif`;
const SANS = `Inter, system-ui, -apple-system, "Segoe UI", sans-serif`;
const MONO = `"IBM Plex Mono", ui-monospace, Menlo, monospace`;
const SITE = "kshitijverma.github.io/Birds-Species-Classification";

export interface ShareCardInput {
  species: string;
  confidence: number;
  photo: Blob;
  date?: Date;
}

const pct = (c: number) => (c >= 0.995 ? ">99%" : c < 0.01 ? "<1%" : `${Math.round(c * 100)}%`);

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load(`700 80px ${SERIF}`),
      document.fonts.load(`600 40px ${SERIF}`),
      document.fonts.load(`500 24px ${MONO}`),
      document.fonts.load(`500 28px ${SANS}`),
    ]);
  } catch {
    // Fallback fonts are fine.
  }
}

/** Breaks text into at most `max` lines that fit `width`, shrinking the font if it would need more. */
function fitLines(ctx: CanvasRenderingContext2D, text: string, width: number, size: number, max: number) {
  for (let s = size; ; s -= 6) {
    ctx.font = `700 ${s}px ${SERIF}`;
    const lines: string[] = [];
    for (const word of text.split(" ")) {
      const last = lines[lines.length - 1];
      if (last && ctx.measureText(`${last} ${word}`).width <= width) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    if (lines.length <= max || s <= 40) return { lines, size: s };
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export async function renderShareCard({ species, confidence, photo, date = new Date() }: ShareCardInput): Promise<Blob> {
  const [bitmap] = await Promise.all([createImageBitmap(photo), fontsReady()]);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas isn't available.");

  // paper with a dot grid
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.dots;
  for (let y = 18; y < H; y += 36) for (let x = 18; x < W; x += 36) ctx.fillRect(x, y, 2, 2);

  // the card
  const cx = 60, cy = 60, cw = W - 120, ch = H - 200;
  ctx.save();
  ctx.shadowColor = "rgba(60, 45, 20, 0.16)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = C.card;
  roundRect(ctx, cx, cy, cw, ch, 28);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, cx, cy, cw, ch, 28);
  ctx.clip();
  ctx.fillStyle = C.accent;
  ctx.fillRect(cx, cy, 12, ch);
  ctx.restore();

  // the taped-in snapshot, cropped to 4:3
  const px = cx + 70, py = cy + 70, pw = cw - 120, ph = Math.round(pw * 0.72);
  ctx.save();
  ctx.translate(px + pw / 2, py + ph / 2);
  ctx.rotate((-1.2 * Math.PI) / 180);
  ctx.shadowColor = "rgba(60, 45, 20, 0.2)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(-pw / 2 - 16, -ph / 2 - 16, pw + 32, ph + 52);
  ctx.shadowColor = "transparent";
  const scale = Math.max(pw / bitmap.width, ph / bitmap.height);
  const sw = pw / scale, sh = ph / scale;
  ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, -pw / 2, -ph / 2, pw, ph);
  ctx.rotate((3.2 * Math.PI) / 180);
  ctx.fillStyle = C.tape;
  ctx.fillRect(-90, -ph / 2 - 40, 180, 44);
  ctx.restore();
  bitmap.close();

  // verdict: ring gauge, eyebrow, species
  let y = py + ph + 110;
  const tx = cx + 70;
  const ring = { x: cx + cw - 70 - 90, y: y + 70, r: 78 };
  ctx.lineWidth = 16;
  ctx.lineCap = "round";
  ctx.strokeStyle = C.track;
  ctx.beginPath();
  ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = C.accent;
  ctx.beginPath();
  ctx.arc(ring.x, ring.y, ring.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.005, confidence));
  ctx.stroke();
  ctx.fillStyle = C.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 40px ${MONO}`;
  ctx.fillText(pct(confidence), ring.x, ring.y + 2);
  ctx.font = `500 20px ${MONO}`;
  ctx.fillStyle = C.soft;
  ctx.fillText("CONFIDENCE", ring.x, ring.y + ring.r + 40);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `500 24px ${MONO}`;
  ctx.fillStyle = C.soft;
  ctx.fillText("IDENTIFIED AS", tx, y);
  const textWidth = ring.x - ring.r - 40 - tx;
  const { lines, size } = fitLines(ctx, species, textWidth, 84, 2);
  ctx.fillStyle = C.ink;
  for (const line of lines) {
    y += size * 1.12;
    ctx.fillText(line, tx, y);
  }
  ctx.font = `400 30px ${SANS}`;
  ctx.fillStyle = C.soft;
  ctx.fillText(date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }), tx, y + 60);

  // branding
  const by = H - 70;
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.arc(cx + 30, by, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(cx + 30 - 24, by - 24);
  ctx.scale(1.5, 1.5);
  ctx.fillStyle = C.onAccent;
  ctx.fill(new Path2D("M4 20c4-1 7-5 11-5s5 3 9 2 4-4 4-4-1 7-7 9-12 2-17-2z"));
  ctx.restore();
  ctx.fillStyle = C.ink;
  ctx.font = `700 40px ${SERIF}`;
  ctx.fillText("Field Guide", cx + 80, by + 14);
  ctx.textAlign = "right";
  ctx.font = `400 22px ${SANS}`;
  ctx.fillStyle = C.soft;
  ctx.fillText(SITE, cx + cw, by + 10);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the card."))), "image/png"),
  );
}

export const shareFileName = (species: string, date = new Date()) =>
  `field-guide-${species.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${today(date)}.png`;

/**
 * Shares the PNG with the Web Share API where files can be shared (mostly
 * mobile), else downloads it. Returns what happened.
 */
export async function shareOrDownload(png: Blob, filename: string, text: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([png], filename, { type: "image/png" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Field Guide", text });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // Not allowed here (e.g. no user activation left): fall back to a download.
    }
  }
  download(png, filename);
  return "downloaded";
}
