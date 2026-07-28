export {
  buildDependencyGraph,
  countReferences,
} from "./dependencyGraph.js";
export type {
  FileGraph,
} from "./dependencyGraph.js";

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
