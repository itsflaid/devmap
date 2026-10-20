// Shared path matching for graph resolution: turn an import target (no
// extension, directory, or emitted `.js`) into a scanned source file.

const SOURCE_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".astro",
  ".py", ".rb", ".php"
];
const INDEX_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".astro",
  ".py", ".rb", ".php"
];

// TypeScript ESM writes the emitted extension in the specifier.
const EMITTED_EXTENSION_SOURCES: Array<[string, string[]]> = [
  [".js", [".ts", ".tsx"]],
  [".jsx", [".tsx"]],
  [".mjs", [".mts"]],
  [".cjs", [".cts"]]
];

export function matchLocalPath(normalized: string, localPaths: Set<string>): string | null {
  const candidates = [
    normalized,
    ...SOURCE_EXTENSIONS.map((extension) => `${normalized}${extension}`),
    ...INDEX_EXTENSIONS.map((extension) => `${normalized}/index${extension}`),
    `${normalized}/__init__.py`
  ];

  for (const [emitted, sources] of EMITTED_EXTENSION_SOURCES) {
    if (normalized.endsWith(emitted)) {
      const withoutExtension = normalized.slice(0, -emitted.length);
      candidates.push(...sources.map((source) => `${withoutExtension}${source}`));
    }
  }

  return candidates.find((candidate) => localPaths.has(candidate)) ?? null;
}

/** Collapse `.` and `..`; null when the path climbs above the project root. */
export function normalizePath(path: string): string | null {
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (part === "." || part === "") {
      continue;
    }

    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return parts.join("/");
}
