export {
  scanFiles,
} from "./fileScanner.js";
export type {
  ScannedFile,
} from "./fileScanner.js";

export {
  classifyFileRole,
  isDocumentationMeta,
  isTechnicalFeatureSource,
  isArchitecturalRole,
} from "./fileRole.js";
export type {
  FileRole,
} from "./fileRole.js";

export type {
  AnalysisConfidence,
  SymbolKind,
  SymbolInfo,
  FunctionInfo,
  FileAnalysis,
  AnalyzerContext,
  FileAnalyzer,
} from "./fileAnalysis.js";

export {
  TsMorphAnalyzer,
} from "./tsMorphAnalyzer.js";

export {
  shouldIgnorePath,
} from "./filterEngine.js";

export {
  PrismaExtractor,
} from "./extractors/prismaExtractor.js";
export {
  RouteFallbackExtractor,
} from "./extractors/fallbackExtractor.js";
export {
  extractEntities,
} from "./extractors/index.js";
export type {
  EntityInfo,
  FieldInfo,
  RelationInfo,
  EntityGraph,
  IEntityExtractor,
  IRouteFallbackExtractor,
} from "./extractors/types.js";
