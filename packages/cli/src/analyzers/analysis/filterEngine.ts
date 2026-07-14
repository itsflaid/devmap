import fs from "node:fs";
import path from "node:path";
import ignore from "ignore";

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

const gitignoreCache = new Map<string, ReturnType<typeof ignore>>();

function loadGitignore(projectRoot: string): void {
  const resolvedRoot = path.resolve(projectRoot);
  if (gitignoreCache.has(resolvedRoot)) return;

  const ig = ignore();

  const gitignorePath = path.join(resolvedRoot, ".gitignore");
  try {
    ig.add(fs.readFileSync(gitignorePath, "utf8"));
  } catch {
    // no .gitignore
  }

  const excludePath = path.join(resolvedRoot, ".git", "info", "exclude");
  try {
    ig.add(fs.readFileSync(excludePath, "utf8"));
  } catch {
    // no .git/info/exclude
  }

  gitignoreCache.set(resolvedRoot, ig);
}

function getGitignore(projectRoot: string): ReturnType<typeof ignore> {
  const resolvedRoot = path.resolve(projectRoot);
  if (!gitignoreCache.has(resolvedRoot)) {
    loadGitignore(resolvedRoot);
  }
  return gitignoreCache.get(resolvedRoot)!;
}

export function shouldIgnorePath(p: string, isDirectory: boolean, projectRoot?: string): boolean {
  const resolvedRoot = projectRoot ?? process.cwd();

  const segments = p.split("/");
  if (segments.some((segment) => IGNORED_DIRECTORIES.has(segment))) {
    return true;
  }

  if (!isDirectory && IGNORED_FILES.has(segments.at(-1) ?? "")) {
    return true;
  }

  if (p.startsWith(".env") || p.includes("/.env")) {
    return true;
  }

  if (p.includes("public/assets/") || p.endsWith(".min.js") || p.endsWith(".min.ts")) {
    return true;
  }

  if (!isDirectory && [...IGNORED_EXTENSIONS].some((ext) => p.endsWith(ext))) {
    return true;
  }

  const ig = getGitignore(resolvedRoot);
  if (ig.ignores(isDirectory ? `${p}/` : p)) {
    return true;
  }

  return false;
}
