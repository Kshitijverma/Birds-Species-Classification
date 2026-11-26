import { useEffect, useRef, useState } from "react";
import { speciesHref } from "../species";
import type { Match, Verdict } from "../verdict";

const pct = (c: number) => (c >= 0.995 ? ">99%" : c < 0.01 ? "<1%" : `${Math.round(c * 100)}%`);
const barWidth = (c: number) => `${(c * 100).toFixed(1)}%`;

export function FieldCard({ verdict, onRecord }: { verdict: Verdict; onRecord: (species: string) => Promise<void> }) {
  const [saved, setSaved] = useState<string | null>(null);
  const card = useRef<HTMLElement>(null);
  useEffect(() => card.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), [verdict]);

  async function save(species: string) {
    await onRecord(species);
    setSaved(species);
  }

  if (verdict.kind === "cant-tell") {
    return (
      <article className="card unsure" ref={card}>
        <p className="eyebrow">Field note</p>
        <h2 className="species">Can't be sure</h2>
        <p className="muted">
          The photo may be unclear or distant, or the bird may not be one of the 200 species it knows.
          Closest matches:
        </p>
        <Matches matches={verdict.closest} onPick={save} saved={saved} />
      </article>
    );
  }

  // Runners-up under 1% add noise, not information.
  const alsoPossible = verdict.alsoPossible.filter((m) => m.confidence >= 0.01);
  return (
    <article className="card" ref={card}>
      <div className="card-main">
        <Ring value={verdict.confidence} />
        <div>
          <p className="eyebrow">Identified as</p>
          <h2 className="species">{verdict.species}</h2>
          <a className="more" href={speciesHref(verdict.species)}>
            Read about it →
          </a>
        </div>
      </div>
      {alsoPossible.length > 0 && (
        <>
          <p className="eyebrow">Also possible</p>
          <Matches matches={alsoPossible} />
        </>
      )}
      <div className="card-actions">
        {saved === verdict.species ? (
          <span className="saved">✓ In your notebook</span>
        ) : (
          <button className="btn" onClick={() => save(verdict.species)}>
            + Add to my notebook
          </button>
        )}
      </div>
    </article>
  );
}

function Matches({ matches, onPick, saved }: {
  matches: Match[];
  onPick?: (species: string) => void;
  saved?: string | null;
}) {
  return (
    <ul className="matches">
      {matches.map((m) => (
        <li key={m.species}>
          <span className="name">{m.species}</span>
          <span className="bar"><span style={{ width: barWidth(m.confidence) }} /></span>
          <span className="pct">{pct(m.confidence)}</span>
          {onPick && (saved === m.species ? (
            <span className="saved small">✓</span>
          ) : (
            <button className="link" onClick={() => onPick(m.species)} title="It's this one: add to my notebook">
              It's this
            </button>
          ))}
        </li>
      ))}
    </ul>
  );
}

/** Confidence as a ring gauge. */
function Ring({ value }: { value: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 80 80" role="img" aria-label={`${pct(value)} confident`}>
      <circle cx="40" cy="40" r={r} className="ring-track" />
      <circle
        cx="40" cy="40" r={r} className="ring-value"
        strokeDasharray={`${c * value} ${c}`} transform="rotate(-90 40 40)"
      />
      <text x="40" y="44" textAnchor="middle">{pct(value)}</text>
    </svg>
  );
}
