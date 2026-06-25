import type { ExtractedScript, LanguagePreprocessor } from "./types.js";

/**
 * AstroPreprocessor — extracts the frontmatter block from Astro components.
 *
 * Astro uses a fenced frontmatter syntax (like MDX/markdown):
 *
 *   ---
 *   import Component from "./Component.astro";
 *   const title = "Hello";
 *   ---
 *   <html>...</html>
 *
 * The frontmatter is always TypeScript by default in Astro — no lang attribute needed.
 * It supports full TS syntax including imports, exports, type annotations, etc.
 *
 * Returns null for markup-only .astro files with no frontmatter fences.
 * These are valid — simple Astro components often have no JS at all.
 */
export class AstroPreprocessor implements LanguagePreprocessor {
  readonly extensions = [".astro"];

  extract(content: string, _filePath: string): ExtractedScript | null {
    // Match content between opening and closing "---" fences.
    // Must be at the very start of the file (^ with multiline flag).
    // \r?\n handles both Unix and Windows line endings.
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;

    const code = match[1];
    if (!code.trim()) return null;

    // Frontmatter always starts at line 1 (after the opening "---\n")
    const lineOffset = 1;

    return {
      code,
      language: "ts", // Astro frontmatter is always TypeScript
      lineOffset,
      virtualExtension: ".ts"
    };
  }
}
