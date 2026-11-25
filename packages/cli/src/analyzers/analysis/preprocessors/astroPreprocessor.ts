import type { ExtractedScript, LanguagePreprocessor } from "./types.js";

/** Extracts the `---` fenced frontmatter of an Astro component, which is always TypeScript. */
export class AstroPreprocessor implements LanguagePreprocessor {
  readonly extensions = [".astro"];

  extract(content: string, _filePath: string): ExtractedScript | null {
    // The opening fence must be the first line of the file; \r?\n accepts CRLF files.
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;

    const code = match[1];
    if (!code.trim()) return null;

    // The code starts on the line after the opening fence.
    const lineOffset = 1;

    return {
      code,
      language: "ts",
      lineOffset,
      virtualExtension: ".ts"
    };
  }
}
