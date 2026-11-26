import * as ort from "onnxruntime-web/wasm";
import { INPUT_SIZE, preprocess } from "./preprocess";
import { verdict, type Verdict } from "./verdict";

/** Longest side photos are scaled to before preprocessing, roughly the size of the training photos. */
const MAX_SIDE = 512;
const BASE = import.meta.env.BASE_URL;

export interface Labels {
  species: string[];
  threshold: number;
}

let loading: Promise<{ session: ort.InferenceSession; labels: Labels }> | null = null;

/** Load the model once, on first use. */
export function load() {
  loading ??= (async () => {
    const [session, labels] = await Promise.all([
      ort.InferenceSession.create(`${BASE}model/model.onnx`, { executionProviders: ["wasm"] }),
      fetch(`${BASE}model/labels.json`).then((r) => r.json() as Promise<Labels>),
    ]);
    return { session, labels };
  })();
  loading.catch(() => (loading = null)); // let a later attempt retry
  return loading;
}

/** Draw the photo at most MAX_SIDE px on its longest side and read back RGBA pixels. */
async function readPixels(photo: Blob) {
  const bitmap = await createImageBitmap(photo);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available in this browser.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return ctx.getImageData(0, 0, width, height);
}

export async function identify(photo: Blob): Promise<Verdict> {
  const [{ session, labels }, pixels] = await Promise.all([load(), readPixels(photo)]);
  const input = new ort.Tensor("float32", preprocess(pixels), [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const out = await session.run({ input });
  return verdict(out.probs.data as Float32Array, labels.species, labels.threshold);
}
