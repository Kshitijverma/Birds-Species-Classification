import { useCallback, useEffect, useState } from "react";
import { annotate as annotateSighting, KEY_V1, KEY_V2, loadStored, storedShape, type Sighting } from "./notebookData";

export type { Sighting } from "./notebookData";

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(entries: Sighting[]) {
  try {
    localStorage.setItem(KEY_V2, JSON.stringify(storedShape(entries)));
  } catch {
    // Private mode or full storage: the notebook just won't persist.
  }
}

/**
 * The Notebook from this browser. A v1 notebook is copied into the v2 key the
 * first time it is read; the v1 key is left untouched, so nothing is lost.
 */
function read(): Sighting[] {
  const v2 = get(KEY_V2);
  const v1 = v2 === null ? get(KEY_V1) : null;
  const entries = loadStored(v2, v1);
  if (v2 === null && v1 !== null) write(entries);
  return entries;
}

export function useNotebook() {
  const [entries, setEntries] = useState<Sighting[]>(read);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === KEY_V2 && setEntries(read());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((change: (prev: Sighting[]) => Sighting[]) => {
    setEntries((prev) => {
      const next = change(prev);
      write(next);
      return next;
    });
  }, []);

  const record = useCallback((species: string, thumb: string) => update((prev) => {
    const now = new Date().toISOString();
    const existing = prev.find((e) => e.species === species);
    return existing
      ? prev.map((e) => (e === existing ? { ...e, lastSeen: now, count: e.count + 1 } : e))
      : [{ species, firstSeen: now, lastSeen: now, count: 1, thumb }, ...prev];
  }), [update]);

  const remove = useCallback(
    (species: string) => update((prev) => prev.filter((e) => e.species !== species)),
    [update],
  );

  const annotate = useCallback(
    (species: string, edit: { note?: string; place?: string }) =>
      update((prev) => prev.map((e) => (e.species === species ? annotateSighting(e, edit) : e))),
    [update],
  );

  /** Replaces the whole Notebook (an import, already validated and merged if wanted). */
  const replaceAll = useCallback((sightings: Sighting[]) => update(() => sightings), [update]);

  return { entries, record, remove, annotate, replaceAll };
}

/** A small square JPEG thumbnail of a photo, for the notebook. */
export async function thumbnail(photo: Blob, size = 160): Promise<string> {
  const bitmap = await createImageBitmap(photo);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d")?.drawImage(
    bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size,
  );
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}
