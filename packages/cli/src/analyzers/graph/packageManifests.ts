import { parseJsonText, type ScannedFile } from "../analysis/index.js";
import { matchLocalPath, normalizePath } from "./localPaths.js";
import { isArchitectureSource } from "./sourceScope.js";

/**
 * package.json knowledge the dependency graph needs: which workspace package a
 * bare specifier names (`@acme/ui`), where `#internal/*` subpath imports point,
 * and which files the manifest itself declares as entries (`bin`, `main`,
 * `exports`, scripts).
 */
export interface PackageManifest {
  /** Project-root-relative directory; `""` for the root package. */
  dir: string;
  name?: string;
  /** `"private": true`: an app or internal package, never a published API. */
  private: boolean;
  main?: string;
  module?: string;
  types?: string;
  source?: string;
  bin: string[];
  exports?: unknown;
  imports?: Record<string, unknown>;
  scripts: Record<string, string>;
}

export interface PackageIndex {
  manifests: PackageManifest[];
  byName: Map<string, PackageManifest>;
}

export interface ManifestEntry {
  path: string;
  kind: "bin" | "main" | "script";
}

// Output folders and the format folders nested in them (`dist/esm/index.js`).
const BUILD_DIRS = new Set([
  "dist", "build", "lib", "out", "output", "esm", "cjs", "es", "umd", "compiled", "dist-esm", "dist-cjs"
]);
const FORMAT_DIRS = new Set(["esm", "cjs", "es", "umd", "types", "typings", "dts", "node", "browser"]);

// Where a built package keeps the sources its output came from.
const SOURCE_DIRS = ["src", "source", ""];

// Earlier conditions are closer to the source a reader wants to land on.
const CONDITION_ORDER = [
  "source", "development", "import", "module", "default", "require", "node", "browser", "types"
];

export function readPackageManifests(files: ScannedFile[]): PackageManifest[] {
  const manifests: PackageManifest[] = [];

  for (const file of files) {
    if (file.path !== "package.json" && !file.path.endsWith("/package.json")) continue;
    if (!isArchitectureSource(file.path)) continue;

    let parsed: Record<string, unknown>;
    try {
      const value = parseJsonText(file.content);
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      parsed = value as Record<string, unknown>;
    } catch {
      continue;
    }

    const dir = file.path === "package.json" ? "" : file.path.slice(0, -"/package.json".length);
    manifests.push({
      dir,
      name: typeof parsed.name === "string" && parsed.name.length > 0 ? parsed.name : undefined,
      private: parsed.private === true,
      main: stringField(parsed.main),
      module: stringField(parsed.module),
      types: stringField(parsed.types) ?? stringField(parsed.typings),
      source: stringField(parsed.source),
      bin: binTargets(parsed.bin),
      exports: parsed.exports,
      imports: isRecord(parsed.imports) ? parsed.imports : undefined,
      scripts: stringRecord(parsed.scripts)
    });
  }

  return manifests.sort((a, b) => a.dir.localeCompare(b.dir));
}

export function indexPackages(manifests: PackageManifest[]): PackageIndex {
  const byName = new Map<string, PackageManifest>();
  for (const manifest of manifests) {
    // Sorted by directory, so the shallowest package wins a duplicate name.
    if (manifest.name && !byName.has(manifest.name)) byName.set(manifest.name, manifest);
  }
  return { manifests, byName };
}

/**
 * Resolve `@scope/pkg` or `@scope/pkg/sub/path` to a scanned file when the
 * package is part of this project (a workspace member). Registry packages are
 * not in the scan, so they never match and stay skipped.
 */
export function resolveWorkspaceSpecifier(
  specifier: string,
  index: PackageIndex,
  localPaths: Set<string>
): string | null {
  const split = splitPackageSpecifier(specifier);
  if (!split) return null;

  const manifest = index.byName.get(split.name);
  if (!manifest) return null;

  if (split.subpath === ".") return resolvePackageRoot(manifest, localPaths);

  const exported = resolveExportsField(manifest, split.subpath, localPaths);
  if (exported) return exported;

  // Not (or not only) described by `exports`: fall back to the file layout.
  const relativePath = split.subpath.slice(2);
  for (const base of ["", "src/"]) {
    const found = matchLocalPath(joinPath(manifest.dir, `${base}${relativePath}`), localPaths);
    if (found) return found;
  }
  return null;
}

