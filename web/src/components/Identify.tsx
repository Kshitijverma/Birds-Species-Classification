import { useEffect, useRef, useState } from "react";
import type { Verdict } from "../verdict";
import { FieldCard } from "./FieldCard";

const BASE = import.meta.env.BASE_URL;

interface Example {
  species: string;
  file: string;
}

const NOTES = [
  "Checking the bill shape…",
  "Looking for wing bars…",
  "Comparing crown and nape…",
  "Measuring the tail…",
  "Flipping through 200 species…",
];

type State =
  | { step: "idle" }
  | { step: "working"; photo: Blob; url: string }
  | { step: "done"; photo: Blob; url: string; verdict: Verdict }
  | { step: "error"; url?: string; message: string };

export function Identify({ onRecord }: { onRecord: (species: string, photo: Blob) => Promise<void> }) {
  const [state, setState] = useState<State>({ step: "idle" });
  const [dragging, setDragging] = useState(false);
  const [examples, setExamples] = useState<Example[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const url = state.step === "idle" ? undefined : state.url;
  useEffect(() => () => {
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  }, [url]);

  useEffect(() => {
    fetch(`${BASE}examples/examples.json`).then((r) => r.json()).then(setExamples).catch(() => {});
  }, []);

  async function run(photo: Blob, shownUrl = URL.createObjectURL(photo)) {
    setState({ step: "working", photo, url: shownUrl });
    try {
      // The model and runtime load on first use, so the page itself stays small.
      const { identify } = await import("../model");
      const verdict = await identify(photo);
      setState({ step: "done", photo, url: shownUrl, verdict });
    } catch (err) {
      setState({ step: "error", url: shownUrl, message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function runExample(ex: Example) {
    const src = `${BASE}examples/${ex.file}`;
    try {
      run(await fetch(src).then((r) => r.blob()), src);
    } catch {
      setState({ step: "error", message: "Couldn't load that example." });
    }
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (file) run(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const busy = state.step === "working";

  return (
    <section className="identify">
      <div className="hero">
        <h1>What bird is that?</h1>
        <p className="lede">
          Show it a photo and it'll name the species, out of 200 North American birds.
          It all runs on your device: <strong>your photo never leaves it.</strong>
        </p>
      </div>

      <div
        className={`drop ${dragging ? "dragging" : ""} ${url ? "has-photo" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
          if (file) run(file);
        }}
      >
        {url ? (
          <figure className={`snapshot ${busy ? "scanning" : ""}`}>
            <span className="tape" aria-hidden />
            <img src={url} alt="Your photo" />
            {busy && <span className="scanline" aria-hidden />}
          </figure>
        ) : (
          <div className="drop-empty">
            <svg className="drop-icon" viewBox="0 0 64 64" aria-hidden>
              <path d="M10 40c8-2 14-10 22-10s10 6 18 4 8-8 8-8-2 14-14 18-24 4-34-4z" />
              <circle cx="44" cy="28" r="1.8" />
              <path d="M52 27l6-1-5 4" />
            </svg>
            <p>Drop a photo here, paste one, or</p>
          </div>
        )}
        <button className="btn primary" onClick={() => input.current?.click()} disabled={busy}>
          {url ? "Try another photo" : "Choose a photo"}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) run(file);
          }}
        />
      </div>

      {busy && <Working />}
      {state.step === "error" && (
        <p className="status error" role="alert">Something went wrong: {state.message}</p>
      )}
      {state.step === "done" && (
        <FieldCard verdict={state.verdict} onRecord={(s) => onRecord(s, state.photo)} photo={state.photo} />
      )}

      {examples.length > 0 && (
        <div className="examples">
          <h2 className="eyebrow">No photo handy? Try one of these</h2>
          <ul>
            {examples.map((ex) => (
              <li key={ex.file}>
                <button onClick={() => runExample(ex)} disabled={busy} title={ex.species}>
                  <img src={`${BASE}examples/${ex.file}`} alt={ex.species} loading="lazy" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Working() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % NOTES.length), 1400);
    return () => clearInterval(t);
  }, []);
  return (
    <p className="status working" aria-live="polite">
      <span className="pencil" aria-hidden>✎</span> {NOTES[i]}
      <span className="sub">The first photo also downloads the model (about 25 MB), once.</span>
    </p>
  );
}
