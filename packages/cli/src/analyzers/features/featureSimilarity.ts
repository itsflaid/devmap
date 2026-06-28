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
// Weights
//
// File overlap mendapat bobot tertinggi karena paling concrete:
// dua feature yang share file yang sama hampir pasti feature yang sama.
//
// Name similarity mendapat bobot rendah karena paling volatile:
// AI dapat generate "Plan Management" atau "Customizable Plans" untuk
// konsep yang sama — ini yang kita coba hilangkan sebagai primary key.
// ---------------------------------------------------------------------------

const WEIGHTS = {
  /** File paths yang overlap */
  fileOverlap: 0.45,
  /** searchTerms yang overlap */
  termOverlap: 0.25,
  /** relatedEntities yang overlap */
  entityOverlap: 0.20,
  /** Trigram similarity antara nama */
  nameSimilarity: 0.10,
} as const;

/**
 * DEFAULT_THRESHOLD — minimum composite score biar dua feature dianggap sama.
 *
 * 0.35 dipilih setelah evaluasi beberapa contoh nyata:
 *   "Plan Management" ↔ "Customizable Plans":
 *     - termOverlap: "plan", "management" → ~0.5 * 0.25 = 0.125
 *     - entityOverlap: "Plan" match → 1.0 * 0.20 = 0.20
 *     - nameSimilarity: trigram ~0.3 * 0.10 = 0.03
 *     - total: ~0.355 → MATCH ✓
 *
 *   "Authentication" ↔ "Search":
 *     - no file / term / entity overlap
 *     - nameSimilarity: very low
 *     - total: ~0.02 → NO MATCH ✓
 *
 *   "Search" ↔ "Search Functionality":
 *     - termOverlap: "search" → high * 0.25 = 0.25
 *     - nameSimilarity: trigram ~0.55 * 0.10 = 0.055
 *     - total: ~0.305 → borderline; kalau ada entity overlap juga = MATCH ✓
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.35;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * computeSimilarity — hitung composite similarity score antara dua feature.
 *
 * @returns 0.0 - 1.0 (0 = no similarity, 1 = identical)
 */
export function computeSimilarity(a: FeatureIdentity, b: FeatureIdentity): number {
  const fileScore   = jaccardSimilarity(new Set(a.files), new Set(b.files));
  const termScore   = jaccardSimilarity(new Set(normTerms(a.searchTerms)), new Set(normTerms(b.searchTerms)));
  const entityScore = jaccardSimilarity(new Set(normTerms(a.relatedEntities)), new Set(normTerms(b.relatedEntities)));
  const nameScore   = trigramSimilarity(a.name, b.name);

  return (
    fileScore   * WEIGHTS.fileOverlap +
    termScore   * WEIGHTS.termOverlap +
    entityScore * WEIGHTS.entityOverlap +
    nameScore   * WEIGHTS.nameSimilarity
  );
}

/**
 * isSimilarFeature — convenience wrapper dengan threshold.
 */
export function isSimilarFeature(
  a: FeatureIdentity,
  b: FeatureIdentity,
  threshold = DEFAULT_SIMILARITY_THRESHOLD
): boolean {
  return computeSimilarity(a, b) >= threshold;
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
  threshold = DEFAULT_SIMILARITY_THRESHOLD
): { index: number; score: number } | null {
  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < candidates.length; i++) {
    const score = computeSimilarity(candidates[i], target);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex === -1 || bestScore < threshold) return null;
  return { index: bestIndex, score: bestScore };
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
  return (
    fileScore   * (WEIGHTS.fileOverlap / (1 - WEIGHTS.nameSimilarity)) +
    termScore   * (WEIGHTS.termOverlap / (1 - WEIGHTS.nameSimilarity)) +
    entityScore * (WEIGHTS.entityOverlap / (1 - WEIGHTS.nameSimilarity))
  );
}
