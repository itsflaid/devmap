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

type IgnoreMatcher = ReturnType<typeof ignore>;

// One matcher per directory that holds a .gitignore (null = checked, none).
const gitignoreCache = new Map<string, IgnoreMatcher | null>();
const rootMatcherCache = new Map<string, IgnoreMatcher>();

/** Forget cached ignore files, e.g. before a fresh scan of an edited project. */
export function clearGitignoreCache(): void {
  gitignoreCache.clear();
  rootMatcherCache.clear();
}

function readIgnoreFile(directory: string): IgnoreMatcher | null {
  const cached = gitignoreCache.get(directory);
  if (cached !== undefined) return cached;

  let matcher: IgnoreMatcher | null = null;
  try {
    matcher = ignore().add(fs.readFileSync(path.join(directory, ".gitignore"), "utf8"));
  } catch {
    // no .gitignore in this directory
  }

  gitignoreCache.set(directory, matcher);
  return matcher;
}

// Root rules: .git/info/exclude has the lowest precedence, then the root .gitignore.
function getRootMatcher(resolvedRoot: string): IgnoreMatcher {
  const cached = rootMatcherCache.get(resolvedRoot);
  if (cached) return cached;

  const ig = ignore();
  for (const ruleFile of [path.join(".git", "info", "exclude"), ".gitignore"]) {
    try {
      ig.add(fs.readFileSync(path.join(resolvedRoot, ruleFile), "utf8"));
    } catch {
      // rule file not present
    }
  }

  rootMatcherCache.set(resolvedRoot, ig);
  return ig;
}

// Git applies each .gitignore relative to its own directory, and rules in a
// deeper file override rules from the directories above it.
function isGitIgnored(p: string, isDirectory: boolean, resolvedRoot: string): boolean {
  const target = isDirectory ? `${p}/` : p;
  const rootResult = getRootMatcher(resolvedRoot).test(target);
  let ignored = rootResult.ignored && !rootResult.unignored;

  const segments = p.split("/");
  for (let depth = 1; depth < segments.length; depth += 1) {
    const matcher = readIgnoreFile(path.join(resolvedRoot, ...segments.slice(0, depth)));
    if (!matcher) continue;

    const result = matcher.test(`${segments.slice(depth).join("/")}${isDirectory ? "/" : ""}`);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }

  return ignored;
}

const ENV_FILE_SEGMENT = /^\.env(\.|$)/;

export function shouldIgnorePath(p: string, isDirectory: boolean, projectRoot?: string): boolean {
  const resolvedRoot = path.resolve(projectRoot ?? process.cwd());

  const segments = p.split("/");
  if (segments.some((segment) => IGNORED_DIRECTORIES.has(segment))) {
    return true;
  }

  if (!isDirectory && IGNORED_FILES.has(segments.at(-1) ?? "")) {
    return true;
  }

  // .env, .env.local, ... but not look-alikes such as .envrc or .environment.ts
  if (segments.some((segment) => ENV_FILE_SEGMENT.test(segment))) {
    return true;
  }

  const lowerPath = p.toLowerCase();
  if (/(^|\/)public\/assets\//.test(lowerPath) || lowerPath.endsWith(".min.js") || lowerPath.endsWith(".min.ts")) {
    return true;
  }

  if (!isDirectory && [...IGNORED_EXTENSIONS].some((ext) => lowerPath.endsWith(ext))) {
    return true;
  }

  return isGitIgnored(p, isDirectory, resolvedRoot);
}
