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
  MAX_SEARCH_TERMS,
  DEFAULT_SIMILARITY_THRESHOLD,
} from "./featureSimilarity.js";

// ---------------------------------------------------------------------------
// Convert FeatureInfo ke FeatureIdentity untuk similarity comparison
// ---------------------------------------------------------------------------

export function toFeatureIdentity(feature: FeatureInfo): FeatureIdentity {
  return {
    name: feature.name,
    // Sort arrays deterministically agar fingerprint dan similarity
    // comparison konsisten antar-run.
    files: [...feature.files].sort(),
    searchTerms: [...feature.searchTerms].sort(),
    relatedEntities: extractRelatedEntities(feature).sort(),
    purpose: feature.purpose,
  };
}

/**
 * extractRelatedEntities — derive entity names dari feature data.
 *
 * entityGraphToFeatures() inject entity name + owned/peer names ke searchTerms.
 * capabilitiesToFeatures() juga inject entity names via cap.entities.
 *
 * Filter ketat: hanya entity name dari feature name pattern, bukan asal-asalan
 * dari searchTerms (yang bisa berisi generic technical keywords).
 *
 * entityOverlap di similarity engine tetap dapat sinyal dari searchTerms
 * melalui termOverlap — jadi entityOverlap khusus menangkap entity name
 * yang eksplisit dari feature name "X Management".
 */
function extractRelatedEntities(feature: FeatureInfo): string[] {
  const entities: string[] = [];

  // Pattern: "X Management" / "X System" / "X Module" → "X" adalah entity
  const nameMatch = feature.name.match(/^(.+?)\s+(?:Management|System|Module|Feature|Service)$/i);
  if (nameMatch) {
    entities.push(nameMatch[1].trim());
  }

  // Hanya ambil searchTerms yang eksplisit Title Case (entity names).
  // searchTerms umumnya lowercase, jadi ini filter natural.
  // Terms dari FEATURE_SIGNALS (technical keywords) tidak akan lulus.
  for (const term of feature.searchTerms) {
    if (/^[A-Z]/.test(term)) {
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
 *   - purpose: existing wins KECUALI existing adalah generic fallback
 *   - files: union (dedup)
 *   - evidence: union (dedup)
 *   - searchTerms: union (capped di MAX_SEARCH_TERMS)
 *   - confidence: ambil yang lebih tinggi (jangan downgrade)
 *   - entryPoints: union — domain feature bisa bawa entryPoints baru
 *   - businessFlow: existing wins jika meaningful, fallback ke addition
 */
export function mergeFeatureData(existing: FeatureInfo, addition: FeatureInfo): FeatureInfo {
  const resolvedPurpose = isGenericPurpose(existing.purpose) && !isGenericPurpose(addition.purpose)
    ? addition.purpose
    : existing.purpose;

  const resolvedBusinessFlow = existing.businessFlow.length > 0
      && !isPlaceholderBusinessFlow(existing.businessFlow)
    ? existing.businessFlow
    : addition.businessFlow.length > 0
      ? addition.businessFlow
      : existing.businessFlow;

  return {
    ...existing,
    purpose: resolvedPurpose,
    files: dedup([...existing.files, ...addition.files]),
    evidence: dedup([...existing.evidence, ...addition.evidence]),
    entryPoints: dedup([...existing.entryPoints, ...addition.entryPoints]),
    searchTerms: dedup([...existing.searchTerms, ...addition.searchTerms]).slice(0, MAX_SEARCH_TERMS),
    businessFlow: resolvedBusinessFlow,
    confidence: higherConfidence(existing.confidence, addition.confidence),
  };
}

function isGenericPurpose(purpose: string): boolean {
  const lower = purpose.toLowerCase();
  return (
    /^identifies .+ capability/i.test(lower)
    || /^manages .+ data and operations\.?$/i.test(lower)
    || lower.length === 0
  );
}

function isPlaceholderBusinessFlow(flow: string[]): boolean {
  return flow.length === 1 && /^Identify files related to /i.test(flow[0]);
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
