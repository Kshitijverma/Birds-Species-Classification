export interface Match {
  species: string;
  confidence: number;
}

/** What the model says about one photo. */
export interface ModelOutput {
  /** One Confidence per Species, in labels.json order. */
  confidences: ArrayLike<number>;
  /** How far the photo is from the nearest Species (see training/model.py). */
  distance: number;
}

/**
 * One model output from a batch of runs on the same photo (the photo and its
 * mirror image): the mean of their Confidences and of their distances.
 */
export function averageBatch({ probs, distance }: { probs: ArrayLike<number>; distance: ArrayLike<number> }): ModelOutput {
  const runs = distance.length;
  const species = probs.length / runs;
  const confidences = new Float64Array(species);
  for (let i = 0; i < probs.length; i++) confidences[i % species] += probs[i] / runs;
  return { confidences, distance: Array.from(distance).reduce((a, b) => a + b, 0) / runs };
}

/** The settings export.py chose on the val split (web/public/model/labels.json). */
export interface Rules {
  species: string[];
  threshold: number;
  maxDistance: number;
}

/**
 * What the site tells the visitor. A photo too far from every Species is not
 * a bird it knows. Otherwise a species is named only when the model's
 * Confidence reaches the Threshold; below it, it can't tell and shows the
 * closest matches instead.
 */
export type Verdict =
  | { kind: "species"; species: string; confidence: number; alsoPossible: Match[] }
  | { kind: "cant-tell"; closest: Match[] }
  | { kind: "not-a-bird" };

export function verdict({ confidences, distance }: ModelOutput, { species, threshold, maxDistance }: Rules): Verdict {
  if (distance > maxDistance) return { kind: "not-a-bird" };
  const ranked = Array.from(confidences, (confidence, i) => ({ species: species[i], confidence }))
    .sort((a, b) => b.confidence - a.confidence);
  const [best, ...rest] = ranked;
  if (best.confidence < threshold) return { kind: "cant-tell", closest: ranked.slice(0, 3) };
  return { kind: "species", species: best.species, confidence: best.confidence, alsoPossible: rest.slice(0, 2) };
}
