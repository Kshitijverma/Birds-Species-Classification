import { useCallback, useEffect, useState } from "react";

/** One species in the visitor's field notebook (their life list), kept in this browser only. */
export interface Sighting {
  species: string;
  firstSeen: string; // ISO date
  lastSeen: string;
  count: number;
  thumb: string; // small JPEG data URL of the first photo
}

const KEY = "field-notebook-v1";

function read(): Sighting[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Sighting[]) : [];
  } catch {
    return [];
  }
}

function write(entries: Sighting[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Private mode or full storage: the notebook just won't persist.
  }
}

export function useNotebook() {
  const [entries, setEntries] = useState<Sighting[]>(read);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === KEY && setEntries(read());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const record = useCallback((species: string, thumb: string) => {
    setEntries((prev) => {
      const now = new Date().toISOString();
      const existing = prev.find((e) => e.species === species);
      const next = existing
        ? prev.map((e) => (e === existing ? { ...e, lastSeen: now, count: e.count + 1 } : e))
        : [{ species, firstSeen: now, lastSeen: now, count: 1, thumb }, ...prev];
      write(next);
      return next;
    });
  }, []);

  const remove = useCallback((species: string) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.species !== species);
      write(next);
      return next;
    });
  }, []);

  return { entries, record, remove };
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
