import { useEffect, useState } from "react";
import { renderShareCard, shareFileName, shareOrDownload } from "../shareCard";

interface Card {
  photo: Blob;
  species: string;
  png?: Blob; // missing when drawing failed
  filename: string;
}

/**
 * Shares the field card as a PNG, or downloads it where sharing files isn't
 * supported. The card is drawn ahead of the tap, so the share call runs
 * straight from the tap (Safari only allows sharing from a fresh user gesture).
 */
export function ShareButton({ species, confidence, photo }: { species: string; confidence: number; photo: Blob }) {
  const [card, setCard] = useState<Card | null>(null);
  const [savedFor, setSavedFor] = useState<Card | null>(null);

  useEffect(() => {
    let live = true;
    const date = new Date();
    const filename = shareFileName(species, date);
    renderShareCard({ species, confidence, photo, date }).then(
      (png) => live && setCard({ photo, species, png, filename }),
      () => live && setCard({ photo, species, filename }),
    );
    return () => {
      live = false;
    };
  }, [species, confidence, photo]);

  // A card drawn for an earlier photo doesn't count.
  const current = card && card.photo === photo && card.species === species ? card : null;
  if (current && !current.png) return null;

  return (
    <>
      {savedFor && savedFor === current && (
        <span className="muted small share-note" role="status">Card saved as a PNG</span>
      )}
      <button
        className="btn"
        disabled={!current}
        onClick={async () => {
          if (!current?.png) return;
          const result = await shareOrDownload(current.png, current.filename, `${species}, identified with Field Guide`);
          if (result === "downloaded") setSavedFor(current);
        }}
      >
        Share card
      </button>
    </>
  );
}
