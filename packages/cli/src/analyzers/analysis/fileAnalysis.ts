import type { ScannedFile } from "./fileScanner.js";
import type { RouteInfo } from "../detectors/index.js";

export type AnalysisConfidence = "high" | "medium" | "low";

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "const"
  | "method";

export type SymbolInfo = {
  name: string;
  kind: SymbolKind;
  line: number;
  exported: boolean;
  async?: boolean;
};

export type FunctionInfo = {
  name: string;
  kind: "function" | "const" | "class" | "method";
  line: number;
  exported: boolean;
  async: boolean;
};

export type FileAnalysis = {
  analyzer: string;
  confidence: AnalysisConfidence;
  imports: string[];
  exports: string[];
  symbols: SymbolInfo[];
  topFunctions: FunctionInfo[];
  routes?: RouteInfo[];
};

export type AnalyzerContext = {
  files: ScannedFile[];
};

export interface FileAnalyzer {
  id: string;
  supports(file: ScannedFile): boolean;
  analyze(file: ScannedFile, context: AnalyzerContext): Promise<FileAnalysis>;
}
