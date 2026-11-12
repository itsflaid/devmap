import type { ExtractedScript, LanguagePreprocessor } from "./types.js";

function countNewlines(text: string): number {
  let count = 0;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) count++;
  return count;
}

/**
 * An SFC may carry `<script>` (module-level exports) next to `<script setup>`.
 * Both feed one virtual module; newlines keep every block on its original line.
 */
function mergeScriptBlocks(content: string, blocks: RegExpMatchArray[]): ExtractedScript {
  let code = "";
  let cursorLine = 0;
  let isTypeScript = false;

  for (const block of blocks) {
    const body = block[2];
    const contentStart = (block.index ?? 0) + block[0].indexOf(body);
    const startLine = countNewlines(content.slice(0, contentStart));
    code += "\n".repeat(Math.max(0, startLine - cursorLine)) + body;
    cursorLine = startLine + countNewlines(body);
    if (/\blang\s*=\s*["']tsx?["']/.test(block[1] ?? "")) isTypeScript = true;
  }

  return {
    code,
    language: isTypeScript ? "ts" : "js",
    lineOffset: 0,
    virtualExtension: isTypeScript ? ".tsx" : ".jsx"
  };
}

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
    const blocks = [...content.matchAll(/<script(\s[^>]*)?\s*>([\s\S]*?)<\/script>/gi)]
      .filter((block) => block[2].trim());
    if (blocks.length > 1) return mergeScriptBlocks(content, blocks);

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
