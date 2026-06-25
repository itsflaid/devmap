/**
 * LanguagePreprocessor — extracts embedded JS/TS from non-native file formats.
 *
 * Some frameworks (Vue, Svelte, Astro) put JS/TS inside a larger file format
 * alongside templates, styles, and markup. ts-morph can only parse pure JS/TS,
 * so these files need a preprocessing step first.
 *
 * Flow:
 *   ScannedFile (.vue/.svelte/.astro)
 *     → preprocessor.extract()
 *     → ExtractedScript (pure TS/JS code)
 *     → ts-morph parse
 *     → FileAnalysis (confidence: "high")
 *
 * If extract() returns null (e.g. template-only .vue with no <script>),
 * TsMorphAnalyzer returns confidence: "medium" and falls back to empty analysis
 * rather than crashing or passing to HeuristicAnalyzer.
 */
export interface LanguagePreprocessor {
  /** File extensions this preprocessor handles, e.g. [".vue", ".astro"] */
  readonly extensions: string[];

  /**
   * Extract the JS/TS portion from file content.
   * Returns null if no script block is found (template-only files are valid).
   */
  extract(content: string, filePath: string): ExtractedScript | null;
}

export type ExtractedScript = {
  /** Pure JS/TS code, ready for ts-morph to parse */
  code: string;
  /** Whether the extracted code should be treated as TypeScript */
  language: "ts" | "js";
  /**
   * Line offset from the original file start.
   * Used to remap line numbers in analysis results back to original file coords.
   * e.g. if frontmatter starts at line 1 after "---", offset = 1.
   */
  lineOffset: number;
  /**
   * Virtual file extension ts-morph should use when creating the source file.
   * Defaults to .ts or .js based on language field — override only when needed.
   */
  virtualExtension?: ".ts" | ".tsx" | ".js" | ".jsx";
};
