// Weighted similarity between two features, independent of their names: the composite score is
// 0.0 to 1.0 and the weights follow how reliable each factor is. Shared files are concrete
// evidence; the name is the weakest factor because AI-written wording changes between runs.
//
// The default threshold of 0.35 is tuned so features that share entities and search terms match
// ("Search" and "Search Functionality") while unrelated ones ("Authentication", "Search") do not.

// Deliberately smaller than FeatureInfo so callers can compare without building a full feature.
export type FeatureIdentity = {
  name: string;
  files: string[];
  /** Keywords from signal definitions, entity names and similar sources. */
  searchTerms: string[];
  /** From the entity graph or `domainFeature.relatedEntities`. */
  relatedEntities: string[];
  /** Route resources are a hard anchor when both sides resolve to the same resource. */
  routePaths?: string[];
  /** Soft signal only. */
  purpose?: string;
};

/** Cap on search terms kept when features are merged (see `mergeFeatureData`). */
export const MAX_SEARCH_TERMS = 8;

export type FeatureSimilarityConfig = {
  weights: {
    fileOverlap: number;
    termOverlap: number;
    entityOverlap: number;
    nameSimilarity: number;
  };
  threshold: number;
};

const DEFAULT_WEIGHTS = {
  fileOverlap: 0.45,
  termOverlap: 0.25,
  entityOverlap: 0.20,
  nameSimilarity: 0.10,
} as const;

export const DEFAULT_SIMILARITY_CONFIG: FeatureSimilarityConfig = {
  weights: DEFAULT_WEIGHTS,
  threshold: 0.35,
};

export const DEFAULT_SIMILARITY_THRESHOLD = DEFAULT_SIMILARITY_CONFIG.threshold;

function resolveConfig(config?: FeatureSimilarityConfig): FeatureSimilarityConfig {
  return config ?? DEFAULT_SIMILARITY_CONFIG;
}

export function computeSimilarity(
  a: FeatureIdentity,
  b: FeatureIdentity,
  config?: FeatureSimilarityConfig
): number {
  const { weights } = resolveConfig(config);

  const fileScore = jaccardSimilarity(new Set(a.files), new Set(b.files));
  const termScore = jaccardSimilarity(new Set(normTerms(a.searchTerms)), new Set(normTerms(b.searchTerms)));
  const entityScore = jaccardSimilarity(new Set(normTerms(a.relatedEntities)), new Set(normTerms(b.relatedEntities)));
  const nameScore = trigramSimilarity(a.name, b.name);

  return (
    fileScore   * weights.fileOverlap +
    termScore   * weights.termOverlap +
    entityScore * weights.entityOverlap +
    nameScore   * weights.nameSimilarity
  );
}

export function isSimilarFeature(
  a: FeatureIdentity,
  b: FeatureIdentity,
  thresholdOrConfig?: number | FeatureSimilarityConfig
): boolean {
  if (typeof thresholdOrConfig === "number") {
    return computeSimilarity(a, b) >= thresholdOrConfig;
  }
  const config = resolveConfig(thresholdOrConfig);
  return computeSimilarity(a, b, config) >= config.threshold;
}

/** The best-scoring candidate at or above the threshold, or null when none reaches it. */
export function findSimilarFeature(
  candidates: FeatureIdentity[],
  target: FeatureIdentity,
  thresholdOrConfig?: number | FeatureSimilarityConfig
): { index: number; score: number } | null {
  const config = resolveConfig(
    typeof thresholdOrConfig === "object" ? thresholdOrConfig : undefined
  );
  const threshold = typeof thresholdOrConfig === "number"
    ? thresholdOrConfig
    : config.threshold;

  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < candidates.length; i++) {
    const score = computeSimilarity(candidates[i], target, config);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex === -1 || bestScore < threshold) return null;
  return { index: bestIndex, score: bestScore };
}

/**
 * Per-factor breakdown for debugging.
 * @internal
 */
export type SimilarityExplanation = {
  score: number;
  threshold: number;
  similar: boolean;
  factors: {
    fileOverlap: { score: number; weight: number; contribution: number; detail: string };
    termOverlap: { score: number; weight: number; contribution: number; detail: string };
    entityOverlap: { score: number; weight: number; contribution: number; detail: string };
    nameSimilarity: { score: number; weight: number; contribution: number; detail: string };
  };
  weaknesses: string[];
};

/**
 * Same score as `computeSimilarity`, with the per-factor breakdown.
 * @internal
 */