/** `#internal/db` -> the file declared by the nearest package.json `imports`. */
export function resolveSubpathImport(
  specifier: string,
  fromFile: string,
  index: PackageIndex,
  localPaths: Set<string>
): string | null {
  if (!specifier.startsWith("#")) return null;

  const manifest = nearestManifest(fromFile, index.manifests, (candidate) => candidate.imports !== undefined);
  if (!manifest?.imports) return null;

  const match = matchSubpathMap(manifest.imports, specifier);
  if (!match) return null;

  for (const target of leafTargets(match.value, match.wildcard)) {
    const resolved = resolveManifestTarget(target, manifest.dir, localPaths);
    if (resolved) return resolved;
  }
  return null;
}

/** Files a manifest declares as runnable or importable entries. */
export function manifestEntryPoints(manifests: PackageManifest[], localPaths: Set<string>): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  const seen = new Set<string>();

  const add = (path: string | null, kind: ManifestEntry["kind"]) => {
    if (!path || seen.has(path) || isConfigFile(path)) return;
    seen.add(path);
    entries.push({ path, kind });
  };

  for (const manifest of manifests) {
    for (const bin of manifest.bin) {
      add(resolveManifestTarget(bin, manifest.dir, localPaths), "bin");
    }

    // An internal workspace package's root file is shared plumbing for its
    // siblings, not a place execution begins. The project root and published
    // packages do expose theirs.
    if (!manifest.private || manifest.dir === "") {
      add(resolvePackageRoot(manifest, localPaths, false), "main");
    }

    for (const command of Object.values(manifest.scripts)) {
      for (const token of scriptFileTokens(command)) {
        add(resolveManifestTarget(token, manifest.dir, localPaths), "script");
      }
    }
  }

  return entries;
}

// ------------------------------------------------------------------ internals

/**
 * The file `import "<package name>"` lands on. `guess` also tries the usual
 * `src/index` layouts when the manifest declares nothing; entry detection
 * leaves that off so only what the package states counts as its entry.
 */
function resolvePackageRoot(
  manifest: PackageManifest,
  localPaths: Set<string>,
  guess = true
): string | null {
  const exported = resolveExportsField(manifest, ".", localPaths);
  if (exported) return exported;

  for (const field of [manifest.source, manifest.module, manifest.main, manifest.types]) {
    if (!field) continue;
    const resolved = resolveManifestTarget(field, manifest.dir, localPaths);
    if (resolved) return resolved;
  }

  if (!guess) return null;

  for (const fallback of ["src/index", "index", "src/main", "main"]) {
    const found = matchLocalPath(joinPath(manifest.dir, fallback), localPaths);
    if (found) return found;
  }
  return null;
}

