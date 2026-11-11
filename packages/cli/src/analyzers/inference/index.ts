export {
  inferDomain,
  domainFeaturesToFeatureInfo,
  buildDomainInferenceInput,
} from "./domainInference.js";
export type {
  DomainInferenceResult,
  DomainFeature,
  DomainInferenceInput,
} from "./domainInference.js";
export { groundDomain } from "./domainGrounding.js";
export type { DomainEvidence, DomainGrounding } from "./domainGrounding.js";
export {
  classifyOwnershipTopology,
} from "./ownershipTopology.js";
export type {
  OwnershipPattern,
} from "./ownershipTopology.js";
