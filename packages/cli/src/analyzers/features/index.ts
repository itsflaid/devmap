export {
  detectFeatures,
  detectAuthenticationSemanticRole,
  orderAuthenticationFiles,
  authenticationFilePriority,
  classifyFileTier,
  featureFilePriority,
} from "./featureDetector.js";
export type {
  FeatureInfo,
  AuthSemanticRole,
  FileTier,
} from "./featureDetector.js";

export {
  toFeatureIdentity,
  mergeIntoFeatureList,
  mergeFeatureData,
  mergeDomainFeatures,
} from "./featureMerge.js";

export {
  computeSimilarity,
  isSimilarFeature,
  findSimilarFeature,
  jaccardSimilarity,
  trigramSimilarity,
  buildFeatureFingerprint,
  fingerprintSimilarity,
  DEFAULT_SIMILARITY_THRESHOLD,
} from "./featureSimilarity.js";

export {
  reconcileFeatureCandidates,
  projectFeatureCandidates,
} from "./featureCandidates.js";
export type {
  FeatureCandidate,
  FeatureCandidateSource,
  FeatureCluster,
  FeatureEvidence,
  FeatureReconciliation,
  ObservationReliability,
} from "./featureCandidates.js";
export type {
  FeatureIdentity,
  FeatureFingerprint,
} from "./featureSimilarity.js";
