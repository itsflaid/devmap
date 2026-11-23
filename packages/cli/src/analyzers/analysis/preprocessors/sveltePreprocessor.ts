import type { ExtractedScript, LanguagePreprocessor } from "./types.js";

/**
 * Extracts the script of a Svelte component; SvelteKit uses the same format.
 * A component can have both `<script>` (instance) and `<script context="module">`. Only the
 * instance script is read, since it holds the props and logic; the module script is the fallback
 * when it is the only one.
 */
export class SveltePreprocessor implements LanguagePreprocessor {
  readonly extensions = [".svelte"];

  extract(content: string, _filePath: string): ExtractedScript | null {
    const instanceMatch = content.match(
      /<script(?!\s[^>]*context\s*=\s*["']module["'])(\s[^>]*)?\s*>([\s\S]*?)<\/script>/i
    );

    const moduleMatch = content.match(
      /<script\s[^>]*context\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/i
    );

    const match = instanceMatch ?? moduleMatch;
    if (!match) return null;

    // The instance regex captures attrs then code; the module regex captures only code.
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
