/**
 * featureSimilarity.ts
 *
 * Reusable similarity engine untuk feature identity comparison.
 *
 * Design goals:
 *   - Tidak bergantung pada feature name sebagai primary identity
 *   - Weighted multi-factor scoring: files, entities, searchTerms, description
 *   - Groundwork untuk future fingerprint system
 *   - No heuristic string tricks (substring, includes, normalize-only)
 *
 * Scoring model:
 *   Setiap faktor diberi bobot berbeda tergantung reliability-nya.
 *   File overlap = paling reliable (concrete evidence).
 *   Name similarity = least reliable (AI dapat berubah wording).
 *
 *   Composite score 0.0 - 1.0.
 *   Threshold default 0.35 — dipilih biar:
 *     - "Plan Management" ↔ "Customizable Plans" MATCH (entity + terms overlap)
 *     - "Authentication" ↔ "Search" TIDAK MATCH (no overlap)
 *     - "Search" ↔ "Search Functionality" MATCH (terms overlap)
 */

// ---------------------------------------------------------------------------
// Feature identity — data yang relevan untuk similarity comparison.
// Sengaja dibuat minimal agar bisa dipakai tanpa import FeatureInfo penuh.
// ---------------------------------------------------------------------------

export type FeatureIdentity = {
  name: string;
  /** File paths yang di-associate ke feature ini */
  files: string[];
  /** Search terms — keyword from signal definitions, entity names, etc. */
  searchTerms: string[];
  /** Related entity names — dari entityGraph atau domainFeature.relatedEntities */
  relatedEntities: string[];
  /** Purpose / description string — dipakai sebagai soft signal */
  purpose?: string;
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * MAX_SEARCH_TERMS — cross-cutting constant untuk search term cap.
 * Konsisten dengan featureDetector. Dipakai di similarity engine dan merge.
 */
export const MAX_SEARCH_TERMS = 8;

/**
 * FeatureSimilarityConfig — weights dan threshold yang bisa di-override.
 */
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

/**
 * DEFAULT_SIMILARITY_THRESHOLD — backward compat alias.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = DEFAULT_SIMILARITY_CONFIG.threshold;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function resolveConfig(config?: FeatureSimilarityConfig): FeatureSimilarityConfig {
  return config ?? DEFAULT_SIMILARITY_CONFIG;
}

/**
 * computeSimilarity — hitung composite similarity score antara dua feature.
 *
 * @returns 0.0 - 1.0 (0 = no similarity, 1 = identical)
 */
export function computeSimilarity(
  a: FeatureIdentity,
  b: FeatureIdentity,
  config?: FeatureSimilarityConfig
): number {
  const { weights } = resolveConfig(config);
  const fileScore   = jaccardSimilarity(new Set(a.files), new Set(b.files));
  const termScore   = jaccardSimilarity(new Set(normTerms(a.searchTerms)), new Set(normTerms(b.searchTerms)));
  const entityScore = jaccardSimilarity(new Set(normTerms(a.relatedEntities)), new Set(normTerms(b.relatedEntities)));
  const nameScore   = trigramSimilarity(a.name, b.name);

  return (
    fileScore   * weights.fileOverlap +
    termScore   * weights.termOverlap +
    entityScore * weights.entityOverlap +
    nameScore   * weights.nameSimilarity
  );
}

/**
 * isSimilarFeature — convenience wrapper dengan threshold.
 */
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

/**
 * findSimilarFeature — cari feature di list yang paling similar ke candidate.
 *
 * Return { index, score } dari match terbaik, atau null kalau tidak ada yang
 * melewati threshold.
 */
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

// ---------------------------------------------------------------------------
// Explainability — internal debugging only
// ---------------------------------------------------------------------------

/**
 * SimilarityExplanation — breakdown per faktor + reasons.
 * @internal — kandidat masuk devmap doctor output nanti, bukan public API.
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
 * computeSimilarityWithExplanation — seperti computeSimilarity, tapi return
 * breakdown detail buat debugging.
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

// ---------------------------------------------------------------------------
// Similarity algorithms
// ---------------------------------------------------------------------------

/**
 * jaccardSimilarity — |A ∩ B| / |A ∪ B|
 *
 * Dipakai untuk set-based features (files, terms, entities).
 * Return 1.0 kalau keduanya empty (dua feature tanpa data tidak conflicting).
 * Return 0.0 kalau salah satu empty dan yang lain tidak.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 1.0 : intersection / union;
}

/**
 * trigramSimilarity — Dice coefficient pada character trigrams.
 *
 * Lebih robust dari Levenshtein untuk perbandingan nama pendek.
 * "Plan Management" ↔ "Customizable Plans" → ~0.28
 * "Authentication" ↔ "Authentication System" → ~0.82
 * "Search" ↔ "Search Functionality" → ~0.55
 *
 * Dipakai sebagai soft signal saja (weight 0.10) karena AI wording volatile.
 */
export function trigramSimilarity(a: string, b: string): number {
  const ta = buildTrigrams(a.toLowerCase());
  const tb = buildTrigrams(b.toLowerCase());

  if (ta.size === 0 && tb.size === 0) return 1.0;
  if (ta.size === 0 || tb.size === 0) return 0.0;

  let intersection = 0;
  for (const g of ta) {
    if (tb.has(g)) intersection++;
  }

  // Dice coefficient: 2 * |A ∩ B| / (|A| + |B|)
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

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/**
 * normTerms — lowercase semua terms untuk case-insensitive comparison.
 * Tidak strip stopwords — terlalu agresif dan bisa hilangkan signal penting.
 */
function normTerms(terms: string[]): string[] {
  return terms.map((t) => t.toLowerCase().trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Feature fingerprint foundation
//
// Belum dipakai sekarang, tapi desain ini memungkinkan future persistence.
// Fingerprint di-derive dari data concrete (files, entities, terms),
// bukan dari nama — sehingga "Plan Management" dan "Customizable Plans"
// akan generate fingerprint yang compatible.
//
// Future usage:
//   const fp = buildFeatureFingerprint(featureIdentity);
//   // store fp in .devmap/fingerprints.json
//   // next run: match by fingerprint instead of name
// ---------------------------------------------------------------------------

export type FeatureFingerprint = {
  /** Sorted, normalized file paths */
  fileSignature: string;
  /** Sorted, normalized search terms */
  termSignature: string;
  /** Sorted, normalized entity names */
  entitySignature: string;
};

export function buildFeatureFingerprint(identity: FeatureIdentity): FeatureFingerprint {
  return {
    fileSignature:   [...identity.files].sort().join("|"),
    termSignature:   [...normTerms(identity.searchTerms)].sort().join("|"),
    entitySignature: [...normTerms(identity.relatedEntities)].sort().join("|"),
  };
}

/**
 * fingerprintSimilarity — compare dua fingerprint secara segment-by-segment.
 * Alternative entry point kalau future code ingin compare fingerprints
 * tanpa reconstruct full FeatureIdentity.
 */
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

  // tanpa nameSimilarity karena fingerprint tidak menyimpan nama
  const { weights } = DEFAULT_SIMILARITY_CONFIG;
  return (
    fileScore   * (weights.fileOverlap / (1 - weights.nameSimilarity)) +
    termScore   * (weights.termOverlap / (1 - weights.nameSimilarity)) +
    entityScore * (weights.entityOverlap / (1 - weights.nameSimilarity))
  );
}
