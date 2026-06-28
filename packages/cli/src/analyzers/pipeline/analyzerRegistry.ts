import type {
  AnalyzerContext,
  FileAnalysis,
  FileAnalyzer
} from "../analysis/fileAnalysis.js";
import type { ScannedFile } from "../analysis/fileScanner.js";
import { FallbackAnalyzer, HeuristicAnalyzer } from "./heuristicAnalyzer.js";
import { TsMorphAnalyzer } from "../analysis/tsMorphAnalyzer.js";

export class AnalyzerRegistry {
  constructor(private readonly analyzers: FileAnalyzer[]) {}

  async analyze(file: ScannedFile, context: AnalyzerContext): Promise<FileAnalysis> {
    for (const analyzer of this.analyzers) {
      if (!analyzer.supports(file)) continue;

      try {
        return await analyzer.analyze(file, context);
      } catch {
        // Continue to the next analyzer so malformed source still receives metadata.
      }
    }

    throw new Error(`No analyzer supports ${file.path}.`);
  }
}

export async function analyzeFiles(files: ScannedFile[]): Promise<Record<string, FileAnalysis>> {
  const registry = new AnalyzerRegistry([
    new TsMorphAnalyzer(),
    new HeuristicAnalyzer(),
    new FallbackAnalyzer()
  ]);
  const context = { files };
  const entries = await Promise.all(files.map(async (file) => [
    file.path,
    await registry.analyze(file, context)
  ] as const));

  return Object.fromEntries(entries);
}
