import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ts } from "ts-morph";

export interface AliasMapping {
  /** Specifier prefix (`@/`), or the whole specifier when `exact` is set. */
  prefix: string;
  /** Project-root-relative target. Directory targets end in `/`. */
  target: string;
  /** Alias declared without a wildcard (`"@config": ["./config.ts"]`). */
  exact?: boolean;
  /**
   * Directory (project-root-relative, `""` for the root) of the tsconfig that
   * declared this mapping. It only applies to files below that directory.
   */
  scope?: string;
  /**
   * Resolution is a best-effort guess (baseUrl, framework defaults): a miss is
   * normal for npm packages and must not be reported as an unresolved alias.
   */
  optional?: boolean;
}

const CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"];
const WORKSPACE_PARENTS = ["apps", "packages", "libs", "services"];
const SVELTE_CONFIGS = ["svelte.config.js", "svelte.config.ts", "svelte.config.mjs", "svelte.config.cjs"];

interface LoadedConfig {
  baseUrl?: string;
  paths?: Record<string, string[]>;
  pathsDir?: string;
  references: string[];
}

/**
 * Load alias mappings from tsconfig/jsconfig (JSONC, `extends`, `baseUrl`,
 * project `references`, workspace sub-packages) plus common framework
 * conventions (`$lib` for SvelteKit, `@/` and `~/` -> `src/` as a last resort).
 */
export async function loadAliasMappings(projectRoot: string): Promise<AliasMapping[]> {
  const root = resolve(projectRoot);
  const mappings: AliasMapping[] = [];

  for (const directory of await findConfigDirectories(root)) {
    mappings.push(...(await loadDirectoryMappings(root, directory)));
  }

  // Framework defaults only when the project declares no aliases of its own.
  if (mappings.length === 0) {
    mappings.push({ prefix: "@/", target: "./src/", optional: true });
    mappings.push({ prefix: "~/", target: "./src/", optional: true });
  }

  if (
    !mappings.some((mapping) => mapping.prefix === "$lib" || mapping.prefix === "$lib/")
    && SVELTE_CONFIGS.some((name) => existsSync(join(root, name)))
  ) {
    mappings.push({ prefix: "$lib", target: "src/lib", exact: true, scope: "" });
    mappings.push({ prefix: "$lib/", target: "src/lib/", scope: "" });
  }

  return mappings;
}

/**
 * All root-relative path candidates for an alias specifier, best match first.
 * Mirrors TypeScript: the longest matching pattern wins, an exact alias beats a
 * wildcard of the same length, and the nearest tsconfig scope wins.
 */
export function resolveAliasCandidates(
  specifier: string,
  mappings: AliasMapping[],
  fromFile?: string
): string[] {
  const scopes = [...new Set(mappings.map((mapping) => mapping.scope ?? ""))]
    .filter((scope) => fromFile === undefined || isWithinScope(fromFile, scope))
    .sort((a, b) => scopeDepth(b) - scopeDepth(a));

  for (const scope of scopes) {
    const matches = mappings.filter((mapping) =>
      (mapping.scope ?? "") === scope && matchesSpecifier(mapping, specifier)
    );
    if (matches.length === 0) continue;

    const longest = Math.max(...matches.map((mapping) => mapping.prefix.length));
    const best = matches.filter((mapping) => mapping.prefix.length === longest);
    const exact = best.filter((mapping) => mapping.exact);
    const chosen = exact.length > 0 ? exact : best;

    return chosen.map((mapping) =>
      mapping.exact ? mapping.target : mapping.target + specifier.slice(mapping.prefix.length)
    );
  }

  return [];
}

/** Whether any mapping that is not just a guess claims this specifier. */
export function isDeclaredAlias(specifier: string, mappings: AliasMapping[], fromFile?: string): boolean {
  return mappings.some((mapping) =>
    !mapping.optional
    && (fromFile === undefined || isWithinScope(fromFile, mapping.scope ?? ""))
    && matchesSpecifier(mapping, specifier)
  );
}

/**
 * Resolve an alias import specifier to a root-relative path using configured
 * mappings. Returns null if no mapping matches.
 */
export function resolveAlias(
  specifier: string,
  mappings: AliasMapping[],
  fromFile?: string
): string | null {
  return resolveAliasCandidates(specifier, mappings, fromFile)[0] ?? null;
}

function matchesSpecifier(mapping: AliasMapping, specifier: string): boolean {
  if (mapping.exact) return specifier === mapping.prefix;
  if (mapping.prefix === "") return true;
  return specifier.startsWith(mapping.prefix);
}

function isWithinScope(file: string, scope: string): boolean {
  return scope === "" || file === scope || file.startsWith(`${scope}/`);
}

function scopeDepth(scope: string): number {
  return scope === "" ? 0 : scope.split("/").length;
}

