import type { FileAnalysis, ScannedFile } from "../analysis/index.js";
import type { FileGraph } from "./dependencyGraph.js";
import { isArchitectureSource } from "./sourceScope.js";

/**
 * Nuxt wires files together without import statements: components, composables
 * and utils are picked up from their folders, and `~/` points at `app/` (Nuxt
 * 4) or the project root (Nuxt 3), not at `src/`. Without modelling that, a
 * Nuxt project looks like a pile of files that never reference each other.
 */

export interface NuxtApp {
  /** Project-root-relative directory holding nuxt.config (`""` for the root). */
  dir: string;
  /** Source directory, relative to `dir` (`""` or `"app"`, or a custom srcDir). */
  srcDir: string;
  /** `@pinia/nuxt` is installed: `stores/` is auto-imported too. */
  pinia: boolean;
}

const NUXT_CONFIG = /(^|\/)nuxt\.config\.[cm]?[jt]s$/;
const SCRIPT_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".mts", ".cjs", ".cts"]);
const CONSUMER_EXTENSIONS = new Set([".vue", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"]);
const COMPONENT_EXTENSIONS = new Set([".vue", ".tsx", ".jsx"]);

// Nuxt 4 moved the app into `app/`; any of these under it means that layout.
const APP_DIR_MARKERS = [
  "app/app.vue", "app/pages/", "app/components/", "app/layouts/",
  "app/composables/", "app/plugins/", "app/middleware/", "app/utils/"
];

/**
 * The source directory a Nuxt project uses. An explicit `srcDir` in the config
 * wins; otherwise `app/` when the Nuxt 4 layout is present, else the root.
 * `hasPath` answers whether a path (or, with a trailing slash, a folder)
 * exists under the config's directory.
 */
export function pickNuxtSrcDir(configText: string, hasPath: (relative: string) => boolean): string {
  const explicit = /\bsrcDir\s*:\s*['"`]([^'"`]+)['"`]/.exec(configText)?.[1];
  if (explicit) {
    const cleaned = explicit.replace(/^\.\//, "").replace(/\/+$/, "");
    return cleaned === "." ? "" : cleaned;
  }
  return APP_DIR_MARKERS.some(hasPath) ? "app" : "";
}

export function detectNuxtApps(files: ScannedFile[]): NuxtApp[] {
  const apps: NuxtApp[] = [];

  for (const config of files.filter((file) => NUXT_CONFIG.test(file.path))) {
    const dir = config.path.includes("/") ? config.path.slice(0, config.path.lastIndexOf("/")) : "";
    const prefix = dir === "" ? "" : `${dir}/`;
    const hasPath = (relative: string) =>
      files.some((file) => file.path.startsWith(`${prefix}${relative}`));

    apps.push({
      dir,
      srcDir: pickNuxtSrcDir(config.content, hasPath),
      pinia: files.some((file) =>
        (file.path === `${prefix}package.json` || file.path === "package.json")
        && file.content.includes("@pinia/nuxt")
      )
    });
  }

  return apps.sort((a, b) => a.dir.localeCompare(b.dir));
}

/**
 * Add the edges Nuxt creates implicitly: a file that renders `<AccountAvatar>`
 * or calls `useUser()` depends on the component / composable file that
 * provides it. Mutates `graph`; existing explicit imports are untouched.
 */
export function addNuxtAutoImportEdges(
  graph: FileGraph,
  files: ScannedFile[],
  analyses: Record<string, FileAnalysis>
): void {
  const apps = detectNuxtApps(files);
  if (apps.length === 0) return;

  const production = files.filter((file) => isArchitectureSource(file.path));

  for (const app of apps) {
    const inApp = (path: string) => app.dir === "" || path.startsWith(`${app.dir}/`);
    const appFiles = production.filter((file) => inApp(file.path));
    const rel = (path: string) => (app.dir === "" ? path : path.slice(app.dir.length + 1));
    const srcPrefix = app.srcDir === "" ? "" : `${app.srcDir}/`;

    const isServer = (path: string) => rel(path).startsWith("server/");
    // Providers visible to app code vs. to the Nitro server.
    const appValues = new Map<string, string>();
    const serverValues = new Map<string, string>();
    const components = new Map<string, string>();
    // PascalCase names, for components referenced as identifiers in a script
    // (`{ component: NavButtonBookmark }`) instead of as a template tag.
    const componentIdentifiers = new Map<string, string>();

    const registerValues = (target: Map<string, string>, file: ScannedFile) => {
      const analysis = analyses[file.path];
      const names = new Set<string>(analysis?.exports ?? []);
      if (names.delete("default")) names.add(camelCase(baseName(file.path)));
      for (const name of names) {
        if (name.length >= 3 && !target.has(name)) target.set(name, file.path);
      }
    };

    for (const file of appFiles) {
      const path = rel(file.path);

      // components/**: every .vue file, named from its folder path.
      if (path.startsWith(`${srcPrefix}components/`) && COMPONENT_EXTENSIONS.has(file.extension)) {
        const name = componentName(path.slice(`${srcPrefix}components/`.length));
        const key = name ? componentKey(name) : "";
        if (key && !components.has(key)) components.set(key, file.path);
        if (name && name.length >= 4 && !componentIdentifiers.has(name)) componentIdentifiers.set(name, file.path);
        continue;
      }

      if (!SCRIPT_EXTENSIONS.has(file.extension)) continue;

      const dirs = [
        `${srcPrefix}composables/`,
        `${srcPrefix}utils/`,
        ...(app.pinia ? [`${srcPrefix}stores/`] : []),
        "shared/utils/",
        "shared/types/"
      ];
      const dirHit = dirs.find((dir) => path.startsWith(dir));
      if (dirHit && isTopLevelOrIndex(path.slice(dirHit.length))) {
        registerValues(appValues, file);
        // shared/ is visible on both sides of the app.
        if (dirHit.startsWith("shared/")) registerValues(serverValues, file);
        continue;
      }

      if (path.startsWith("server/utils/") && isTopLevelOrIndex(path.slice("server/utils/".length))) {
        registerValues(serverValues, file);
      }
    }

    if (appValues.size === 0 && serverValues.size === 0 && components.size === 0) continue;

    for (const consumer of appFiles) {
      if (!CONSUMER_EXTENSIONS.has(consumer.extension) || !(consumer.path in graph)) continue;

      const server = isServer(consumer.path);
      const values = server ? serverValues : appValues;
      const edges = new Set(graph[consumer.path]);
      const before = edges.size;

      const tokens = new Set(consumer.content.match(/[A-Za-z_$][\w$]*/g) ?? []);

      if (values.size > 0) {
        for (const [name, provider] of values) {
          if (provider === consumer.path || edges.has(provider) || !tokens.has(name)) continue;
          if (isReferenced(name, consumer.content)) edges.add(provider);
        }
      }

      if (!server && consumer.extension === ".vue" && components.size > 0) {
        for (const tag of renderedComponents(consumer.content)) {
          const provider = components.get(tag) ?? components.get(tag.replace(/^lazy/, ""));
          if (provider && provider !== consumer.path) edges.add(provider);
        }
      }

      if (!server && COMPONENT_EXTENSIONS.has(consumer.extension) && componentIdentifiers.size > 0) {
        for (const token of tokens) {
          const provider = componentIdentifiers.get(token);
          if (provider && provider !== consumer.path) edges.add(provider);
        }
      }

      if (edges.size !== before) graph[consumer.path] = [...edges];
    }
  }
}

// ------------------------------------------------------------------ naming

/** Nuxt's component name: folder path + file name, overlap dropped. */
export function componentName(relativeToComponents: string): string | null {
  const segments = relativeToComponents.split("/");
  const file = segments.pop();
  if (!file) return null;

  let fileName = file.replace(/\.[^.]+$/, "").replace(/\.(?:client|server|global)$/i, "");
  // components/foo/index.vue is <Foo>.
  if (fileName.toLowerCase() === "index") {
    const directory = segments[segments.length - 1];
    if (!directory) return null;
    fileName = directory;
  }

  const prefixParts = segments.flatMap(splitByCase);
  const fileParts = splitByCase(fileName);
  if (fileParts.length === 0) return null;

  const nameParts: string[] = [];
  while (prefixParts.length > 0 && prefixParts[0].toLowerCase() !== fileParts[0].toLowerCase()) {
    nameParts.push(prefixParts.shift() as string);
  }

  return [...nameParts, ...fileParts].map(upperFirst).join("");
}

function componentKey(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, "");
}

/** Component tags used by a .vue file, normalized to match `componentKey`. */
function renderedComponents(content: string): Set<string> {
  const tags = new Set<string>();

  for (const match of content.matchAll(/<([A-Za-z][\w-]*)(?=[\s/>])/g)) {
    tags.add(componentKey(match[1]));
  }
  for (const match of content.matchAll(/\bresolveComponent\(\s*['"`]([\w-]+)['"`]/g)) {
    tags.add(componentKey(match[1]));
  }

  return tags;
}

function splitByCase(value: string): string[] {
  return value
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s\-_./]+/)
    .filter(Boolean);
}

function upperFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function camelCase(value: string): string {
  const [first = "", ...rest] = splitByCase(value);
  return first.charAt(0).toLowerCase() + first.slice(1) + rest.map(upperFirst).join("");
}

function baseName(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  // utils/foo/index.ts is named after its folder.
  if (file === "index") {
    const parts = path.split("/");
    return parts[parts.length - 2] ?? file;
  }
  return file;
}

/** Nuxt scans top-level files of an auto-import folder plus `folder/index.ts`. */
function isTopLevelOrIndex(relative: string): boolean {
  return !relative.includes("/") || /^[^/]+\/index\.[cm]?[jt]s$/.test(relative);
}

/**
 * `useX`, `PascalCase` and `CONSTANTS` are referenced as bare identifiers;
 * a plain camelCase helper must be called (`formatDate(...)`, not
 * `date.format(...)` or a local variable that happens to share the name).
 */
function isReferenced(name: string, content: string): boolean {
  if (/^use[A-Z]/.test(name) || /^[A-Z]/.test(name)) return true;
  return new RegExp(`(?<![.\\w$])${escapeRegExp(name)}\\s*\\(`).test(content);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
