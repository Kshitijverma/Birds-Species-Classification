// Runs preprocessed photos through the model with onnxruntime-web, the runtime
// the site ships, so training/export.py measures what visitors actually get.
// (int8 kernels round slightly differently here than in native onnxruntime.)
//
// Usage: node scripts/score.ts <model.onnx> <inputs.bin> <outputs.json> [batch]
//   inputs.bin:   float32 little-endian, N x 3 x S x S (training/preprocess.py output)
//   outputs.json: {"probs": N arrays of Confidences, "distance": N numbers, "ms": per-run times}
//   batch:        photos per run (default 1). The int8 model quantises each run's
//                 activations together, so a batch of 2 differs slightly from two
//                 runs of 1: score the way the site runs.
import { readFileSync, writeFileSync } from "node:fs";
import * as ort from "onnxruntime-web/wasm";

const [modelPath, inputPath, outputPath, batchArg = "1"] = process.argv.slice(2);
if (!modelPath || !inputPath || !outputPath) {
  console.error("usage: node scripts/score.ts <model.onnx> <inputs.bin> <outputs.json> [batch]");
  process.exit(2);
}
const batch = Number(batchArg);

ort.env.wasm.numThreads = 1; // multi-threaded wasm needs fetch, unavailable for local files in Node
const session = await ort.InferenceSession.create(readFileSync(modelPath));
const size = session.inputMetadata[0].isTensor ? Number(session.inputMetadata[0].shape[3]) : NaN;
const perPhoto = 3 * size * size;
const buf = readFileSync(inputPath);
const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const probs: number[][] = [];
const distance: number[] = [];
const ms: number[] = [];
for (let i = 0; i * perPhoto < all.length; i += batch) {
  const input = all.slice(i * perPhoto, (i + batch) * perPhoto);
  const n = input.length / perPhoto;
  const start = performance.now();
  const out = await session.run({ input: new ort.Tensor("float32", input, [n, 3, size, size]) });
  ms.push(performance.now() - start);
  const p = out.probs.data as Float32Array;
  const species = p.length / n;
  for (let k = 0; k < n; k++) probs.push(Array.from(p.subarray(k * species, (k + 1) * species)));
  distance.push(...Array.from(out.distance.data as Float32Array));
}
writeFileSync(outputPath, JSON.stringify({ probs, distance, ms }));
