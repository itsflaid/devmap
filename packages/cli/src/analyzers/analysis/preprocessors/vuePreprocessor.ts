import { mergeScriptBlocks } from "./scriptBlocks.js";
import type { ExtractedScript, LanguagePreprocessor } from "./types.js";

/**
 * VuePreprocessor — extracts the script of a Vue SFC.
 *
 *   <script lang="ts">          → TypeScript
 *   <script setup lang="ts">    → TypeScript (Composition API)
 *   <script>                    → JavaScript
 *   <script setup>              → JavaScript (Composition API)
 *
 * An SFC can hold both a plain `<script>` (options such as `beforeRouteEnter`
 * or `inheritAttrs`) and a `<script setup>`. They compile into one module, so
 * both are read; keeping only the first one drops every import of the other.
 *
 * Nuxt uses the same SFC format, so this covers Nuxt projects too.
 * Returns null for template-only components, which are valid in Vue.
 */
export class VuePreprocessor implements LanguagePreprocessor {
  readonly extensions = [".vue"];

  extract(content: string, _filePath: string): ExtractedScript | null {
    return mergeScriptBlocks(content)?.script ?? null;
  }
}
