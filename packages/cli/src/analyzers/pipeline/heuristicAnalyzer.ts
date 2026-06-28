import type {
  AnalyzerContext,
  FileAnalysis,
  FileAnalyzer,
  FunctionInfo,
  SymbolInfo
} from "../analysis/fileAnalysis.js";
import type { ScannedFile } from "../analysis/fileScanner.js";

// TS/JS extensions are intentionally excluded here.
// TsMorphAnalyzer handles .ts/.tsx/.js/.jsx with full AST accuracy (confidence: "high").
// If ts-morph throws on a malformed file, AnalyzerRegistry falls through to this analyzer.
// Keeping TS/JS out of this set makes that fallback explicit rather than silent.
//
// TODO: Replace regex-based analysis for non-JS languages with tree-sitter grammars post-MVP.
// Current regex approach covers import/export detection well enough for MVP scope,
// but won't handle scope-aware analysis (e.g. distinguishing code from comments in Python).
const HEURISTIC_EXTENSIONS = new Set([
  ".cjs",
  ".cs",
  ".cts",
  ".go",
  ".java",
  ".mjs",
  ".mts",
  ".php",
  ".py",
  ".rb",
]);

export class HeuristicAnalyzer implements FileAnalyzer {
  readonly id = "heuristic";

  supports(file: ScannedFile): boolean {
    return HEURISTIC_EXTENSIONS.has(file.extension);
  }

  async analyze(file: ScannedFile, _context: AnalyzerContext): Promise<FileAnalysis> {
    const imports = readImportSpecifiers(file.content);
    const symbols = readSymbols(file.content);
    const exports = symbols
      .filter((symbol) => symbol.exported)
      .map((symbol) => symbol.name)
      .sort();
    const topFunctions = symbols
      .filter((symbol): symbol is SymbolInfo & { kind: FunctionInfo["kind"] } =>
        ["function", "const", "class", "method"].includes(symbol.kind)
      )
      .map((symbol) => ({
        name: symbol.name,
        kind: symbol.kind,
        line: symbol.line,
        exported: symbol.exported,
        async: symbol.async ?? false
      }))
      .sort(compareFunctions)
      .slice(0, 8);

    return {
      analyzer: this.id,
      confidence: "medium",
      imports,
      exports,
      symbols,
      topFunctions
    };
  }
}

export class FallbackAnalyzer implements FileAnalyzer {
  readonly id = "fallback";

  supports(_file: ScannedFile): boolean {
    return true;
  }

  async analyze(_file: ScannedFile, _context: AnalyzerContext): Promise<FileAnalysis> {
    return {
      analyzer: this.id,
      confidence: "low",
      imports: [],
      exports: [],
      symbols: [],
      topFunctions: []
    };
  }
}

function readImportSpecifiers(content: string): string[] {
  const imports = new Set<string>();
  const pattern = /(?:import\s+(?:[^'"]+\s+from\s+)?|export\s+[^'"]+\s+from\s+|require\()\s*['"]([^'"]+)['"]/g;
  let match = pattern.exec(content);

  while (match) {
    imports.add(match[1]);
    match = pattern.exec(content);
  }

  return [...imports];
}

function readSymbols(content: string): SymbolInfo[] {
  const symbols = new Map<string, SymbolInfo>();
  const patterns: Array<{
    kind: SymbolInfo["kind"];
    pattern: RegExp;
    nameIndex: number;
    exportedIndex?: number;
    asyncIndex?: number;
  }> = [
    {
      kind: "function",
      pattern: /(export\s+)?(async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
      nameIndex: 3,
      exportedIndex: 1,
      asyncIndex: 2
    },
    {
      kind: "const",
      pattern: /(export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(async\s*)?/g,
      nameIndex: 2,
      exportedIndex: 1,
      asyncIndex: 3
    },
    {
      kind: "class",
      pattern: /(export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
      nameIndex: 2,
      exportedIndex: 1
    },
    {
      kind: "interface",
      pattern: /(export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
      nameIndex: 2,
      exportedIndex: 1
    },
    {
      kind: "type",
      pattern: /(export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
      nameIndex: 2,
      exportedIndex: 1
    },
    {
      kind: "enum",
      pattern: /(export\s+)?enum\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
      nameIndex: 2,
      exportedIndex: 1
    }
  ];

  for (const { kind, pattern, nameIndex, exportedIndex, asyncIndex } of patterns) {
    let match = pattern.exec(content);
    while (match) {
      const name = match[nameIndex];
      const candidate: SymbolInfo = {
        name,
        kind,
        line: lineAt(content, match.index),
        exported: exportedIndex !== undefined && Boolean(match[exportedIndex]),
        ...(asyncIndex !== undefined ? { async: Boolean(match[asyncIndex]) } : {})
      };
      const existing = symbols.get(name);
      if (!existing || Number(candidate.exported) > Number(existing.exported)) {
        symbols.set(name, candidate);
      }
      match = pattern.exec(content);
    }
  }

  return [...symbols.values()].sort((left, right) => left.line - right.line || left.name.localeCompare(right.name));
}

function lineAt(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

function compareFunctions(left: FunctionInfo, right: FunctionInfo): number {
  return Number(right.exported) - Number(left.exported)
    || left.line - right.line
    || left.name.localeCompare(right.name);
}
