import { mergeScriptBlocks } from "./scriptBlocks.js";
import type { ExtractedScript, LanguagePreprocessor } from "./types.js";

/**
 * SveltePreprocessor — extracts the script of a Svelte component.
 *
 *   <script lang="ts">          → TypeScript
 *   <script>                    → JavaScript
 *   <script context="module">   → module-level script (Svelte 4)
 *   <script module>             → module-level script (Svelte 5)
 *
 * A component can have a module script next to its instance script. Both
 * belong to the same file, so both are read.
 *
 * SvelteKit uses the same format. Returns null for markup-only components.
 */
export class SveltePreprocessor implements LanguagePreprocessor {
  readonly extensions = [".svelte"];

  extract(content: string, _filePath: string): ExtractedScript | null {
    const merged = mergeScriptBlocks(content);
    if (!merged) return null;

    return {
      ...merged.script,
      virtualExtension: merged.script.language === "ts" ? ".ts" : ".js"
    };
  }
}
