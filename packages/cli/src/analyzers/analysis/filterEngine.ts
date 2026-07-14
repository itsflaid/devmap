const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".devmap",
  ".agent",
  ".agents",
  ".next",
  ".turbo",
  ".vercel",
  ".astro",
  ".svelte-kit",
  ".nuxt",
  ".output",
  ".cache",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "venv",
  ".venv",
  "__pycache__"
]);

const IGNORED_EXTENSIONS = new Set([
  ".lock",
  ".log",
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
  ".wasm"
]);

const IGNORED_FILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb"
]);

export function shouldIgnorePath(path: string, isDirectory: boolean): boolean {
  const segments = path.split("/");
  if (segments.some((segment) => IGNORED_DIRECTORIES.has(segment))) {
    return true;
  }

  if (!isDirectory && IGNORED_FILES.has(segments.at(-1) ?? "")) {
    return true;
  }

  if (path.startsWith(".env") || path.includes("/.env")) {
    return true;
  }

  if (path.includes("public/assets/") || path.endsWith(".min.js") || path.endsWith(".min.ts")) {
    return true;
  }

  if (!isDirectory) {
    return [...IGNORED_EXTENSIONS].some((extension) => path.endsWith(extension));
  }

  return false;
}
