import { useEffect, useMemo, useState } from "react";
import { groupByKind, speciesHref } from "../species";
import { Progress } from "./Notebook";

const BASE = import.meta.env.BASE_URL;

export function Species({ seen }: { seen: Set<string> }) {
  const [names, setNames] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch(`${BASE}model/labels.json`).then((r) => r.json()).then((l) => setNames(l.species)).catch(() => {});
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groupByKind(names.filter((n) => n.toLowerCase().includes(q)));
  }, [names, query]);

  return (
    <section className="species-index">
      <h1>The 200 species</h1>
      <p className="muted">
        Everything the model knows, from the CUB-200-2011 dataset. Mostly North American; a bird outside
        this list will usually get a wrong guess or <em>Can't be sure</em>.
      </p>
      <Progress seen={seen.size} />
      <input
        className="search"
        type="search"
        placeholder="Search species…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {groups.map(([kind, members]) => (
        <div key={kind} className="kind">
          <h2 className="eyebrow">{kind} <span className="count">{members.length}</span></h2>
          <ul>
            {members.map((n) => (
              <li key={n} className={seen.has(n) ? "seen" : ""}>
                <a href={speciesHref(n)}>
                  {seen.has(n) && <span aria-label="spotted">✓ </span>}
                  {n}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {names.length > 0 && groups.length === 0 && <p className="muted">No species match “{query}”.</p>}
    </section>
  );
}
