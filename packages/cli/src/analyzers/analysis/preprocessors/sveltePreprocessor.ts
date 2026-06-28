import type { ExtractedScript, LanguagePreprocessor } from "./types.js";

/**
 * SveltePreprocessor — extracts <script> from Svelte components.
 *
 * Handles Svelte-specific patterns:
 *   <script lang="ts">          → TypeScript
 *   <script>                    → JavaScript
 *   <script context="module">   → Module-level script (also extracted)
 *
 * Note: Svelte files can have TWO script blocks:
 *   1. <script context="module"> — runs once at module level
 *   2. <script>                  — runs per component instance
 *
 * We prefer the instance script (no context="module") as it contains
 * the component's reactive declarations, props, and logic.
 * If only a module script exists, we extract that instead.
 *
 * Also handles SvelteKit files — identical .svelte format,
 * one preprocessor covers both Svelte and SvelteKit projects.
 *
 * Returns null for markup-only components with no <script> block.
 */
export class SveltePreprocessor implements LanguagePreprocessor {
  readonly extensions = [".svelte"];

  extract(content: string, _filePath: string): ExtractedScript | null {
    // Try instance script first (no context="module")
    const instanceMatch = content.match(
      /<script(?!\s[^>]*context\s*=\s*["']module["'])(\s[^>]*)?\s*>([\s\S]*?)<\/script>/i
    );

    // Fallback to module script if no instance script
    const moduleMatch = content.match(
      /<script\s[^>]*context\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/i
    );

    const match = instanceMatch ?? moduleMatch;
    if (!match) return null;

    // For instance match: attrs at index 1, code at index 2
    // For module match: code at index 1
    const attrs = instanceMatch ? (match[1] ?? "") : "";
    const code = instanceMatch ? match[2] : match[1];

    if (!code?.trim()) return null;

    const isTypeScript = /\blang\s*=\s*["']ts["']/.test(attrs);

    const scriptTagStart = match.index ?? 0;
    const contentStart = scriptTagStart + match[0].indexOf(code);
    const lineOffset = content.slice(0, contentStart).split("\n").length - 1;

    return {
      code,
      language: isTypeScript ? "ts" : "js",
      lineOffset,
      virtualExtension: isTypeScript ? ".ts" : ".js"
    };
  }
}
