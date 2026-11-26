import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { swManifest } from "../pwa/plugin";

describe("service worker manifest", () => {
  let dist: string;
  const write = (file: string, body: string) => {
    mkdirSync(path.dirname(path.join(dist, file)), { recursive: true });
    writeFileSync(path.join(dist, file), body);
  };

  beforeEach(() => {
    dist = mkdtempSync(path.join(tmpdir(), "sw-"));
    write("index.html", "<html>");
    write("sw.js", "old worker");
    write("assets/index-abc.js", "js");
    write("assets/ort-wasm-simd-threaded-xyz.wasm", "wasm");
    write("model/model.onnx", "weights v1");
    write("model/labels.json", "{}");
  });
  afterEach(() => rmSync(dist, { recursive: true }));

  it("precaches the shell and leaves the model and wasm for first use", () => {
    const m = swManifest(dist);
    expect(m.shell).toEqual(["./assets/index-abc.js", "./", "./model/labels.json"]); // "./" is index.html
    expect(m.runtime.map((r) => r.url)).toEqual(["./assets/ort-wasm-simd-threaded-xyz.wasm", "./model/model.onnx"]);
    expect(m.runtime[1].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives a retrained model a new hash without touching the shell version", () => {
    const before = swManifest(dist);
    write("model/model.onnx", "weights v2");
    const after = swManifest(dist);
    expect(after.runtime[1].sha256).not.toBe(before.runtime[1].sha256);
    expect(after.shellVersion).toBe(before.shellVersion);
  });

  it("changes the shell version when a shell file changes", () => {
    const before = swManifest(dist);
    write("model/labels.json", '{"species":[]}');
    expect(swManifest(dist).shellVersion).not.toBe(before.shellVersion);
  });
});
