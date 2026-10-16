import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { scanFiles } from "../src/analyzers/analysis/fileScanner.js";
import { TsMorphAnalyzer } from "../src/analyzers/analysis/tsMorphAnalyzer.js";
import {
  buildDependencyGraph,
  loadAliasMappings,
  resolveAlias
} from "../src/analyzers/graph/index.js";
import { analyzeFiles } from "../src/analyzers/pipeline/analyzerRegistry.js";

async function withProject(
  files: Record<string, string>,
  run: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "devmap-graph-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function graphOf(root: string) {
  const files = await scanFiles(root);
  const analyses = await analyzeFiles(files);
  const mappings = await loadAliasMappings(root);
  return buildDependencyGraph(files, analyses, mappings);
}

// ---------------------------------------------------------------- alias config

test("tsconfig with comments and trailing commas still yields alias edges", async () => {
  await withProject({
    "tsconfig.json": `{
      // JSONC: comments and trailing commas are legal in tsconfig
      "compilerOptions": {
        "paths": { "@app/*": ["./lib/*"], },
      },
    }`,
    "src/main.ts": 'import { run } from "@app/run";\nrun();\n',
    "lib/run.ts": "export const run = () => 1;\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual(graph["src/main.ts"], ["lib/run.ts"]);
  });
});

test("paths declared in an extended tsconfig resolve relative to the config that declares them", async () => {
  await withProject({
    "tsconfig.base.json": JSON.stringify({ compilerOptions: { paths: { "@shared/*": ["./shared/*"] } } }),
    "tsconfig.json": JSON.stringify({ extends: "./tsconfig.base.json" }),
    "src/main.ts": 'import { id } from "@shared/id";\nexport const x = id;\n',
    "shared/id.ts": "export const id = 1;\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual(graph["src/main.ts"], ["shared/id.ts"]);
  });
});

test("baseUrl lets bare specifiers resolve to local files without flagging npm packages", async () => {
  await withProject({
    "package.json": JSON.stringify({ name: "x", dependencies: { react: "1.0.0" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "src" } }),
    "src/app.ts": 'import react from "react";\nimport { util } from "utils/util";\nexport default [react, util];\n',
    "src/utils/util.ts": "export const util = 1;\n"
  }, async (root) => {
    const { graph, diagnostics } = await graphOf(root);
    assert.deepEqual(graph["src/app.ts"], ["src/utils/util.ts"]);
    assert.deepEqual(diagnostics.unresolvedAliases, []);
  });
});

test("an exact alias does not capture longer specifiers that merely start with it", async () => {
  await withProject({
    "tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "@config": ["./config/index.ts"] } }
    }),
    "src/a.ts": 'import c from "@config";\nexport default c;\n',
    "src/b.ts": 'import c from "@configuration/thing";\nexport default c;\n',
    "config/index.ts": "export default 1;\n"
  }, async (root) => {
    const mappings = await loadAliasMappings(root);
    assert.equal(resolveAlias("@config", mappings), "config/index.ts");
    assert.equal(resolveAlias("@configuration/thing", mappings), null);

    const { graph, diagnostics } = await graphOf(root);
    assert.deepEqual(graph["src/a.ts"], ["config/index.ts"]);
    assert.deepEqual(graph["src/b.ts"], []);
    assert.deepEqual(diagnostics.unresolvedAliases, []);
  });
});

