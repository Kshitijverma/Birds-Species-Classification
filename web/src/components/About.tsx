import { useEffect, useState } from "react";

const BASE = import.meta.env.BASE_URL;

interface Metrics {
  threshold: number;
  test_photos: number;
  test_named_share: number;
  test_named_accuracy: number;
  test_top1_accuracy: number;
  test_top3_accuracy: number;
  test_ece_before_temperature: number;
  test_ece_shipped: number;
  ood_pictures: number;
  ood_not_a_bird: number;
  reliability: Bin[];
}

/** Test photos grouped by the Confidence of the top Species. */
interface Bin {
  photos: number;
  confidence: number;
  accuracy: number;
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

  useEffect(() => {
    fetch(`${BASE}model/metrics.json`).then((r) => r.json()).then(setM).catch(() => {});
    fetch(`${BASE}examples/examples.json`).then((r) => r.json()).then(setExamples).catch(() => {});
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

          <h2>Can you trust the percentage?</h2>
          <p>
            Mostly. Each dot below is a group of test photos with similar confidence: a dot on the diagonal
            means that, of species named at that confidence, that share were right. On average confidence
            is {(m.test_ece_shipped * 100).toFixed(1)} points away from how often it's right (it was
            {" "}{(m.test_ece_before_temperature * 100).toFixed(1)} before calibration).
          </p>
          <Reliability bins={m.reliability} />
        </>
      )}

      <h2>Limits</h2>
      <ul>
        <li>
          It knows 200 species, mostly North American. A photo that looks like none of them gets{" "}
          <em>Not a bird I know</em>
          {m && <> ({m.ood_not_a_bird} of {m.ood_pictures} test pictures of noise, plain colours, animals and plants did)</>}.
          Some non-birds still slip through, and a bird outside the 200 will get a wrong guess or <em>Can't be sure</em>.
        </li>
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
        This started in 2020 as a course project on bird attributes; the original notebooks and report are in
        the repo's <a href="https://github.com/Kshitijverma/Birds-Species-Classification/tree/master/legacy">legacy folder</a>.
      </p>
    </section>
  );
}

/** Reliability chart: accuracy against Confidence, one dot per group of photos (area ~ photos). */
function Reliability({ bins }: { bins: Bin[] }) {
  const size = 200;
  const pad = 28;
  const at = (v: number) => pad + v * size;
  const most = Math.max(...bins.map((b) => b.photos));
  const points = bins.map((b) => `${at(b.confidence)},${at(1 - b.accuracy)}`).join(" ");
  return (
    <svg
      className="reliability"
      viewBox={`0 0 ${size + pad * 2} ${size + pad * 2}`}
      role="img"
      aria-label="Reliability chart: accuracy against confidence for groups of test photos"
    >
      <rect x={pad} y={pad} width={size} height={size} className="frame" />
      <line x1={at(0)} y1={at(1)} x2={at(1)} y2={at(0)} className="ideal" />
      <polyline points={points} className="trace" />
      {bins.map((b) => (
        <circle key={b.confidence} cx={at(b.confidence)} cy={at(1 - b.accuracy)} r={2 + 6 * Math.sqrt(b.photos / most)}>
          <title>{`${b.photos} photos: ${pct(b.confidence)} confident, ${pct(b.accuracy)} right`}</title>
        </circle>
      ))}
      <text x={pad + size / 2} y={size + pad * 2 - 6} textAnchor="middle">confidence</text>
      <text x={10} y={pad + size / 2} textAnchor="middle" transform={`rotate(-90 10 ${pad + size / 2})`}>right</text>
      <text x={pad} y={size + pad + 12} textAnchor="middle">0</text>
      <text x={pad + size} y={size + pad + 12} textAnchor="middle">100%</text>
    </svg>
  );
}
