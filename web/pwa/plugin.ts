import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Big files fetched on first identify (not at install), and checked against their hash before caching. */
const isRuntime = (file: string) => file === "model/model.onnx" || file.endsWith(".wasm");

export interface SwManifest {
  /** Changes whenever any precached file changes; names the shell cache. */
  shellVersion: string;
  /** URLs relative to the site root, precached at install. "./" is index.html. */
  shell: string[];
  /** Cached on first use, keyed by their content hash. */
  runtime: { url: string; sha256: string }[];
}

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join("/")];
  });
}

/** What the service worker caches, read from a finished build directory. */
export function swManifest(outDir: string): SwManifest {
  const shellHash = createHash("sha256");
  const shell: string[] = [];
  const runtime: SwManifest["runtime"] = [];
  for (const file of walk(outDir).sort()) {
    if (file === "sw.js") continue;
    const sha256 = createHash("sha256").update(readFileSync(path.join(outDir, file))).digest("hex");
    const url = file === "index.html" ? "./" : `./${file}`;
    if (isRuntime(file)) {
      runtime.push({ url, sha256 });
    } else {
      shell.push(url);
      shellHash.update(`${url} ${sha256}\n`);
    }
  }
  return { shellVersion: shellHash.digest("hex").slice(0, 12), shell, runtime };
}

/** Writes dist/sw.js: the hand-written worker in pwa/sw.js, prefixed with this build's manifest. */
export function serviceWorker(): Plugin {
  let outDir = "";
  let worker = "";
  return {
    name: "field-guide-sw",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      worker = path.join(config.root, "pwa/sw.js");
    },
    closeBundle() {
      const manifest = JSON.stringify(swManifest(outDir));
      writeFileSync(path.join(outDir, "sw.js"), `self.__SW_MANIFEST = ${manifest};\n${readFileSync(worker, "utf8")}`);
    },
  };
}
