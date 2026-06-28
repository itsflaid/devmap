/**
 * featureMerge.ts
 *
 * Centralized feature merge logic.
 *
 * Sebelumnya merge tersebar di dua tempat:
 *   1. featureDetector.ts → mergeFeature() pakai normalizeFeatureName (string only)
 *   2. projectMap.ts → domain feature merge pakai f.name.toLowerCase() equality
 *
 * Keduanya punya flaw yang sama: bergantung pada nama sebagai identity.
 * "Plan Management" dan "Customizable Plans" tidak akan di-merge karena nama berbeda.
 *
 * Refactor ini:
 *   - Ganti kedua merge sites dengan satu fungsi: mergeIntoFeatureList()
 *   - Pakai featureSimilarity.ts sebagai basis comparison
 *   - Canonical name: first-seen wins (stabil antar-run)
 *   - Merge enriches data (files, terms, entities) tanpa rename feature
 */

import type { FeatureInfo } from "./featureDetector.js";
import {
  findSimilarFeature,
  type FeatureIdentity,
  DEFAULT_SIMILARITY_THRESHOLD,
} from "./featureSimilarity.js";

// ---------------------------------------------------------------------------
// Convert FeatureInfo ke FeatureIdentity untuk similarity comparison
// ---------------------------------------------------------------------------

export function toFeatureIdentity(feature: FeatureInfo): FeatureIdentity {
  return {
    name: feature.name,
    files: feature.files,
    searchTerms: feature.searchTerms,
    // FeatureInfo tidak punya relatedEntities field, tapi searchTerms
    // sudah include entity names dari entityGraphToFeatures — reuse itu.
    relatedEntities: extractRelatedEntities(feature),
    purpose: feature.purpose,
  };
}

/**
 * extractRelatedEntities — derive entity names dari feature data.
 *
 * entityGraphToFeatures() inject entity name + owned/peer names ke searchTerms.
 * capabilitiesToFeatures() tidak inject entity names ke searchTerms by default —
 * tapi name pattern "X Management" biasanya mengandung entity name.
 *
 * Ini heuristic minimal, bukan perfect parser. Cukup buat similarity boost.
 */
function extractRelatedEntities(feature: FeatureInfo): string[] {
  const entities: string[] = [];

  // Pattern: "X Management" / "X System" / "X Module" → "X" adalah entity
  const nameMatch = feature.name.match(/^(.+?)\s+(?:Management|System|Module|Feature|Service)$/i);
  if (nameMatch) {
    entities.push(nameMatch[1].trim());
  }

  // Ambil terms yang kemungkinan entity name (Title Case, bukan generic keyword)
  const genericKeywords = new Set([
    "management", "crud", "system", "feature", "service",
    "module", "handler", "api", "data", "info"
  ]);
  for (const term of feature.searchTerms) {
    if (term.length > 3 && !genericKeywords.has(term.toLowerCase())) {
      entities.push(term);
    }
  }

  return [...new Set(entities)];
}

// ---------------------------------------------------------------------------
// Core merge function
// ---------------------------------------------------------------------------

/**
 * mergeIntoFeatureList — merge satu feature ke list yang sudah ada.
 *
 * Algorithm:
 *   1. Cari existing feature yang similar (pakai similarity engine)
 *   2. Kalau ditemukan → enrich existing (files, terms, entities), jangan rename
 *   3. Kalau tidak ditemukan → tambah sebagai feature baru
 *
 * Canonical name: feature pertama yang masuk MENANG — tidak pernah di-overwrite.
 * Ini kunci stabilitas: walaupun AI run ke-2 generate "Customizable Plans",
 * kalau "Plan Management" sudah ada di list, namanya tetap "Plan Management".
 *
 * @param features  - List feature yang sudah ada (mutated in place)
 * @param addition  - Feature baru yang ingin di-merge
 * @param threshold - Similarity threshold (default: DEFAULT_SIMILARITY_THRESHOLD)
 */
export function mergeIntoFeatureList(
  features: FeatureInfo[],
  addition: FeatureInfo,
  threshold = DEFAULT_SIMILARITY_THRESHOLD
): void {
  const identities = features.map(toFeatureIdentity);
  const additionIdentity = toFeatureIdentity(addition);

  const match = findSimilarFeature(identities, additionIdentity, threshold);

  if (match === null) {
    // Tidak ada yang similar → tambah sebagai feature baru
    features.push(addition);
    return;
  }

  // Similar feature ditemukan → enrich tanpa rename
  const existing = features[match.index];
  features[match.index] = mergeFeatureData(existing, addition);
}

/**
 * mergeFeatureData — combine data dari dua feature yang sudah diidentifikasi sama.
 *
 * Rules:
 *   - name: existing wins (canonical first-seen)
 *   - purpose: existing wins (tidak perlu overwrite jika sudah ada)
 *   - files: union (dedup)
 *   - evidence: union (dedup)
 *   - searchTerms: union (capped at 12 biar tidak bloat)
 *   - confidence: ambil yang lebih tinggi
 *   - entryPoints: existing wins (sudah di-rank)
 *   - businessFlow: existing wins kalau non-empty
 */
export function mergeFeatureData(existing: FeatureInfo, addition: FeatureInfo): FeatureInfo {
  return {
    ...existing,
    files: dedup([...existing.files, ...addition.files]),
    evidence: dedup([...existing.evidence, ...addition.evidence]),
    searchTerms: dedup([...existing.searchTerms, ...addition.searchTerms]).slice(0, 12),
    confidence: higherConfidence(existing.confidence, addition.confidence),
    // entryPoints: existing wins — sudah di-rank dan dipilih dengan baik
    // businessFlow: existing wins — kalau sudah ada, biarkan
    // entryPoint: existing wins
    // name, purpose: existing wins (canonical)
  };
}

// ---------------------------------------------------------------------------
// Batch merge — untuk domain features dari AI inference
// ---------------------------------------------------------------------------

/**
 * mergeDomainFeatures — merge semua domain features ke static feature list.
 *
 * Ini menggantikan loop di projectMap.ts yang hanya pakai name.toLowerCase() equality.
 * Sekarang pakai similarity engine sehingga "Customizable Plans" tidak duplicate
 * "Plan Management" yang sudah ada dari static analysis.
 *
 * @param features        - Static features (mutated)
 * @param domainFeatures  - AI-inferred features
 * @param threshold       - Similarity threshold
 */
export function mergeDomainFeatures(
  features: FeatureInfo[],
  domainFeatures: FeatureInfo[],
  threshold = DEFAULT_SIMILARITY_THRESHOLD
): void {
  for (const df of domainFeatures) {
    mergeIntoFeatureList(features, df, threshold);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedup<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

type Confidence = FeatureInfo["confidence"];

function higherConfidence(a: Confidence, b: Confidence): Confidence {
  const rank: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
  return rank[a] >= rank[b] ? a : b;
}
