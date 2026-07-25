export {
  detectFramework,
  detectFrameworks,
} from "./frameworkDetector.js";
export type {
  Framework,
  DetectedFramework,
} from "./frameworkDetector.js";

export {
  detectRoutes,
} from "./routeDetector.js";
export type {
  RouteInfo,
} from "./routeDetector.js";

export {
  detectExternalServices,
} from "./serviceDetector.js";

export {
  detectDatabase,
} from "./databaseDetector.js";
export type {
  DatabaseInfo,
} from "./databaseDetector.js";

export {
  detectCapabilities,
} from "./capabilityDetector.js";
export type {
  CapabilityKind,
  CapabilityInfo,
} from "./capabilityDetector.js";

export {
  detectFrontendPageFeatures,
} from "./frontendFeatureDetector.js";