// Service worker for the Field Guide. The build (pwa/plugin.ts) prepends `self.__SW_MANIFEST`,
// which lists this build's files and content hashes, so every deploy that changes a file
// changes this script and the browser installs it as an update.
//
// - Shell (index.html, JS, CSS, icons, examples, labels): precached at install, served cache-first.
// - Model and the runtime's wasm: cached on first identify, served cache-first after that.
//   A copy is only stored if its SHA-256 matches the build's, so a stale copy is never pinned.
// - The shell cache is named by content hash and the runtime cache's entries carry theirs;
//   activating a new worker deletes whatever the new build doesn't use.
// - A new worker waits until the page asks it to take over ("Update ready — reload").

const { shellVersion, shell, runtime } = self.__SW_MANIFEST;
const SHELL = `fg-shell-${shellVersion}`;
const RUNTIME = "fg-runtime"; // entries are checked one by one, so an unchanged model survives a deploy
const FONTS = "fg-fonts";

const scoped = (url) => new URL(url, self.registration.scope).href;
const INDEX = scoped("./");
const SHELL_URLS = new Set(shell.map(scoped));
const RUNTIME_SHA = new Map(runtime.map((r) => [scoped(r.url), r.sha256]));
const FONT_ORIGINS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll([...SHELL_URLS].map((url) => new Request(url, { cache: "no-cache" })))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL, RUNTIME, FONTS];
      for (const name of await caches.keys()) {
        if (name.startsWith("fg-") && !keep.includes(name)) await caches.delete(name);
      }
      // Drop runtime files this build no longer uses or whose content changed (e.g. a retrained model).
      const cache = await caches.open(RUNTIME);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (response?.headers.get("X-SHA256") !== RUNTIME_SHA.get(request.url)) await cache.delete(request);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "skip-waiting") self.skipWaiting();
  if (event.data?.type === "status") event.waitUntil(status().then((s) => event.source?.postMessage(s)));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  url.hash = "";
  const href = url.href;

  if (request.mode === "navigate" && href.startsWith(self.registration.scope) && /\/(index\.html)?$/.test(url.pathname)) {
    event.respondWith(fromCache(SHELL, INDEX, request));
  } else if (RUNTIME_SHA.has(href)) {
    event.respondWith(runtimeFirst(event, href));
  } else if (SHELL_URLS.has(href)) {
    event.respondWith(fromCache(SHELL, href, request));
  } else if (FONT_ORIGINS.includes(url.origin)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});

async function fromCache(cacheName, key, request) {
  const hit = await caches.match(key, { cacheName });
  return hit ?? fetch(request);
}

/** Cache-first; on a miss, fetch fresh from the network and store it once its hash checks out. */
async function runtimeFirst(event, href) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(href);
  if (hit) return hit;
  const response = await fetch(href, { cache: "no-cache" });
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(
      (async () => {
        const body = await copy.arrayBuffer();
        const digest = await sha256(body);
        if (digest !== RUNTIME_SHA.get(href)) return; // the server has a different build than this worker
        const headers = { "Content-Type": copy.headers.get("Content-Type") ?? "application/octet-stream", "X-SHA256": digest };
        await cache.put(href, new Response(body, { headers }));
        await broadcast(await status());
      })().catch(() => {}),
    );
  }
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(event.request);
  const network = fetch(event.request)
    .then((response) => {
      if (response.ok || response.type === "opaque") cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => hit ?? Response.error());
  if (!hit) return network;
  event.waitUntil(network);
  return hit;
}

/** Whether identifying works offline: the model and wasm are both cached. */
async function status() {
  const cache = await caches.open(RUNTIME);
  const cached = new Set((await cache.keys()).map((r) => r.url));
  return { type: "status", modelCached: [...RUNTIME_SHA.keys()].every((url) => cached.has(url)) };
}

async function broadcast(message) {
  for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage(message);
}

async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
