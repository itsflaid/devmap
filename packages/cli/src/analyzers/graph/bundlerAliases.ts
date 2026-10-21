import { readFile, readdir } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { ts } from "ts-morph";
import type { AliasMapping } from "./aliasResolver.js";

/**
 * Aliases that only exist in bundler config: `@` → `src` in vite.config,
 * `$components` in svelte.config, `resolve.alias` in webpack.config, `alias`
 * in nuxt.config. None of them is in tsconfig, so without this the import
 * `@/lib/db` looks like an npm package and the file graph loses the edge.
 *
 * Configs are code, so they are read from the syntax tree, never run. Anything
 * that cannot be worked out statically (an env variable, a function call this
 * module does not know) is skipped rather than guessed.
 */

const CONFIG_FILE =
  /^(?:vite(?:st)?|vitest|webpack|rollup|rspack|rsbuild|astro|svelte|nuxt|next|electron\.vite|quasar)(?:\.[\w-]+)?\.config\.[cm]?[jt]s$|^webpack\.[\w.-]+\.[cm]?[jt]s$/;

// Object literals under these keys hold aliases: `resolve: { alias }` (Vite,
// webpack, Rollup), `kit: { alias }` (SvelteKit), `test: { alias }` (Vitest).
const ALIAS_PARENT_KEYS = new Set(["resolve", "kit", "test"]);

/** Marks "the config file itself" while folding `dirname(import.meta.url)`. */
const FILE = "\0file";

export async function loadBundlerAliases(
  root: string,
  directory: string,
  scope: string
): Promise<AliasMapping[]> {
  let names: string[];
  try {
    names = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && CONFIG_FILE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }

  const mappings: AliasMapping[] = [];
  const seen = new Set<string>();

  for (const name of names) {
    let text: string;
    try {
      text = await readFile(join(directory, name), "utf8");
    } catch {
      continue;
    }
    if (!/\balias\b/.test(text)) continue;

    for (const entry of readAliasEntries(name, text)) {
      for (const mapping of toMappings(entry, directory, root, scope)) {
        const key = `${mapping.prefix}\0${mapping.target}\0${mapping.exact ?? false}`;
        if (seen.has(key)) continue;
        seen.add(key);
        mappings.push(mapping);
      }
    }
  }

  return mappings;
}

/** One alias as written: a specifier (or its start) and the folder it points to. */
export interface AliasEntry {
  find: string;
  /** Path relative to the config's directory (`""` is the directory itself). */
  target: string;
  /** `find` is a regular expression that was reduced to a plain prefix. */
  prefixOnly?: boolean;
}

export function readAliasEntries(fileName: string, text: string): AliasEntry[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const variables = new Map<string, ts.Expression>();
  collectVariables(source, variables);

  const entries: AliasEntry[] = [];
  const isNuxt = /^nuxt\.config\./.test(fileName);
  const evaluate = (node: ts.Expression) => evaluatePath(node, variables, new Set());

  const addFrom = (container: ts.Expression) => entries.push(...entriesOf(container, evaluate));

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === "alias") {
      const parent = node.parent;
      const grandName = ts.isPropertyAssignment(parent.parent) ? propertyName(parent.parent.name) : undefined;
      if (isNuxt || (grandName && ALIAS_PARENT_KEYS.has(grandName))) addFrom(node.initializer);
    }

    // webpack(config) { config.resolve.alias = { ... }; config.resolve.alias["@"] = ... }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left.getText();
      if (/\bresolve\.alias$/.test(left)) {
        addFrom(node.right);
      } else {
        const single = /\bresolve\.alias\[\s*(['"`])([^'"`]+)\1\s*\]$/.exec(left);
        if (single) {
          const target = evaluate(node.right);
          if (target !== undefined) entries.push({ find: single[2], target });
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  return entries;
}

function entriesOf(
  container: ts.Expression,
  evaluate: (node: ts.Expression) => string | undefined
): AliasEntry[] {
  const node = unwrap(container);
  const entries: AliasEntry[] = [];

  // { '@': path.resolve(__dirname, 'src'), '~components': ['./a', './b'] }
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const find = propertyName(property.name);
      if (find === undefined) continue;

      const values = ts.isArrayLiteralExpression(property.initializer)
        ? property.initializer.elements
        : [property.initializer];
      for (const value of values) {
        const target = evaluate(value);
        if (target !== undefined) entries.push({ find, target });
      }
    }
    return entries;
  }

  // [{ find: '@', replacement: '/src' }, { find: /^@\//, replacement: ... }]
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      const item = unwrap(element);
      if (!ts.isObjectLiteralExpression(item)) continue;

      let find: { text: string; prefixOnly: boolean } | undefined;
      let replacement: ts.Expression | undefined;
      for (const property of item.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = propertyName(property.name);
        if (key === "find") find = findText(property.initializer);
        if (key === "replacement") replacement = property.initializer;
      }

      const target = replacement ? evaluate(replacement) : undefined;
      if (find && target !== undefined) {
        entries.push({ find: find.text, target, ...(find.prefixOnly ? { prefixOnly: true } : {}) });
      }
    }
  }

  return entries;
}

