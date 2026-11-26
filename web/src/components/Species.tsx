import { useEffect, useMemo, useState } from "react";
import { Progress } from "./Notebook";

const BASE = import.meta.env.BASE_URL;

/** Group names by their last word ("Song Sparrow" -> "Sparrows"), the way field guides cluster them. */
function groupByKind(names: string[]) {
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const last = name.split(/[\s-]/).pop() ?? name;
    const kind = last.endsWith("ss") ? `${last}es` : last.endsWith("s") ? last : `${last}s`;
    groups.set(kind, [...(groups.get(kind) ?? []), name]);
  }
  const big = [...groups].filter(([, v]) => v.length > 1).sort(([a], [b]) => a.localeCompare(b));
  const singles = [...groups].filter(([, v]) => v.length === 1).flatMap(([, v]) => v).sort();
  return singles.length ? [...big, ["Others", singles] as [string, string[]]] : big;
}

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
                {seen.has(n) && <span aria-label="spotted">✓ </span>}
                {n}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {names.length > 0 && groups.length === 0 && <p className="muted">No species match “{query}”.</p>}
    </section>
  );
}
