import { useEffect, useState } from "react";
import { speciesHref, type SpeciesInfo } from "../species";
import { loadSpecies } from "./SpeciesPage";

const BASE = import.meta.env.BASE_URL;

interface Metrics {
  threshold: number;
  test_photos: number;
  test_named_share: number;
  test_named_accuracy: number;
  test_top1_accuracy: number;
  test_top3_accuracy: number;
}

interface Example {
  species: string;
  attribution: string;
  url: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function About() {
  const [m, setM] = useState<Metrics | null>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const [species, setSpecies] = useState<SpeciesInfo[]>([]);

  useEffect(() => {
    fetch(`${BASE}model/metrics.json`).then((r) => r.json()).then(setM).catch(() => {});
    fetch(`${BASE}examples/examples.json`).then((r) => r.json()).then(setExamples).catch(() => {});
    loadSpecies().then(setSpecies).catch(() => {});
  }, []);

  return (
    <section className="about prose">
      <h1>How it works</h1>
      <p>
        A <strong>DINOv2 ViT-S/14</strong> vision model, with a small classifier trained on top for 200 bird
        species, runs entirely in your browser through ONNX Runtime Web. Your photo is never uploaded.
      </p>
      <p>
        It only names a species when it's confident enough. Below that line it says <em>Can't be sure</em> and
        shows its closest matches, so a guess never looks like an answer.
      </p>

      {m && (
        <>
          <h2>How good is it?</h2>
          <p className="muted">On {m.test_photos.toLocaleString()} test photos it had never seen:</p>
          <dl className="stats">
            <div><dt>{pct(m.test_named_accuracy)}</dt><dd>of named answers are right</dd></div>
            <div><dt>{pct(m.test_named_share)}</dt><dd>of photos get a named answer</dd></div>
            <div><dt>{pct(m.test_top3_accuracy)}</dt><dd>have the right species in its top 3</dd></div>
          </dl>
          <p className="muted small">
            Top-1 accuracy with no confidence cut-off: {pct(m.test_top1_accuracy)}. It names a species at
            {" "}{pct(m.threshold)} confidence or more.
          </p>
        </>
      )}

      <h2>Limits</h2>
      <ul>
        <li>It knows 200 species, mostly North American. Any other bird, or a non-bird, will get a wrong guess or <em>Can't be sure</em>.</li>
        <li>Close, sharp, side-on photos work best. Distant birds, silhouettes and flocks are hard.</li>
        <li>Male, female and juvenile plumages can look very different, which makes some species harder.</li>
      </ul>

      <h2>Credits</h2>
      <p>
        Trained on <a href="https://www.vision.caltech.edu/datasets/cub_200_2011/">CUB-200-2011</a>
        {" "}(Wah, Branson, Welinder, Perona &amp; Belongie, Caltech, 2011). Those photos aren't shown or
        redistributed here.
      </p>
      {examples.length > 0 && (
        <p>
          Example photos are CC0 from iNaturalist:{" "}
          {examples.map((e, i) => (
            <span key={e.url}>
              {i > 0 && ", "}
              <a href={e.url}>{e.species}</a>
            </span>
          ))}
          .
        </p>
      )}
      <p>
        Species descriptions are adapted from <a href="https://en.wikipedia.org/">Wikipedia</a> and are
        available under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>; each
        species page names and links its article. Species photos are by iNaturalist photographers under
        CC0, CC BY or CC BY-SA, credited on each species page and listed below.
      </p>
      {species.length > 0 && (
        <details className="credits">
          <summary>Species photo credits ({species.length})</summary>
          <ul>
            {species.map((s) => (
              <li key={s.slug}>
                <a href={speciesHref(s.name)}>{s.name}</a>: <a href={s.photo.observation}>{s.photo.photographer}</a>,{" "}
                <a href={s.photo.licenseUrl}>{s.photo.license}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p>
        This started in 2020 as a course project on bird attributes; the original notebooks and report are in
        the repo's <a href="https://github.com/Kshitijverma/Birds-Species-Classification/tree/master/legacy">legacy folder</a>.
      </p>
    </section>
  );
}