function resolveExportsField(
  manifest: PackageManifest,
  subpath: string,
  localPaths: Set<string>
): string | null {
  if (manifest.exports === undefined || manifest.exports === null) return null;

  const match = matchSubpathMap(normalizeExports(manifest.exports), subpath);
  if (!match) return null;

  for (const target of leafTargets(match.value, match.wildcard)) {
    const resolved = resolveManifestTarget(target, manifest.dir, localPaths);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Resolve a path written in a manifest (relative to the package directory) to
 * a scanned file. Built output (`dist/index.mjs`, `dist/types/index.d.ts`) is
 * mapped back to the source it came from, since only sources are scanned.
 */
export function resolveManifestTarget(
  target: string,
  packageDir: string,
  localPaths: Set<string>
): string | null {
  // `imports`/`exports` may name another package (`"#dep": "lodash"`).
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;

  const joined = normalizePath(joinPath(packageDir, target));
  if (joined === null) return null;
  if (packageDir !== "" && joined !== packageDir && !joined.startsWith(`${packageDir}/`)) return null;

  const direct = matchLocalPath(joined, localPaths);
  if (direct) return direct;

  return resolveBuildOutput(joined, packageDir, localPaths);
}

function resolveBuildOutput(joined: string, packageDir: string, localPaths: Set<string>): string | null {
  const relativePath = packageDir === "" ? joined : joined.slice(packageDir.length + 1);
  const segments = relativePath.split("/");
  const buildIndex = segments.findIndex((segment) => BUILD_DIRS.has(segment));

  const prefix = buildIndex === -1 ? [] : segments.slice(0, buildIndex);
  const rest = buildIndex === -1 ? [...segments] : segments.slice(buildIndex + 1);
  while (rest.length > 1 && FORMAT_DIRS.has(rest[0])) rest.shift();
  if (rest.length === 0) return null;

  const base = rest.join("/").replace(/\.d\.[cm]?ts$|\.[cm]?jsx?$/, "");
  if (base === "") return null;

  for (const sourceDir of SOURCE_DIRS) {
    const candidate = [packageDir, ...prefix, sourceDir, base].filter((part) => part !== "").join("/");
    const found = matchLocalPath(candidate, localPaths);
    if (found) return found;
  }
  return null;
}

function normalizeExports(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    const keys = Object.keys(value);
    // `{ "import": ..., "default": ... }` is a condition map for ".".
    if (keys.length > 0 && keys.every((key) => key.startsWith("."))) return value;
  }
  return { ".": value };
}

/** Exact key first, then the longest `prefix*suffix` pattern. */
function matchSubpathMap(
  map: Record<string, unknown>,
  subpath: string
): { value: unknown; wildcard?: string } | null {
  if (Object.prototype.hasOwnProperty.call(map, subpath)) return { value: map[subpath] };

  let best: { value: unknown; wildcard: string; length: number } | null = null;
  for (const [key, value] of Object.entries(map)) {
    const star = key.indexOf("*");
    if (star === -1) continue;

    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (subpath.length < key.length - 1) continue;
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;

    const wildcard = subpath.slice(prefix.length, subpath.length - suffix.length);
    if (!best || prefix.length > best.length) best = { value, wildcard, length: prefix.length };
  }

  return best ? { value: best.value, wildcard: best.wildcard } : null;
}

/** Every string target of a conditional export, best condition first. */
function leafTargets(value: unknown, wildcard?: string): string[] {
  const targets: string[] = [];

  const visit = (node: unknown) => {
    if (typeof node === "string") {
      targets.push(wildcard === undefined ? node : node.replace(/\*/g, wildcard));
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (isRecord(node)) {
      const rank = (condition: string) => {
        const position = CONDITION_ORDER.indexOf(condition);
        return position === -1 ? CONDITION_ORDER.length : position;
      };
      // Array.prototype.sort is stable: unknown conditions keep declared order.
      for (const condition of Object.keys(node).sort((a, b) => rank(a) - rank(b))) {
        visit(node[condition]);
      }
    }
  };

  visit(value);
  return targets;
}

function splitPackageSpecifier(specifier: string): { name: string; subpath: string } | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) return null;

  const parts = specifier.split("/");
  const nameLength = specifier.startsWith("@") ? 2 : 1;
  if (parts.length < nameLength || parts.slice(0, nameLength).some((part) => part === "")) return null;

  const name = parts.slice(0, nameLength).join("/");
  const rest = parts.slice(nameLength).join("/");
  return { name, subpath: rest === "" ? "." : `./${rest}` };
}

function nearestManifest(
  file: string,
  manifests: PackageManifest[],
  accept: (manifest: PackageManifest) => boolean
): PackageManifest | undefined {
  let best: PackageManifest | undefined;
  for (const manifest of manifests) {
    if (!accept(manifest)) continue;
    const contains = manifest.dir === "" || file.startsWith(`${manifest.dir}/`);
    if (contains && (!best || manifest.dir.length > best.dir.length)) best = manifest;
  }
  return best;
}

// File-looking tokens in a script: `tsx src/server.ts`, `node dist/index.js`,
// `tsup src/index.ts --format esm`. Globs and flags never match.
function scriptFileTokens(command: string): string[] {
  const tokens: string[] = [];
  const pattern = /(?:^|[\s"'=:])((?:\.{1,2}\/)?[\w@.\-/]+\.(?:[cm]?[jt]sx?))(?=$|[\s"';&|])/g;

  let match = pattern.exec(command);
  while (match) {
    const token = match[1];
    if (!token.includes("node_modules/") && !token.startsWith("/")) tokens.push(token);
    match = pattern.exec(command);
  }
  return tokens;
}

function isConfigFile(path: string): boolean {
  return /(^|\/)[\w.-]*\.(?:config|setup)\.[cm]?[jt]s$/.test(path) || /(^|\/)\.[\w.-]+rc\.[cm]?[jt]s$/.test(path);
}

function joinPath(directory: string, path: string): string {
  return directory === "" ? path : `${directory}/${path}`;
}

function binTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (isRecord(value)) return Object.values(value).filter((item): item is string => typeof item === "string");
  return [];
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
