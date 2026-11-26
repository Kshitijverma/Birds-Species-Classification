import { useEffect, useRef, useState } from "react";
import { initialCrop, toRegion, type Crop, type Region } from "../crop";
import type { Verdict } from "../verdict";
import { CropBox, CropShade, cropStyle } from "./CropBox";
import { FieldCard } from "./FieldCard";

const BASE = import.meta.env.BASE_URL;

interface Example {
  species: string;
  file: string;
}

const regionCrop = (r: Region): Crop => ({ x: r.x, y: r.y, size: r.width });

const NOTES = [
  "Checking the bill shape…",
  "Looking for wing bars…",
  "Comparing crown and nape…",
  "Measuring the tail…",
  "Flipping through 200 species…",
];

type State =
  | { step: "idle" }
  | { step: "working"; photo: Blob; url: string; region?: Region }
  | { step: "done"; photo: Blob; url: string; region?: Region; verdict: Verdict }
  | { step: "error"; url?: string; message: string };

export function Identify({ onRecord }: { onRecord: (species: string, photo: Blob) => Promise<void> }) {
  const [state, setState] = useState<State>({ step: "idle" });
  const [dragging, setDragging] = useState(false);
  const [examples, setExamples] = useState<Example[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const img = useRef<HTMLImageElement>(null);
  // The crop box, in photo pixels, while the visitor is placing it (null when not cropping).
  const [crop, setCrop] = useState<Crop | null>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });

  const url = state.step === "idle" ? undefined : state.url;
  useEffect(() => () => {
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  }, [url]);

  useEffect(() => {
    fetch(`${BASE}examples/examples.json`).then((r) => r.json()).then(setExamples).catch(() => {});
  }, []);

  async function run(photo: Blob, shownUrl = URL.createObjectURL(photo), region?: Region) {
    setCrop(null);
    setState({ step: "working", photo, url: shownUrl, region });
    try {
      // The model and runtime load on first use, so the page itself stays small.
      const { identify } = await import("../model");
      const verdict = await identify(photo, region);
      setState({ step: "done", photo, url: shownUrl, region, verdict });
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
  const region = state.step === "working" || state.step === "done" ? state.region : undefined;
  const cropping = state.step === "done" && crop !== null;

  function startCrop() {
    const el = img.current;
    if (!el?.naturalWidth || state.step !== "done") return;
    const size = { width: el.naturalWidth, height: el.naturalHeight };
    setNatural(size);
    // Re-open the last crop if there is one, else start from a centred box.
    setCrop(state.region ? regionCrop(state.region) : initialCrop(size.width, size.height));
  }

  function identifyCrop() {
    if (state.step !== "done" || !crop) return;
    run(state.photo, state.url, toRegion(crop, natural.width, natural.height));
  }

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
          <figure className={`snapshot ${busy ? "scanning" : ""} ${cropping ? "cropping" : ""}`}>
            <span className="tape" aria-hidden />
            <div className="frame">
              <img ref={img} src={url} alt="Your photo" />
              {cropping && crop ? (
                <CropBox
                  crop={crop}
                  width={natural.width}
                  height={natural.height}
                  onChange={setCrop}
                  onSubmit={identifyCrop}
                  onCancel={() => setCrop(null)}
                />
              ) : region && natural.width > 0 && (
                <div className="crop-layer static" aria-hidden>
                  <CropShade crop={regionCrop(region)} width={natural.width} height={natural.height} />
                  <div className="crop-box" style={cropStyle(regionCrop(region), natural.width, natural.height)} />
                </div>
              )}
            </div>
            {busy && <span className="scanline" aria-hidden />}
            {(cropping || region) && (
              <figcaption>{cropping ? "Drag the box over the bird" : "Cropped to the bird"}</figcaption>
            )}
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
        {cropping ? (
          <div className="photo-actions">
            <button className="btn primary" onClick={identifyCrop}>Identify this crop</button>
            <button className="btn" onClick={() => setCrop(null)}>Cancel</button>
          </div>
        ) : (
          <div className="photo-actions">
            <button className="btn primary" onClick={() => input.current?.click()} disabled={busy}>
              {url ? "Try another photo" : "Choose a photo"}
            </button>
            {state.step === "done" && (
              <button className="btn" onClick={startCrop}>
                {state.region ? "Adjust the crop" : "Crop to the bird"}
              </button>
            )}
            {state.step === "done" && state.region && (
              <button className="btn" onClick={() => run(state.photo, state.url)}>Use whole photo</button>
            )}
          </div>
        )}
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
        <FieldCard verdict={state.verdict} onRecord={(s) => onRecord(s, state.photo)} />
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
