// Registers the service worker (pwa/sw.js) in production builds and tracks what the footer shows:
// whether the site works offline, and whether a new version is waiting.

export interface PwaState {
  /** "none": no service worker yet. "shell": the site is cached, the model not yet. "ready": identifying works offline. */
  offline: "none" | "shell" | "ready";
  updateReady: boolean;
}

let state: PwaState = { offline: "none", updateReady: false };
const listeners = new Set<() => void>();
let waiting: ServiceWorker | null = null;
let reloading = false;

function set(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const getState = () => state;

/** Let the waiting worker take over; the page reloads once it does. */
export function applyUpdate() {
  if (!waiting) return;
  reloading = true;
  waiting.postMessage({ type: "skip-waiting" });
}

async function register() {
  const sw = navigator.serviceWorker;
  sw.addEventListener("message", (e) => {
    if (e.data?.type === "status") set({ offline: e.data.modelCached ? "ready" : "shell" });
  });
  sw.addEventListener("controllerchange", () => {
    if (reloading) location.reload();
    else sw.controller?.postMessage({ type: "status" }); // first install: the worker just claimed this page
  });
  sw.startMessages();

  const reg = await sw.register(`${import.meta.env.BASE_URL}sw.js`);
  const offerUpdate = (worker: ServiceWorker) => {
    waiting = worker;
    set({ updateReady: true });
  };
  if (reg.waiting && sw.controller) offerUpdate(reg.waiting);
  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && sw.controller) offerUpdate(worker);
    });
  });
  sw.controller?.postMessage({ type: "status" });

  // Long-lived tabs (and installed apps) check for a new deploy when they come back into view.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reg.update().catch(() => {});
  });
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const start = () => register().catch(() => {});
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}
