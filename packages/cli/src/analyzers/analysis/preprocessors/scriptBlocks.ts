import type { ExtractedScript } from "./types.js";

type ScriptBlock = {
  attrs: string;
  code: string;
  /** Offset of the block body inside the original file. */
  contentStart: number;
};

const SCRIPT_BLOCK_PATTERN = /<script(\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/script\s*>/gi;
const DATA_SCRIPT_TYPE = /\btype\s*=\s*["'][^"']*(?:json|template|html)[^"']*["']/i;

function readScriptBlocks(content: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  SCRIPT_BLOCK_PATTERN.lastIndex = 0;

  let match = SCRIPT_BLOCK_PATTERN.exec(content);
  while (match) {
    const attrs = match[1] ?? "";
    const code = match[2];
    if (code.trim() && !DATA_SCRIPT_TYPE.test(attrs)) {
      blocks.push({
        attrs,
        code,
        contentStart: match.index + match[0].indexOf(code)
      });
    }
    match = SCRIPT_BLOCK_PATTERN.exec(content);
  }

  return blocks;
}

function lineOffsetOf(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length - 1;
}

/**
 * Single-file components may carry more than one script block: Vue's
 * `<script>` next to `<script setup>`, Svelte's instance script next to the
 * module script. Every block is part of the same module, so they are joined
 * into one source for the analyzer instead of keeping only the first.
 */
export function mergeScriptBlocks(
  content: string
): { script: ExtractedScript; blockCount: number } | null {
  const blocks = readScriptBlocks(content);
  if (blocks.length === 0) return null;

  const isTypeScript = blocks.some((block) => /\blang\s*=\s*["']tsx?["']/.test(block.attrs));
  const code = blocks.map((block) => block.code.trim()).join("\n\n");

  return {
    script: {
      code,
      language: isTypeScript ? "ts" : "js",
      lineOffset: lineOffsetOf(content, blocks[0].contentStart),
      virtualExtension: isTypeScript ? ".tsx" : ".jsx"
    },
    blockCount: blocks.length
  };
}