test("the longest matching alias pattern wins", async () => {
  await withProject({
    "tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "@/*": ["./src/*"], "@/ui/*": ["./packages/ui/*"] } }
    }),
    "src/main.ts": 'import { b } from "@/ui/button";\nexport default b;\n',
    "src/ui/button.ts": "export const b = 'wrong';\n",
    "packages/ui/button.ts": "export const b = 'right';\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual(graph["src/main.ts"], ["packages/ui/button.ts"]);
  });
});

test("SvelteKit $lib resolves through the generated tsconfig and the svelte config", async () => {
  await withProject({
    "svelte.config.js": "export default {};\n",
    "src/routes/+page.ts": 'import { greet } from "$lib/greet";\nexport const load = () => greet();\n',
    "src/lib/greet.ts": "export const greet = () => 'hi';\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual(graph["src/routes/+page.ts"], ["src/lib/greet.ts"]);
  });
});

test("workspace packages use their own tsconfig aliases", async () => {
  await withProject({
    "package.json": JSON.stringify({ name: "mono", private: true }),
    "apps/web/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    "apps/web/src/page.ts": 'import { x } from "@/x";\nexport default x;\n',
    "apps/web/src/x.ts": "export const x = 1;\n",
    "apps/api/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./app/*"] } } }),
    "apps/api/app/main.ts": 'import { x } from "@/x";\nexport default x;\n',
    "apps/api/app/x.ts": "export const x = 2;\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual(graph["apps/web/src/page.ts"], ["apps/web/src/x.ts"]);
    assert.deepEqual(graph["apps/api/app/main.ts"], ["apps/api/app/x.ts"]);
  });
});

test("paths declared in a referenced tsconfig (Vite style) are honoured", async () => {
  await withProject({
    "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
    "tsconfig.app.json": JSON.stringify({ compilerOptions: { paths: { "@app/*": ["./src/*"] } } }),
    "src/main.ts": 'import { v } from "@app/v";\nexport default v;\n',
    "src/v.ts": "export const v = 1;\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual(graph["src/main.ts"], ["src/v.ts"]);
  });
});

test("a declared alias that points nowhere is reported once per import", async () => {
  await withProject({
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    "src/main.ts": 'import { a } from "@/missing";\nexport default a;\n'
  }, async (root) => {
    const { graph, diagnostics } = await graphOf(root);
    assert.deepEqual(graph["src/main.ts"], []);
    assert.deepEqual(diagnostics.unresolvedAliases, [{ file: "src/main.ts", specifier: "@/missing" }]);
  });
});

// ------------------------------------------------------------ edge resolution

test("dynamic import() creates an edge", async () => {
  await withProject({
    "src/router.ts": 'export const load = () => import("./pages/home");\n',
    "src/pages/home.ts": "export default 1;\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual(graph["src/router.ts"], ["src/pages/home.ts"]);
  });
});

test("import = require() and import('x') types create edges", async () => {
  await withProject({
    "src/a.ts": 'import legacy = require("./legacy");\nexport type T = import("./types").T;\nexport default legacy;\n',
    "src/legacy.ts": "export = 1;\n",
    "src/types.ts": "export type T = string;\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual([...graph["src/a.ts"]].sort(), ["src/legacy.ts", "src/types.ts"]);
  });
});

test("importing the same module several times yields a single edge", async () => {
  await withProject({
    "src/a.ts": [
      'import type { T } from "./b";',
      'import { v } from "./b";',
      'export { v } from "./b";',
      'export const lazy = () => import("./b");',
      "export type U = T;"
    ].join("\n"),
    "src/b.ts": "export type T = string;\nexport const v = 1;\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual(graph["src/a.ts"], ["src/b.ts"]);
  });
});

test("a file never depends on itself", async () => {
  await withProject({
    "src/index.ts": 'export * from "./index";\nexport const a = 1;\n'
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual(graph["src/index.ts"], []);
  });
});

test("./x.jsx, ./x.mjs and ./x.cjs resolve to their TypeScript sources", async () => {
  await withProject({
    "src/a.tsx": 'import "./b.jsx";\nimport "./c.mjs";\nimport "./d.cjs";\nexport default 1;\n',
    "src/b.tsx": "export default 1;\n",
    "src/c.mts": "export default 1;\n",
    "src/d.cts": "export default 1;\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual([...graph["src/a.tsx"]].sort(), ["src/b.tsx", "src/c.mts", "src/d.cts"]);
  });
});

test("relative imports that climb above the project root do not match root files", async () => {
  await withProject({
    "a.ts": 'import "../b";\nexport default 1;\n',
    "b.ts": "export default 2;\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual(graph["a.ts"], []);
  });
});

// ----------------------------------------------------------- analyzer details

async function analyzeTs(content: string) {
  const analyzer = new TsMorphAnalyzer();
  return analyzer.analyze(
    { path: "src/x.ts", absolutePath: "/x/src/x.ts", extension: ".ts", size: content.length, lines: 1, content },
    { projectRoot: "/x" } as never
  );
}

test("destructured constants are listed by their bound names", async () => {
  const analysis = await analyzeTs("export const { alpha, beta: renamed } = source;\nexport const [first] = list;\n");
  const names = analysis.symbols.map((symbol) => symbol.name).sort();
  assert.deepEqual(names, ["alpha", "first", "renamed"]);
});

test("function overloads produce one symbol", async () => {
  const analysis = await analyzeTs([
    "export function parse(value: string): string;",
    "export function parse(value: number): number;",
    "export function parse(value: unknown) { return value; }",
    "class A { m(a: string): void; m(a: number): void; m(a: unknown) {} }"
  ].join("\n"));
  assert.equal(analysis.symbols.filter((symbol) => symbol.name === "parse").length, 1);
  assert.equal(analysis.symbols.filter((symbol) => symbol.name === "m").length, 1);
});

// --------------------------------------------------------------- ignore rules

test("nested .gitignore files apply to their own subtree only", async () => {
  await withProject({
    ".gitignore": "root-ignored.ts\n",
    "root-ignored.ts": "export const a = 1;\n",
    "pkg/.gitignore": "generated/\nlocal.ts\n",
    "pkg/generated/out.ts": "export const g = 1;\n",
    "pkg/local.ts": "export const l = 1;\n",
    "pkg/keep.ts": "export const k = 1;\n",
    "other/local.ts": "export const l = 1;\n"
  }, async (root) => {
    const files = (await scanFiles(root)).map((file) => file.path);
    assert.deepEqual(files, [".gitignore", "other/local.ts", "pkg/.gitignore", "pkg/keep.ts"]);
  });
});

test("editing .gitignore between scans in the same process is picked up", async () => {
  await withProject({
    ".gitignore": "a.ts\n",
    "a.ts": "export const a = 1;\n",
    "b.ts": "export const b = 1;\n"
  }, async (root) => {
    assert.deepEqual((await scanFiles(root)).map((file) => file.path), [".gitignore", "b.ts"]);
    await writeFile(join(root, ".gitignore"), "b.ts\n", "utf8");
    assert.deepEqual((await scanFiles(root)).map((file) => file.path), [".gitignore", "a.ts"]);
  });
});

test("secret env files are ignored but .env look-alikes are not", async () => {
  await withProject({
    ".env": "SECRET=1\n",
    ".env.local": "SECRET=2\n",
    "src/.env.production": "SECRET=3\n",
    ".envrc": "use nix\n",
    "src/.environment.ts": "export const environment = {};\n"
  }, async (root) => {
    const files = (await scanFiles(root)).map((file) => file.path);
    assert.deepEqual(files, [".envrc", "src/.environment.ts"]);
  });
});

test("ignored binary extensions match regardless of case", async () => {
  await withProject({
    "assets/Logo.PNG": "x",
    "assets/photo.JPG": "x",
    "src/a.ts": "export const a = 1;\n"
  }, async (root) => {
    assert.deepEqual((await scanFiles(root)).map((file) => file.path), ["src/a.ts"]);
  });
});