async function findConfigDirectories(root: string): Promise<string[]> {
  const directories = [root];

  for (const parent of WORKSPACE_PARENTS) {
    try {
      const entries = await readdir(join(root, parent), { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          directories.push(join(root, parent, entry.name));
        }
      }
    } catch {
      // no such workspace parent
    }
  }

  return directories;
}

async function loadDirectoryMappings(root: string, directory: string): Promise<AliasMapping[]> {
  const scope = toPosix(relative(root, directory));
  const mappings: AliasMapping[] = [];
  const queue = CONFIG_NAMES.map((name) => join(directory, name));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const configPath = queue.shift()!;
    if (visited.has(configPath)) continue;
    visited.add(configPath);

    const config = await loadConfig(configPath, new Set());
    if (!config) continue;

    mappings.push(...configToMappings(config, root, scope));
    for (const reference of config.references) {
      // `references` may point at a config file or at a directory holding one.
      queue.push(reference.endsWith(".json") ? reference : join(reference, "tsconfig.json"));
    }
  }

  return mappings;
}

async function loadConfig(configPath: string, seen: Set<string>): Promise<LoadedConfig | null> {
  if (seen.has(configPath)) return null;
  seen.add(configPath);

  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch {
    return null;
  }

  // tsconfig is JSONC: comments and trailing commas are legal and common.
  const parsed = ts.parseConfigFileTextToJson(configPath, text.replace(/^﻿/, ""));
  const json = parsed.config as Record<string, unknown> | undefined;
  if (parsed.error || !json || typeof json !== "object") return null;

  const configDir = dirname(configPath);
  const merged: LoadedConfig = { references: [] };

  for (const parentPath of extendsPaths(json.extends, configDir)) {
    const parent = await loadConfig(parentPath, seen);
    if (!parent) continue;
    if (parent.baseUrl !== undefined) merged.baseUrl = parent.baseUrl;
    if (parent.paths !== undefined) {
      merged.paths = parent.paths;
      merged.pathsDir = parent.pathsDir;
    }
  }

  const options = json.compilerOptions as Record<string, unknown> | undefined;
  if (options && typeof options.baseUrl === "string") {
    merged.baseUrl = resolve(configDir, options.baseUrl);
  }
  if (options && options.paths && typeof options.paths === "object") {
    // `paths` replaces the inherited object wholesale, it is not merged.
    merged.paths = options.paths as Record<string, string[]>;
    merged.pathsDir = configDir;
  }

  if (Array.isArray(json.references)) {
    for (const reference of json.references) {
      const path = (reference as { path?: unknown } | null)?.path;
      if (typeof path === "string") merged.references.push(resolve(configDir, path));
    }
  }

  return merged;
}

function extendsPaths(value: unknown, configDir: string): string[] {
  const entries = Array.isArray(value) ? value : [value];
  const paths: string[] = [];

  for (const entry of entries) {
    // Package specifiers (`@tsconfig/node20`) carry no project aliases.
    if (typeof entry !== "string" || !entry.startsWith(".")) continue;
    const resolved = resolve(configDir, entry);
    paths.push(resolved.endsWith(".json") ? resolved : `${resolved}.json`);
  }

  return paths;
}

function configToMappings(config: LoadedConfig, root: string, scope: string): AliasMapping[] {
  const mappings: AliasMapping[] = [];

  if (config.paths) {
    const base = config.baseUrl ?? config.pathsDir ?? root;

    for (const [alias, targets] of Object.entries(config.paths)) {
      if (!Array.isArray(targets)) continue;

      const star = alias.indexOf("*");
      // Only a trailing wildcard (`@/*`) or no wildcard is supported.
      if (star !== -1 && star !== alias.length - 1) continue;

      for (const target of targets) {
        if (typeof target !== "string") continue;
        const targetStar = target.indexOf("*");
        if (targetStar !== -1 && targetStar !== target.length - 1) continue;

        const rootRelative = toRootRelative(resolve(base, targetStar === -1 ? target : target.slice(0, -1)), root);
        if (rootRelative === null) continue;

        if (star === -1) {
          mappings.push({ prefix: alias, target: rootRelative, exact: true, scope });
        } else {
          const directory = rootRelative === "" || rootRelative.endsWith("/") ? rootRelative : `${rootRelative}/`;
          mappings.push({ prefix: alias.slice(0, -1), target: directory, scope });
        }
      }
    }
  }

  if (config.baseUrl !== undefined) {
    const baseRelative = toRootRelative(config.baseUrl, root);
    if (baseRelative !== null) {
      const directory = baseRelative === "" ? "" : `${baseRelative}/`;
      // Bare specifiers resolve against baseUrl; most are npm packages.
      mappings.push({ prefix: "", target: directory, scope, optional: true });
    }
  }

  return mappings;
}

function toRootRelative(absolutePath: string, root: string): string | null {
  const relativePath = toPosix(relative(root, absolutePath));
  if (relativePath === ".." || relativePath.startsWith("../") || /^[a-zA-Z]:/.test(relativePath)) {
    return null;
  }
  return relativePath;
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}
