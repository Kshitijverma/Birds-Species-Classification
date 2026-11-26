import type { Sighting } from "../notebook";

const TOTAL = 200;
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function Notebook({ entries, onRemove }: { entries: Sighting[]; onRemove: (species: string) => void }) {
  return (
    <section className="notebook">
      <h1>My field notebook</h1>
      <Progress seen={entries.length} />
      {entries.length === 0 ? (
        <p className="muted empty">
          Nothing here yet. Identify a bird and tap <em>Add to my notebook</em> to start your life list.
          It's saved in this browser only.
        </p>
      ) : (
        <ul className="sightings">
          {entries.map((e) => (
            <li key={e.species} className="sighting">
              <img src={e.thumb} alt="" />
              <div>
                <h3>{e.species}</h3>
                <p className="muted">
                  First seen {date(e.firstSeen)}
                  {e.count > 1 && ` · ${e.count} sightings`}
                </p>
              </div>
              <button
                className="link remove"
                onClick={() => confirm(`Remove ${e.species} from your notebook?`) && onRemove(e.species)}
                aria-label={`Remove ${e.species}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Progress({ seen }: { seen: number }) {
  return (
    <div className="progress" aria-label={`${seen} of ${TOTAL} species`}>
      <div className="progress-text">
        <strong>{seen}</strong> of {TOTAL} species spotted
      </div>
      <div className="bar"><span style={{ width: `${(seen / TOTAL) * 100}%` }} /></div>
    </div>
  );
}
