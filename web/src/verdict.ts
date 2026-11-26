export interface Match {
  species: string;
  confidence: number;
}

/**
 * What the site tells the visitor. A species is named only when the model's
 * Confidence reaches the Threshold; otherwise it can't tell and shows the
 * closest matches instead.
 */
export type Verdict =
  | { kind: "species"; species: string; confidence: number; alsoPossible: Match[] }
  | { kind: "cant-tell"; closest: Match[] };

export function verdict(confidences: ArrayLike<number>, species: string[], threshold: number): Verdict {
  const ranked = Array.from(confidences, (confidence, i) => ({ species: species[i], confidence }))
    .sort((a, b) => b.confidence - a.confidence);
  const [best, ...rest] = ranked;
  if (best.confidence < threshold) return { kind: "cant-tell", closest: ranked.slice(0, 3) };
  return { kind: "species", species: best.species, confidence: best.confidence, alsoPossible: rest.slice(0, 2) };
}
