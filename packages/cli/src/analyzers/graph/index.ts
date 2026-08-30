export {
  buildDependencyGraph,
  countReferences,
} from "./dependencyGraph.js";
export type {
  FileGraph,
  DependencyGraphDiagnostics,
} from "./dependencyGraph.js";

export {
  loadAliasMappings,
  resolveAlias,
} from "./aliasResolver.js";
export type {
  AliasMapping,
} from "./aliasResolver.js";

export {
  detectEntryPoints,
} from "./entryPoints.js";

export {
  isArchitectureSource,
} from "./sourceScope.js";

export {
  buildReverseGraph,
  buildBoundedTree,
  collectNodesWithinDepth,
  DEFAULT_MAX_CHILDREN,
} from "./dependencyMap.js";
export type {
  MapTreeNode,
} from "./dependencyMap.js";
