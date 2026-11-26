/** What a species page shows, from public/species/species.json (built by training/fetch_species.py). */
export interface SpeciesInfo {
  name: string;
  slug: string;
  scientificName: string;
  wikipedia: { title: string; url: string; description: string; license: string; licenseUrl: string };
  allAboutBirds: string | null;
  photo: {
    file: string;
    width: number;
    height: number;
    photographer: string;
    attribution: string;
    license: string;
    licenseUrl: string;
    observation: string;
  };
}

/** "Chuck-will's-widow" -> "chuck-wills-widow". Must match slugify() in training/fetch_species.py. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export const speciesHref = (name: string) => `#/species/${slugify(name)}`;

export function findBySlug<T extends { slug: string }>(all: T[], slug: string): T | undefined {
  return all.find((s) => s.slug === slug);
}

/** Group names by their last word ("Song Sparrow" -> "Sparrows"), the way field guides cluster them. */
export function groupByKind(names: string[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const last = name.split(/[\s-]/).pop() ?? name;
    const kind = last.endsWith("ss") ? `${last}es` : last.endsWith("s") ? last : `${last}s`;
    groups.set(kind, [...(groups.get(kind) ?? []), name]);
  }
  const big = [...groups].filter(([, v]) => v.length > 1).sort(([a], [b]) => a.localeCompare(b));
  const singles = [...groups].filter(([, v]) => v.length === 1).flatMap(([, v]) => v).sort();
  return singles.length ? [...big, ["Others", singles]] : big;
}

/** The group a species is listed under in the full species index. */
export function groupOf(name: string, allNames: string[]): string | undefined {
  return groupByKind(allNames).find(([, members]) => members.includes(name))?.[0];
}
