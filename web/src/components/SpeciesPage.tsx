import { useEffect, useMemo, useState } from "react";
import type { Sighting } from "../notebook";
import { findBySlug, groupOf, type SpeciesInfo } from "../species";

const BASE = import.meta.env.BASE_URL;
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

let cache: Promise<SpeciesInfo[]> | null = null;
/** species.json, fetched once per visit. */
export function loadSpecies(): Promise<SpeciesInfo[]> {
  cache ??= fetch(`${BASE}species/species.json`).then((r) => {
    if (!r.ok) throw new Error(`species.json: ${r.status}`);
    return r.json();
  });
  cache.catch(() => (cache = null));
  return cache;
}

export function SpeciesPage({ slug, entries }: { slug: string; entries: Sighting[] }) {
  const [all, setAll] = useState<SpeciesInfo[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    loadSpecies().then(setAll).catch(() => setFailed(true));
  }, []);

  const s = all && findBySlug(all, slug);
  const group = useMemo(() => s && all && groupOf(s.name, all.map((x) => x.name)), [s, all]);
  const sighting = s && entries.find((e) => e.species === s.name);

  useEffect(() => {
    if (!s) return;
    const before = document.title;
    document.title = `${s.name} · Field Guide`;
    return () => void (document.title = before);
  }, [s]);

  if (failed) return <p className="muted">Couldn't load the species list. Check your connection and reload.</p>;
  if (!all) return <p className="muted">Loading…</p>;
  if (!s) {
    return (
      <section className="species-page">
        <a className="back" href="#/species">← All species</a>
        <h1>Not one of the 200</h1>
        <p className="muted">There's no species page called “{slug}”.</p>
      </section>
    );
  }

  const { photo, wikipedia } = s;
  return (
    <article className="species-page">
      <a className="back" href="#/species">← All species</a>
      <p className="eyebrow">{group}</p>
      <h1>{s.name}</h1>
      <p className="sci">{s.scientificName}</p>

      <figure className="plate">
        <img
          src={`${BASE}species/${photo.file}`}
          width={photo.width}
          height={photo.height}
          alt={`${s.name}, photographed by ${photo.photographer}`}
        />
        <figcaption>
          Photo: <a href={photo.observation}>{photo.photographer}</a> on iNaturalist,{" "}
          <a href={photo.licenseUrl}>{photo.license}</a>
        </figcaption>
      </figure>

      <section className="your-sightings" aria-label="Your sightings">
        <p className="eyebrow">In your notebook</p>
        {sighting ? (
          <div className="sighting">
            <img src={sighting.thumb} alt="" />
            <div>
              <h3>{sighting.count === 1 ? "Seen once" : `Seen ${sighting.count} times`}</h3>
              <p className="muted">
                First seen {date(sighting.firstSeen)}
                {sighting.count > 1 && ` · last seen ${date(sighting.lastSeen)}`}
              </p>
            </div>
          </div>
        ) : (
          <p className="muted">
            Not spotted yet. <a href="#/">Identify a photo</a> of one to add it.
          </p>
        )}
      </section>

      <p className="description">{wikipedia.description}</p>
      <p className="muted small">
        Adapted from the Wikipedia article <a href={wikipedia.url}><cite>{wikipedia.title}</cite></a>;{" "}
        text under <a href={wikipedia.licenseUrl}>{wikipedia.license}</a>.
      </p>

      <p className="eyebrow">Read more</p>
      <ul className="outlinks">
        <li><a href={wikipedia.url} target="_blank" rel="noreferrer">Wikipedia ↗</a></li>
        {s.allAboutBirds && (
          <li><a href={s.allAboutBirds} target="_blank" rel="noreferrer">All About Birds ↗</a></li>
        )}
      </ul>
    </article>
  );
}