/** A `find` that is a string, or a regex that is just an anchored literal (`/^@\//`). */
function findText(node: ts.Expression): { text: string; prefixOnly: boolean } | undefined {
  const value = unwrap(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return { text: value.text, prefixOnly: false };
  }
  if (ts.isRegularExpressionLiteral(value)) {
    const body = /^\/\^?((?:[^/\\]|\\.)+?)\/[a-z]*$/.exec(value.text)?.[1];
    if (!body) return undefined;
    const literal = body.replace(/\\(.)/g, "$1");
    // Anything still regex-shaped (`(.*)`, `[a-z]`, `+`) is not a plain prefix.
    return /[()[\]*+?{}|^$]/.test(body.replace(/\\./g, "")) ? undefined : { text: literal, prefixOnly: true };
  }
  return undefined;
}

function toMappings(
  entry: AliasEntry,
  directory: string,
  root: string,
  scope: string
): AliasMapping[] {
  const resolved = toRootRelative(join(directory, entry.target), root);
  if (resolved === null) return [];

  let find = entry.find;
  if (find === "") return [];

  // SvelteKit writes `'$utils/*': 'src/utils/*'`; webpack writes `'@$'` for exact.
  const wildcard = find.endsWith("/*");
  const exactOnly = find.endsWith("$") && !entry.prefixOnly;
  if (wildcard) find = find.slice(0, -1);
  if (exactOnly) find = find.slice(0, -1);

  const folder = resolved.replace(/\/?\*?$/, "");
  const directoryTarget = folder === "" ? "" : `${folder}/`;

  // `@/` (trailing slash) is already a prefix; bare `@` matches `@` and `@/…`.
  if (find.endsWith("/")) {
    return [{ prefix: find, target: directoryTarget, scope, optional: true }];
  }
  if (exactOnly) {
    return [{ prefix: find, target: folder, exact: true, scope, optional: true }];
  }
  return [
    { prefix: find, target: folder, exact: true, scope, optional: true },
    { prefix: `${find}/`, target: directoryTarget, scope, optional: true }
  ];
}

// ---------------------------------------------------------- path evaluation

/**
 * Fold an expression that builds a path (`path.resolve(__dirname, 'src')`,
 * `fileURLToPath(new URL('./src', import.meta.url))`, a template string, a
 * constant defined above) into a path relative to the config's directory.
 */
function evaluatePath(
  expression: ts.Expression,
  variables: Map<string, ts.Expression>,
  seen: Set<string>
): string | undefined {
  const folded = fold(expression, variables, seen);
  if (folded === undefined || folded === FILE) return undefined;
  return folded;
}

