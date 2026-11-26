// Web Worker that owns ONNX Runtime: it loads the model once, then reads, preprocesses and
// scores each photo, so none of that work blocks the page. src/model.ts is its only client.
import * as ort from "onnxruntime-web/wasm";
import type { Region } from "./crop";
import { INPUT_SIZE, preprocess } from "./preprocess";
import { averageBatch, verdict, type Rules, type Verdict } from "./verdict";

/** Longest side photos are scaled to before preprocessing, roughly the size of the training photos. */
const MAX_SIDE = 512;

// Multi-threaded wasm needs SharedArrayBuffer, so cross-origin isolation, which GitHub Pages
// can't turn on. One thread here keeps ORT from trying (and from warning that it can't).
ort.env.wasm.numThreads = 1;

export interface IdentifyRequest {
  id: number;
  /** The site root as an absolute URL. Relative URLs here would resolve against this script in assets/. */
  root: string;
  photo: Blob;
  region?: Region;
}

export type IdentifyResponse = { id: number; verdict: Verdict } | { id: number; error: string };

/** web/public/model/labels.json: the Species, the rules for a Verdict, and whether to also score the mirror image. */
interface Labels extends Rules {
  flip: boolean;
}

let loading: Promise<{ session: ort.InferenceSession; labels: Labels }> | null = null;

/** Load the model once, on first use. */
function load(root: string) {
  loading ??= (async () => {
    const [session, labels] = await Promise.all([
      ort.InferenceSession.create(new URL("model/model.onnx", root).href, { executionProviders: ["wasm"] }),
      fetch(new URL("model/labels.json", root)).then((r) => r.json() as Promise<Labels>),
    ]);
    return { session, labels };
  })();
  loading.catch(() => (loading = null)); // let a later attempt retry
  return loading;
}

/**
 * Draw the photo (or just `region` of it, in photo pixels) at most MAX_SIDE px
 * on its longest side and read back RGBA pixels.
 */
async function readPixels(photo: Blob, region?: Region) {
  const bitmap = await createImageBitmap(photo);
  const { x, y, width: w, height: h } = region ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available in this browser.");
  ctx.drawImage(bitmap, x, y, w, h, 0, 0, width, height);
  bitmap.close();
  return ctx.getImageData(0, 0, width, height);
}

/** The photo's tensor followed by its mirror image (each row reversed), as one batch of 2. */
function withMirror(x: Float32Array): Float32Array {
  const n = INPUT_SIZE;
  const out = new Float32Array(2 * x.length);
  out.set(x);
  for (let row = 0; row < x.length / n; row++) {
    for (let col = 0; col < n; col++) out[x.length + row * n + col] = x[row * n + n - 1 - col];
  }
  return out;
}

async function identify({ root, photo, region }: IdentifyRequest): Promise<Verdict> {
  const [{ session, labels }, pixels] = await Promise.all([load(root), readPixels(photo, region)]);
  const x = preprocess(pixels);
  // With flip on, the photo and its mirror image run as one batch and their outputs are averaged.
  const batch = labels.flip ? 2 : 1;
  const input = new ort.Tensor("float32", labels.flip ? withMirror(x) : x, [batch, 3, INPUT_SIZE, INPUT_SIZE]);
  const out = await session.run({ input });
  const output = averageBatch({ probs: out.probs.data as Float32Array, distance: out.distance.data as Float32Array });
  return verdict(output, labels);
}

// One photo at a time: a session runs one inference at once anyway.
let queue: Promise<unknown> = Promise.resolve();

addEventListener("message", (e: MessageEvent<IdentifyRequest>) => {
  const { id } = e.data;
  const reply = (r: IdentifyResponse) => postMessage(r);
  queue = queue
    .then(() => identify(e.data))
    .then(
      (v) => reply({ id, verdict: v }),
      (err) => reply({ id, error: err instanceof Error ? err.message : String(err) }),
    );
});
