export {
  SNAPSHOT_SCHEMA_VERSION,
  createProjectMap,
  createProjectFingerprint,
  generateFeatureFlows,
  generateRequestFlows,
  renderMermaidFlow,
} from "./projectMap.js";
export type {
  FileScope,
  FlowInfo,
  FileIndexEntry,
  ProjectMap,
} from "./projectMap.js";

export {
  AnalyzerRegistry,
  analyzeFiles,
} from "./analyzerRegistry.js";

export {
  HeuristicAnalyzer,
  FallbackAnalyzer,
} from "./heuristicAnalyzer.js";

export {
  detectProjectMetadata,
} from "./projectMetadata.js";
export type {
  ProjectLanguage,
  PackageManager,
  ProjectType,
  WorkspaceType,
  ProjectMetadata,
} from "./projectMetadata.js";