function fold(
  expression: ts.Expression,
  variables: Map<string, ts.Expression>,
  seen: Set<string>
): string | undefined {
  const node = unwrap(expression);
  const recurse = (child: ts.Expression) => fold(child, variables, seen);

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return normalizeRelative(node.text);
  }

  if (ts.isIdentifier(node)) {
    if (node.text === "__dirname") return "";
    if (node.text === "__filename") return FILE;
    if (seen.has(node.text)) return undefined;
    const initializer = variables.get(node.text);
    if (!initializer) return undefined;
    seen.add(node.text);
    const value = recurse(initializer);
    seen.delete(node.text);
    return value;
  }

  // import.meta.url, import.meta.dirname, process.cwd, import.meta.dirname
  if (ts.isPropertyAccessExpression(node)) {
    const text = node.getText();
    if (text === "import.meta.url" || text === "import.meta.filename") return FILE;
    if (text === "import.meta.dirname") return "";
    // new URL(...).pathname / .href
    if (node.name.text === "pathname" || node.name.text === "href") return recurse(node.expression);
    return undefined;
  }

  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") {
    const [relativeUrl, base] = node.arguments ?? [];
    if (!relativeUrl) return undefined;
    const baseFolded = base ? recurse(base) : "";
    const rel = fold(relativeUrl, variables, seen);
    if (rel === undefined || baseFolded === undefined) return undefined;
    // `new URL('./src', import.meta.url)` is relative to the file's folder.
    return baseFolded === FILE ? rel : posix.join(baseFolded, rel);
  }

  if (ts.isCallExpression(node)) {
    const name = calleeName(node.expression);
    const args = node.arguments;

    if (name === "cwd") return "";
    if (name === "fileURLToPath" || name === "normalize") return args[0] ? recurse(args[0]) : undefined;

    if (name === "dirname") {
      const inner = args[0] ? recurse(args[0]) : undefined;
      if (inner === FILE) return "";
      return inner === undefined ? undefined : posix.dirname(inner) === "." ? "" : posix.dirname(inner);
    }

    if (name === "resolve" || name === "join") {
      if (args.length === 0) return "";
      const parts = args.map(recurse);
      if (parts.some((part) => part === undefined)) return undefined;
      return normalizeRelative(posix.join(...(parts as string[]).map((part) => (part === FILE ? "" : part))));
    }
    return undefined;
  }

  // `${__dirname}/src`
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const inner = recurse(span.expression);
      if (inner === undefined || inner === FILE) return undefined;
      value += inner + span.literal.text;
    }
    return normalizeRelative(value);
  }

  // __dirname + '/src'
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = recurse(node.left);
    const right = recurse(node.right);
    if (left === undefined || right === undefined || left === FILE || right === FILE) return undefined;
    return normalizeRelative(`${left}/${right}`);
  }

  return undefined;
}

/** `./src/`, `/src`, `src//x` → `src`, `src`, `src/x`. Keeps leading `..`. */
function normalizeRelative(value: string): string {
  const cleaned = posix.normalize(value.replace(/^\/+/, "")).replace(/\/+$/, "");
  return cleaned === "." ? "" : cleaned;
}

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

// --------------------------------------------------------------------- AST

function collectVariables(node: ts.Node, variables: Map<string, ts.Expression>): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    if (!variables.has(node.name.text)) variables.set(node.name.text, node.initializer);
  }
  ts.forEachChild(node, (child) => collectVariables(child, variables));
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function scriptKind(fileName: string): ts.ScriptKind {
  return /\.[cm]?js$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

function toRootRelative(absolutePath: string, root: string): string | null {
  const relativePath = (sep === "/" ? relative(root, absolutePath) : relative(root, absolutePath).split(sep).join("/"));
  if (relativePath === ".." || relativePath.startsWith("../") || /^[a-zA-Z]:/.test(relativePath)) {
    return null;
  }
  return relativePath;
}
