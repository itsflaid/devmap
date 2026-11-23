import type { FeatureInfo } from "./featureDetector.js";
import {
  findSimilarFeature,
  type FeatureIdentity,
  MAX_SEARCH_TERMS,
  DEFAULT_SIMILARITY_THRESHOLD,
} from "./featureSimilarity.js";

export function toFeatureIdentity(feature: FeatureInfo): FeatureIdentity {
  return {
    name: feature.name,
    // Sorted so similarity results do not depend on input order.
    files: [...feature.files].sort(),
    searchTerms: [...feature.searchTerms].sort(),
    relatedEntities: extractRelatedEntities(feature).sort(),
    purpose: feature.purpose,
  };
}

// Deliberately strict: searchTerms also hold generic technical keywords, which must not
// count as entities. Plain searchTerms still reach the similarity score through termOverlap,
// so entityOverlap only captures names stated explicitly.
function extractRelatedEntities(feature: FeatureInfo): string[] {
  const entities: string[] = [];

  // "X Management" / "X System" / "X Module" names entity "X".
  const nameMatch = feature.name.match(/^(.+?)\s+(?:Management|System|Module|Feature|Service)$/i);
  if (nameMatch) {
    entities.push(nameMatch[1].trim());
  }

  // Entity names are the Title Case searchTerms; registry signal terms are lowercase and fail this test.
  for (const term of feature.searchTerms) {
    if (/^[A-Z]/.test(term)) {
      entities.push(term);
    }
  }

  return [...new Set(entities)];
}

/**
 * Merges `addition` into `features` in place: into the most similar existing feature,
 * or appended when none reaches `threshold`.
 *
 * The first-seen name is canonical and never overwritten, which keeps names stable across
 * runs: if "Plan Management" exists, a later AI feature "Customizable Plans" merges into it
 * without renaming it.
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
    features.push(addition);
    return;
  }

  const existing = features[match.index];
  features[match.index] = mergeFeatureData(existing, addition);
}

/**
 * Combines two features already judged to be the same one. `existing` keeps its name,
 * and keeps its purpose and business flow unless they are generic placeholders.
 * List fields are unioned (searchTerms capped at `MAX_SEARCH_TERMS`) and the higher
 * confidence wins.
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

/**
 * Merges AI-inferred features into the static list (mutated). Matching is by similarity,
 * not name equality, so "Customizable Plans" folds into an existing "Plan Management".
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

function dedup<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

type Confidence = FeatureInfo["confidence"];

function higherConfidence(a: Confidence, b: Confidence): Confidence {
  const rank: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
  return rank[a] >= rank[b] ? a : b;
}
