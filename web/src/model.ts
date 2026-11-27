// The page's side of the model: identify() hands the photo to src/model.worker.ts, which loads
// ONNX Runtime and the model on first use and does all the pixel work and inference, so the
// page stays responsive while a photo is scored.
import type { Region } from "./crop";
import type { Verdict } from "./verdict";
import type { IdentifyRequest, IdentifyResponse } from "./model.worker";

const pending = new Map<number, { resolve: (v: Verdict) => void; reject: (e: Error) => void }>();
let nextId = 0;
let worker: Worker | null = null;

/** Start the worker on first use; if it ever fails, fail what it had and start a fresh one next time. */
function getWorker() {
  if (worker) return worker;
  const w = new Worker(new URL("./model.worker.ts", import.meta.url), { type: "module", name: "model" });
  w.addEventListener("message", (e: MessageEvent<IdentifyResponse>) => {
    const call = pending.get(e.data.id);
    if (!call) return;
    pending.delete(e.data.id);
    if ("error" in e.data) call.reject(new Error(e.data.error));
    else call.resolve(e.data.verdict);
  });
  const fail = (message: string) => {
    w.terminate();
    if (worker === w) worker = null;
    for (const call of pending.values()) call.reject(new Error(message));
    pending.clear();
  };
  w.addEventListener("error", (e) => {
    e.preventDefault();
    fail(e.message || "The model couldn't start in this browser.");
  });
  w.addEventListener("messageerror", () => fail("The model couldn't read that photo."));
  worker = w;
  return w;
}

/** Identify the bird in the photo, or only in `region` of it (in photo pixels) when the visitor cropped. */
export function identify(photo: Blob, region?: Region): Promise<Verdict> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const root = new URL(import.meta.env.BASE_URL, document.baseURI).href;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, root, photo, region } satisfies IdentifyRequest);
  });
}
