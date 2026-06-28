import type { ExtractedScript, LanguagePreprocessor } from "./types.js";

/**
 * VuePreprocessor — extracts <script> or <script setup> from Vue SFCs.
 *
 * Handles all common Vue SFC patterns:
 *   <script lang="ts">          → TypeScript
 *   <script setup lang="ts">    → TypeScript (Composition API)
 *   <script>                    → JavaScript
 *   <script setup>              → JavaScript (Composition API)
 *
 * Also handles Nuxt files — Nuxt uses identical .vue SFC format,
 * so one preprocessor covers both Vue and Nuxt projects.
 *
 * Returns null for template-only components (no <script> block).
 * These are valid in Vue — they're typically pure presentation components.
 */
export class VuePreprocessor implements LanguagePreprocessor {
  readonly extensions = [".vue"];

  extract(content: string, _filePath: string): ExtractedScript | null {
    // Match <script> or <script setup> with optional attributes.
    // Non-greedy [\s\S]*? ensures we stop at the first </script>.
    const match = content.match(/<script(\s[^>]*)?\s*>([\s\S]*?)<\/script>/i);
    if (!match) return null;

    const attrs = match[1] ?? "";
    const code = match[2];

    // Skip if no meaningful code (whitespace-only script block)
    if (!code.trim()) return null;

    const isTypeScript = /\blang\s*=\s*["']ts["']/.test(attrs);

    // Calculate line offset: count newlines before the script content starts.
    // match.index = start of <script ...>, match[0].indexOf(code) = offset to content.
    const scriptTagStart = match.index ?? 0;
    const contentStart = scriptTagStart + match[0].indexOf(code);
    const lineOffset = content.slice(0, contentStart).split("\n").length - 1;

    // Use .tsx for TS Vue files since they often contain JSX-like template refs.
    return {
      code,
      language: isTypeScript ? "ts" : "js",
      lineOffset,
      virtualExtension: isTypeScript ? ".tsx" : ".jsx"
    };
  }
}