export function computeSimilarityWithExplanation(
  a: FeatureIdentity,
  b: FeatureIdentity,
  config?: FeatureSimilarityConfig
): SimilarityExplanation {
  const { weights, threshold } = resolveConfig(config);

  const fileScore   = jaccardSimilarity(new Set(a.files), new Set(b.files));
  const termScore   = jaccardSimilarity(new Set(normTerms(a.searchTerms)), new Set(normTerms(b.searchTerms)));
  const entityScore = jaccardSimilarity(new Set(normTerms(a.relatedEntities)), new Set(normTerms(b.relatedEntities)));
  const nameScore   = trigramSimilarity(a.name, b.name);

  const factors = {
    fileOverlap: {
      score: fileScore,
      weight: weights.fileOverlap,
      contribution: fileScore * weights.fileOverlap,
      detail: a.files.length === 0 && b.files.length === 0
        ? "both empty"
        : a.files.length === 0 || b.files.length === 0
          ? "one side empty"
          : `overlap ${describeFilesOverlap(a.files, b.files)}`,
    },
    termOverlap: {
      score: termScore,
      weight: weights.termOverlap,
      contribution: termScore * weights.termOverlap,
      detail: a.searchTerms.length === 0 && b.searchTerms.length === 0
        ? "both empty"
        : a.searchTerms.length === 0 || b.searchTerms.length === 0
          ? "one side empty"
          : `jaccard ${termScore.toFixed(3)}`,
    },
    entityOverlap: {
      score: entityScore,
      weight: weights.entityOverlap,
      contribution: entityScore * weights.entityOverlap,
      detail: a.relatedEntities.length === 0 && b.relatedEntities.length === 0
        ? "both empty"
        : a.relatedEntities.length === 0 || b.relatedEntities.length === 0
          ? "one side empty"
          : `jaccard ${entityScore.toFixed(3)}`,
    },
    nameSimilarity: {
      score: nameScore,
      weight: weights.nameSimilarity,
      contribution: nameScore * weights.nameSimilarity,
      detail: `trigram ${nameScore.toFixed(3)}`,
    },
  };

  const total = factors.fileOverlap.contribution
    + factors.termOverlap.contribution
    + factors.entityOverlap.contribution
    + factors.nameSimilarity.contribution;

  const weaknesses: string[] = [];
  if (a.files.length === 0 || b.files.length === 0) {
    weaknesses.push("one or both sides have no files — fileOverlap may be unreliable");
  }
  if (total < threshold && total >= threshold - 0.1) {
    weaknesses.push(`score ${total.toFixed(3)} is close to threshold ${threshold}`);
  }

  return {
    score: total,
    threshold,
    similar: total >= threshold,
    factors,
    weaknesses,
  };
}

function describeFilesOverlap(a: string[], b: string[]): string {
  const setA = new Set(a);
  const overlap = b.filter((f) => setA.has(f));
  return overlap.length > 0
    ? `${overlap.length}/${Math.max(a.length, b.length)} files`
    : "none";
}

/** |A ∩ B| / |A ∪ B|. Two empty sets score 0, not 1: features with no data are not evidence of a match. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0.0;
  if (a.size === 0 || b.size === 0) return 0.0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0.0 : intersection / union;
}

/**
 * Dice coefficient (2|A ∩ B| / (|A| + |B|)) over character trigrams, which copes with short
 * names better than Levenshtein. "Plan Management" vs "Customizable Plans" is about 0.16,
 * "Authentication" vs "Authentication System" about 0.77, "Search" vs "Search Functionality"
 * about 0.47. Only a soft signal (weight 0.10) because AI wording varies.
 */
export function trigramSimilarity(a: string, b: string): number {
  const ta = buildTrigrams(a.toLowerCase());
  const tb = buildTrigrams(b.toLowerCase());

  if (ta.size === 0 && tb.size === 0) return 0.0;
  if (ta.size === 0 || tb.size === 0) return 0.0;

  let intersection = 0;
  for (const g of ta) {
    if (tb.has(g)) intersection++;
  }

  return (2 * intersection) / (ta.size + tb.size);
}

function buildTrigrams(s: string): Set<string> {
  const grams = new Set<string>();
  const padded = `  ${s}  `;
  for (let i = 0; i < padded.length - 2; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

// Lowercases only; stopwords are kept because stripping them can drop real signal.
function normTerms(terms: string[]): string[] {
  return terms.map((t) => t.toLowerCase().trim()).filter(Boolean);
}

function comparableDimension(left: string[], right: string[], weight: number): { score: number; weight: number } {
  return { score: jaccardSimilarity(new Set(left), new Set(right)), weight };
}

// Not used by the pipeline yet. A fingerprint is built from files, terms and entities rather than
// the name, so a feature renamed between runs ("Plan Management" / "Customizable Plans") could be
// matched to its earlier fingerprint if one were persisted.
export type FeatureFingerprint = {
  /** Sorted, normalized, `|`-joined file paths. */
  fileSignature: string;
  termSignature: string;
  entitySignature: string;
};

export function buildFeatureFingerprint(identity: FeatureIdentity): FeatureFingerprint {
  return {
    fileSignature:   [...identity.files].sort().join("|"),
    termSignature:   [...normTerms(identity.searchTerms)].sort().join("|"),
    entitySignature: [...normTerms(identity.relatedEntities)].sort().join("|"),
  };
}

/** Compares two fingerprints without rebuilding a `FeatureIdentity`. */
export function fingerprintSimilarity(a: FeatureFingerprint, b: FeatureFingerprint): number {
  const fileScore   = jaccardSimilarity(
    new Set(a.fileSignature.split("|").filter(Boolean)),
    new Set(b.fileSignature.split("|").filter(Boolean))
  );
  const termScore   = jaccardSimilarity(
    new Set(a.termSignature.split("|").filter(Boolean)),
    new Set(b.termSignature.split("|").filter(Boolean))
  );
  const entityScore = jaccardSimilarity(
    new Set(a.entitySignature.split("|").filter(Boolean)),
    new Set(b.entitySignature.split("|").filter(Boolean))
  );

  // No name factor: a fingerprint does not store the name.
  const { weights } = DEFAULT_SIMILARITY_CONFIG;
  return (
    fileScore   * weights.fileOverlap +
    termScore   * weights.termOverlap +
    entityScore * weights.entityOverlap
  );
}
