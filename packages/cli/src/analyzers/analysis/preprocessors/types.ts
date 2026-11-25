/**
 * Extracts the embedded JS/TS from a component format (Vue, Svelte, Astro), which ts-morph cannot
 * parse as a whole. When `extract` returns null (template-only file), `TsMorphAnalyzer` returns an
 * empty medium-confidence analysis; the file is not passed to `HeuristicAnalyzer`.
 */
export interface LanguagePreprocessor {
  /** Lowercase extensions including the dot, e.g. `".vue"`. Must not overlap with another preprocessor. */
  readonly extensions: string[];

  /** Returns null when there is no script block (a template-only file is valid). */
  extract(content: string, filePath: string): ExtractedScript | null;
}

export type ExtractedScript = {
  code: string;
  language: "ts" | "js";
  /** Number of lines in the original file before the extracted code starts. */
  lineOffset: number;
  /** Extension for the virtual source file; defaults to `.ts` or `.js` from `language`. Set it to get JSX parsing. */
  virtualExtension?: ".ts" | ".tsx" | ".js" | ".jsx";
};
