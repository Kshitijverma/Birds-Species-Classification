import { useRef, useState } from "react";
import { download, today } from "../download";
import type { Sighting } from "../notebook";
import { merge, NOTE_MAX, parseImport, PLACE_MAX, toCsv, toJson } from "../notebookData";

const TOTAL = 200;
const BASE = import.meta.env.BASE_URL;
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Edit = { note?: string; place?: string };

export function Notebook({ entries, onRemove, onAnnotate, onReplaceAll }: {
  entries: Sighting[];
  onRemove: (species: string) => void;
  onAnnotate: (species: string, edit: Edit) => void;
  onReplaceAll: (sightings: Sighting[]) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className="notebook">
      <h1>My field notebook</h1>
      <Progress seen={entries.length} />
      <Backup entries={entries} onReplaceAll={onReplaceAll} />
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
                {e.place && <p className="place">{e.place}</p>}
              </div>
              <button
                className="link remove"
                onClick={() => confirm(`Remove ${e.species} from your notebook?`) && onRemove(e.species)}
                aria-label={`Remove ${e.species}`}
              >
                ×
              </button>
              {editing === e.species ? (
                <NoteEditor
                  sighting={e}
                  onSave={(edit) => {
                    onAnnotate(e.species, edit);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="sighting-notes">
                  {e.note && <p className="note">{e.note}</p>}
                  <button className="link" onClick={() => setEditing(e.species)}>
                    {e.note || e.place ? "Edit note" : "+ Add a note or place"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteEditor({ sighting, onSave, onCancel }: {
  sighting: Sighting;
  onSave: (edit: Edit) => void;
  onCancel: () => void;
}) {
  const [place, setPlace] = useState(sighting.place ?? "");
  const [note, setNote] = useState(sighting.note ?? "");
  return (
    <form
      className="note-editor"
      onSubmit={(ev) => {
        ev.preventDefault();
        onSave({ place, note });
      }}
      onKeyDown={(ev) => ev.key === "Escape" && onCancel()}
    >
      <label>
        <span className="eyebrow">Place</span>
        <input
          value={place} onChange={(ev) => setPlace(ev.target.value)} maxLength={PLACE_MAX}
          placeholder="e.g. Lakeside trail" autoFocus
        />
      </label>
      <label>
        <span className="eyebrow">Note</span>
        <textarea
          value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={NOTE_MAX} rows={3}
          placeholder="What was it doing? Who were you with?"
        />
      </label>
      <div className="note-actions">
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn small">Save</button>
      </div>
    </form>
  );
}

type Pending = { sightings: Sighting[]; file: string };
type Message = { kind: "ok" | "error"; text: string; details?: string[] };

/** Export the Notebook as JSON or CSV, and import a JSON export (merge or replace). */
function Backup({ entries, onReplaceAll }: { entries: Sighting[]; onReplaceAll: (s: Sighting[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  async function readFile(file: File) {
    setMessage(null);
    setPending(null);
    let known: Set<string> | undefined;
    try {
      const labels = await fetch(`${BASE}model/labels.json`).then((r) => r.json());
      if (Array.isArray(labels.species)) known = new Set(labels.species);
    } catch {
      // Offline: import without checking names against the 200 Species.
    }
    const result = parseImport(await file.text(), known);
    if (!result.ok) {
      setMessage({ kind: "error", text: `Couldn't import ${file.name}:`, details: result.errors });
    } else if (entries.length === 0) {
      onReplaceAll(result.sightings);
      setMessage({ kind: "ok", text: `Imported ${plural(result.sightings.length, "sighting")}.` });
    } else {
      setPending({ sightings: result.sightings, file: file.name });
    }
  }

  function apply(mode: "merge" | "replace") {
    if (!pending) return;
    if (mode === "replace") {
      onReplaceAll(pending.sightings);
      setMessage({ kind: "ok", text: `Notebook replaced with ${plural(pending.sightings.length, "sighting")} from ${pending.file}.` });
    } else {
      const { sightings, added, updated } = merge(entries, pending.sightings);
      onReplaceAll(sightings);
      setMessage({ kind: "ok", text: `Merged ${pending.file}: ${added} added, ${updated} updated.` });
    }
    setPending(null);
  }

  return (
    <div className="backup">
      <div className="backup-actions">
        <span className="eyebrow">Back up</span>
        <button
          className="btn small" disabled={entries.length === 0}
          onClick={() => download(new Blob([toJson(entries)], { type: "application/json" }), `field-notebook-${today()}.json`)}
        >
          Export JSON
        </button>
        <button
          className="btn small" disabled={entries.length === 0}
          onClick={() => download(new Blob([toCsv(entries)], { type: "text/csv" }), `field-notebook-${today()}.csv`)}
        >
          Export CSV
        </button>
        <button className="btn small" onClick={() => input.current?.click()}>Import JSON</button>
        <input
          ref={input} type="file" accept="application/json,.json" hidden
          onChange={(ev) => {
            const file = ev.target.files?.[0];
            ev.target.value = "";
            if (file) readFile(file);
          }}
        />
      </div>

      {pending && (
        <div className="import-confirm" role="alertdialog" aria-label="Import notebook">
          <p>
            <strong>{pending.file}</strong> has {plural(pending.sightings.length, "sighting")}.
            Merge them into your notebook, or replace your {plural(entries.length, "sighting")} with them?
          </p>
          <div className="note-actions">
            <button className="link" onClick={() => setPending(null)}>Cancel</button>
            <button className="btn small" onClick={() => apply("replace")}>Replace mine</button>
            <button className="btn small primary" onClick={() => apply("merge")}>Merge</button>
          </div>
        </div>
      )}

      {message && (
        <div className={`import-message ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
          <p>{message.text}</p>
          {message.details && <ul>{message.details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}
    </div>
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
