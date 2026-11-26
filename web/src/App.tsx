import { useEffect, useMemo, useState } from "react";
import { About } from "./components/About";
import { Identify } from "./components/Identify";
import { Notebook } from "./components/Notebook";
import { OfflineStatus } from "./components/OfflineStatus";
import { Species } from "./components/Species";
import { SpeciesPage } from "./components/SpeciesPage";
import { thumbnail, useNotebook } from "./notebook";

// Hash routes, so the site works on GitHub Pages without server rewrites.
const ROUTES = {
  "#/": "Identify",
  "#/notebook": "Notebook",
  "#/species": "Species",
  "#/about": "About",
} as const;
type Route = keyof typeof ROUTES;

// A species page, "#/species/<slug>", sits under the Species tab.
const SPECIES_PAGE = /^#\/species\/([a-z0-9-]+)$/;

function currentRoute(): Route {
  if (SPECIES_PAGE.test(location.hash)) return "#/species";
  return (location.hash in ROUTES ? location.hash : "#/") as Route;
}

const currentSlug = () => SPECIES_PAGE.exec(location.hash)?.[1] ?? null;

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [slug, setSlug] = useState<string | null>(currentSlug);
  const { entries, record, remove, annotate, replaceAll } = useNotebook();
  const seen = useMemo(() => new Set(entries.map((e) => e.species)), [entries]);

  useEffect(() => {
    const onHash = () => {
      setRoute(currentRoute());
      setSlug(currentSlug());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="page">
      <header className="masthead">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 32 32"><path d="M4 20c4-1 7-5 11-5s5 3 9 2 4-4 4-4-1 7-7 9-12 2-17-2z" /><circle cx="22" cy="14" r="1" /></svg>
          </span>
          Field Guide
        </a>
        <nav>
          {(Object.keys(ROUTES) as Route[]).map((r) => (
            <a key={r} href={r} aria-current={route === r ? "page" : undefined}>
              {ROUTES[r]}
              {r === "#/notebook" && entries.length > 0 && <span className="badge">{entries.length}</span>}
            </a>
          ))}
        </nav>
      </header>

      <main>
        {route === "#/" && <Identify onRecord={async (s, photo) => record(s, await thumbnail(photo))} />}
        {route === "#/notebook" && (
          <Notebook entries={entries} onRemove={remove} onAnnotate={annotate} onReplaceAll={replaceAll} />
        )}
        {route === "#/species" && (slug ? <SpeciesPage slug={slug} entries={entries} /> : <Species seen={seen} />)}
        {route === "#/about" && <About />}
      </main>

      <footer>
        Runs in your browser · photos stay on your device ·{" "}
        <a href="https://github.com/Kshitijverma/Birds-Species-Classification">source</a>
        <OfflineStatus />
      </footer>
    </div>
  );
}
