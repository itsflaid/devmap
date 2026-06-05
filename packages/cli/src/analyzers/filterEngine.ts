const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".devmap",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out"
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
  ".zip"
]);

export function shouldIgnorePath(path: string, isDirectory: boolean): boolean {
  const segments = path.split("/");
  if (segments.some((segment) => IGNORED_DIRECTORIES.has(segment))) {
    return true;
  }

  if (path.startsWith(".env") || path.includes("/.env")) {
    return true;
  }

  if (path.includes("public/assets/") || path.endsWith(".min.ts") || path.endsWith("-lock.yaml")) {
    return true;
  }

  if (!isDirectory) {
    return [...IGNORED_EXTENSIONS].some((extension) => path.endsWith(extension));
  }

  return false;
}
