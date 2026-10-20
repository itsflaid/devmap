import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { scanFiles } from "../src/analyzers/analysis/fileScanner.js";
import { TsMorphAnalyzer } from "../src/analyzers/analysis/tsMorphAnalyzer.js";
import type { ScannedFile } from "../src/analyzers/analysis/index.js";
import { detectDatabase } from "../src/analyzers/detectors/databaseDetector.js";
import {
  buildDependencyGraph,
  detectEntryPoints,
  loadAliasMappings,
  manifestEntryPoints,
  readPackageManifests
} from "../src/analyzers/graph/index.js";
import { componentName } from "../src/analyzers/graph/nuxtAutoImports.js";
import { analyzeFiles } from "../src/analyzers/pipeline/analyzerRegistry.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";

async function withProject(
  files: Record<string, string>,
  run: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "devmap-jsts-"));
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

async function analyze(root: string) {
  const files = await scanFiles(root);
  const analyses = await analyzeFiles(files);
  const mappings = await loadAliasMappings(root);
  const { graph, diagnostics } = buildDependencyGraph(files, analyses, mappings);
  return { files, graph, diagnostics };
}

async function entriesOf(root: string): Promise<string[]> {
  const { files, graph } = await analyze(root);
  const localPaths = new Set(files.map((file) => file.path));
  return detectEntryPoints(graph, manifestEntryPoints(readPackageManifests(files), localPaths));
}

const pkg = (value: Record<string, unknown>) => JSON.stringify(value);

// ------------------------------------------------------------ workspace imports

test("a workspace package imported by name resolves through its exports", async () => {
  await withProject({
    "package.json": pkg({ name: "mono", private: true, workspaces: ["packages/*", "apps/*"] }),
    "packages/ui/package.json": pkg({
      name: "@acme/ui",
      exports: { ".": "./src/index.ts", "./button": "./src/button.tsx" }
    }),
    "packages/ui/src/index.ts": 'export * from "./button";\n',
    "packages/ui/src/button.tsx": "export const Button = () => null;\n",
    "apps/web/package.json": pkg({ name: "web", dependencies: { "@acme/ui": "workspace:*" } }),
    "apps/web/src/page.tsx": 'import { Button } from "@acme/ui";\nimport { Button as B } from "@acme/ui/button";\nexport default [Button, B];\n'
  }, async (root) => {
    const { graph, diagnostics } = await analyze(root);
    assert.deepEqual(
      graph["apps/web/src/page.tsx"].sort(),
      ["packages/ui/src/button.tsx", "packages/ui/src/index.ts"]
    );
    assert.deepEqual(diagnostics.unresolvedAliases, []);
  });
});

test("exports wildcards and conditions pick the source file", async () => {
  await withProject({
    "packages/kit/package.json": pkg({
      name: "@acme/kit",
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./src/index.ts", default: "./dist/index.js" },
        "./utils/*": "./src/utils/*.ts"
      }
    }),
    "packages/kit/src/index.ts": "export const kit = 1;\n",
    "packages/kit/src/utils/date.ts": "export const date = 1;\n",
    "app/main.ts": 'import { kit } from "@acme/kit";\nimport { date } from "@acme/kit/utils/date";\nexport default [kit, date];\n'
  }, async (root) => {
    const { graph } = await analyze(root);
    assert.deepEqual(graph["app/main.ts"].sort(), ["packages/kit/src/index.ts", "packages/kit/src/utils/date.ts"]);
  });
});

test("built output paths in package.json map back to the scanned sources", async () => {
  await withProject({
    "packages/core/package.json": pkg({
      name: "@acme/core",
      main: "./dist/index.cjs",
      module: "./dist/esm/index.mjs",
      types: "./dist/types/index.d.ts"
    }),
    "packages/core/src/index.ts": "export const core = 1;\n",
    "packages/legacy/package.json": pkg({ name: "@acme/legacy", main: "lib/index.js" }),
    "packages/legacy/src/index.ts": "export const legacy = 1;\n",
    "app/main.ts": 'import { core } from "@acme/core";\nimport { legacy } from "@acme/legacy";\nexport default [core, legacy];\n'
  }, async (root) => {
    const { graph } = await analyze(root);
    assert.deepEqual(graph["app/main.ts"].sort(), ["packages/core/src/index.ts", "packages/legacy/src/index.ts"]);
  });
});

test("without exports, a workspace subpath falls back to the file layout", async () => {
  await withProject({
    "packages/lib/package.json": pkg({ name: "lib" }),
    "packages/lib/src/utils/date.ts": "export const d = 1;\n",
    "packages/lib/helpers.ts": "export const h = 1;\n",
    "app/main.ts": 'import { d } from "lib/utils/date";\nimport { h } from "lib/helpers";\nexport default [d, h];\n'
  }, async (root) => {
    const { graph } = await analyze(root);
    assert.deepEqual(graph["app/main.ts"].sort(), ["packages/lib/helpers.ts", "packages/lib/src/utils/date.ts"]);
  });
});

test("registry packages and unknown scopes never become edges or diagnostics", async () => {
  await withProject({
    "package.json": pkg({ name: "app", dependencies: { react: "1.0.0" } }),
    "src/main.ts": 'import React from "react";\nimport x from "@acme/missing";\nexport default [React, x];\n'
  }, async (root) => {
    const { graph, diagnostics } = await analyze(root);
    assert.deepEqual(graph["src/main.ts"], []);
    assert.deepEqual(diagnostics.unresolvedAliases, []);
  });
});

test("a tsconfig baseUrl does not hide workspace packages", async () => {
  await withProject({
    "tsconfig.json": pkg({ compilerOptions: { baseUrl: "." } }),
    "packages/db/package.json": pkg({ name: "@acme/db", exports: "./src/index.ts" }),
    "packages/db/src/index.ts": "export const db = 1;\n",
    "src/main.ts": 'import { db } from "@acme/db";\nexport default db;\n'
  }, async (root) => {
    const { graph, diagnostics } = await analyze(root);
    assert.deepEqual(graph["src/main.ts"], ["packages/db/src/index.ts"]);
    assert.deepEqual(diagnostics.unresolvedAliases, []);
  });
});

test("an internal package's own files import it by name", async () => {
  await withProject({
    "packages/api/package.json": pkg({ name: "@acme/api", exports: { ".": "./src/index.ts", "./trpc": "./src/trpc.ts" } }),
    "packages/api/src/index.ts": 'export * from "@acme/api/trpc";\n',
    "packages/api/src/trpc.ts": "export const t = 1;\n"
  }, async (root) => {
    const { graph } = await analyze(root);
    assert.deepEqual(graph["packages/api/src/index.ts"], ["packages/api/src/trpc.ts"]);
  });
});

test("a tsconfig in a frontend/ folder next to the root still supplies its aliases", async () => {
  await withProject({
    "frontend/tsconfig.json": pkg({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    "frontend/src/main.ts": 'import { x } from "@/x";\nexport default x;\n',
    "frontend/src/x.ts": "export const x = 1;\n",
    "backend/src/main.ts": 'import { y } from "@/y";\nexport default y;\n',
    "backend/src/y.ts": "export const y = 1;\n"
  }, async (root) => {
    const { graph } = await analyze(root);
    assert.deepEqual(graph["frontend/src/main.ts"], ["frontend/src/x.ts"]);
    // Scoped: the frontend alias does not leak into the backend.
    assert.deepEqual(graph["backend/src/main.ts"], []);
  });
});

// ------------------------------------------------------------ package.json imports

test("package.json imports (#subpaths) resolve inside the nearest package", async () => {
  await withProject({
    "package.json": pkg({ name: "root", imports: { "#root-only": "./root.ts" } }),
    "root.ts": "export const r = 1;\n",
    "services/api/package.json": pkg({
      name: "api",
      imports: {
        "#db/*": { node: "./src/db/*.ts", default: "./src/db/*.ts" },
        "#config": "./src/config.ts",
        "#ext": "some-npm-package"
      }
    }),
    "services/api/src/db/client.ts": "export const client = 1;\n",
    "services/api/src/config.ts": "export const config = 1;\n",
    "services/api/src/main.ts": 'import { client } from "#db/client";\nimport { config } from "#config";\nimport ext from "#ext";\nimport r from "#root-only";\nexport default [client, config, ext, r];\n'
  }, async (root) => {
    const { graph } = await analyze(root);
    // `#root-only` belongs to the root package, not services/api.
    assert.deepEqual(
      graph["services/api/src/main.ts"].sort(),
      ["services/api/src/config.ts", "services/api/src/db/client.ts"]
    );
  });
});

test("bundler query suffixes are not part of the file name", async () => {
  await withProject({
    "src/main.ts": 'import raw from "./notes.ts?raw";\nimport Worker from "./worker.ts?worker";\nexport default [raw, Worker];\n',
    "src/notes.ts": "export default 'n';\n",
    "src/worker.ts": "export default 1;\n"
  }, async (root) => {
    const { graph } = await analyze(root);
    assert.deepEqual(graph["src/main.ts"].sort(), ["src/notes.ts", "src/worker.ts"]);
  });
});

// ------------------------------------------------------------ entry points

test("bin, scripts and published main are entries; config files and internal roots are not", async () => {
  await withProject({
    "package.json": pkg({
      name: "tool",
      bin: { tool: "./dist/cli.js" },
      main: "./dist/index.js",
      scripts: {
        dev: "tsx watch src/server.ts",
        test: "vitest --config vitest.config.ts",
        seed: "node scripts/seed.js"
      }
    }),
    "src/cli.ts": 'import { run } from "./run";\nrun();\n',
    "src/run.ts": "export const run = () => 1;\n",
    "src/index.ts": 'export { run } from "./run";\n',
    "src/server.ts": 'import { run } from "./run";\nrun();\n',
    "scripts/seed.js": 'const { run } = require("../src/run");\nrun();\n',
    "vitest.config.ts": "export default {};\n",
    "packages/internal/package.json": pkg({ name: "@t/internal", private: true, main: "./src/index.ts" }),
    "packages/internal/src/index.ts": "export const i = 1;\n",
    "src/unrelated.ts": 'import { i } from "@t/internal";\nexport default i;\n'
  }, async (root) => {
    const entries = await entriesOf(root);
    assert.equal(entries[0], "src/cli.ts", "bin ranks first");
    assert.ok(entries.includes("src/index.ts"), "published main is an entry");
    assert.ok(entries.includes("src/server.ts"), "script target is an entry");
    assert.ok(entries.includes("scripts/seed.js"));
    assert.ok(!entries.includes("vitest.config.ts"));
    assert.ok(!entries.includes("packages/internal/src/index.ts"));
  });
});

test("a published main that other source files import is plumbing, not an entry", async () => {
  await withProject({
    "package.json": pkg({ name: "lib", main: "./src/index.ts" }),
    "src/index.ts": 'export * from "./a";\n',
    "src/a.ts": 'import { b } from "./b";\nexport const a = b;\n',
    "src/b.ts": "export const b = 1;\n",
    "src/consumer.ts": 'import { a } from "./index";\nexport default a;\n'
  }, async (root) => {
    const entries = await entriesOf(root);
    assert.ok(!entries.includes("src/index.ts"));
  });
});

test("framework-loaded files are entries only while nothing imports them", async () => {
  await withProject({
    // Nuxt: the framework mounts app.vue and pages/*.vue.
    "nuxt-app/nuxt.config.ts": "export default {};\n",
    "nuxt-app/app.vue": "<template><NuxtPage /></template>\n",
    "nuxt-app/pages/index.vue": "<template><div /></template>\n",
    "nuxt-app/server/api/health.get.ts": "export default () => 'ok';\n",
    // Plain Vue SPA: the router imports pages, so they are components.
    "spa/package.json": pkg({ name: "spa" }),
    "spa/src/router.ts": 'import Home from "./pages/Home.vue";\nexport default [Home];\n',
    "spa/src/pages/Home.vue": "<template><div /></template>\n"
  }, async (root) => {
    const entries = await entriesOf(root);
    assert.ok(entries.includes("nuxt-app/app.vue"));
    assert.ok(entries.includes("nuxt-app/pages/index.vue"));
    assert.ok(entries.includes("nuxt-app/server/api/health.get.ts"));
    assert.ok(!entries.includes("spa/src/pages/Home.vue"));
  });
});

// ------------------------------------------------------------ Nuxt

test("Nuxt 4 aliases point ~ and @ at app/, ~~ at the root", async () => {
  await withProject({
    "nuxt.config.ts": "export default defineNuxtConfig({});\n",
    "app/app.vue": '<script setup lang="ts">\nimport { a } from "~/utils/a";\nimport { b } from "@/utils/b";\nimport { c } from "~~/shared/c";\nimport { d } from "#shared/d";\n</script>\n<template><div>{{ a }}{{ b }}{{ c }}{{ d }}</div></template>\n',
    "app/utils/a.ts": "export const a = 1;\n",
    "app/utils/b.ts": "export const b = 1;\n",
    "shared/c.ts": "export const c = 1;\n",
    "shared/d.ts": "export const d = 1;\n"
  }, async (root) => {
    const { graph } = await analyze(root);
    assert.deepEqual(
      graph["app/app.vue"].sort(),
      ["app/utils/a.ts", "app/utils/b.ts", "shared/c.ts", "shared/d.ts"]
    );
  });
});

test("Nuxt 3 layout and a custom srcDir keep ~ pointing at the right folder", async () => {
  await withProject({
    "classic/nuxt.config.ts": "export default {};\n",
    "classic/app.vue": '<script setup>\nimport { a } from "~/composables/a";\n</script>\n',
    "classic/composables/a.ts": "export const a = 1;\n",
    "custom/nuxt.config.ts": "export default defineNuxtConfig({ srcDir: 'client/' });\n",
    "custom/client/app.vue": '<script setup>\nimport { b } from "~/utils/b";\n</script>\n',
    "custom/client/utils/b.ts": "export const b = 1;\n"
  }, async (root) => {
    const { graph } = await analyze(root);
    assert.deepEqual(graph["classic/app.vue"], ["classic/composables/a.ts"]);
    assert.deepEqual(graph["custom/client/app.vue"], ["custom/client/utils/b.ts"]);
  });
});

test("Nuxt components are linked from the templates that render them", async () => {
  await withProject({
    "nuxt.config.ts": "export default {};\n",
    "app/app.vue": [
      "<template>",
      "  <AccountAvatar />",
      "  <base-button />",
      "  <LazyBaseModal />",
      "  <Tabs />",
      "  <NuxtLink to='/'>home</NuxtLink>",
      "</template>"
    ].join("\n"),
    "app/components/account/AccountAvatar.vue": "<template><i /></template>\n",
    "app/components/base/Button.vue": "<template><b /></template>\n",
    "app/components/base/Modal.vue": "<template><m /></template>\n",
    "app/components/tabs/index.vue": "<template><t /></template>\n",
    "app/components/Unused.vue": "<template><u /></template>\n"
  }, async (root) => {
    const { graph } = await analyze(root);
    assert.deepEqual(graph["app/app.vue"].sort(), [
      "app/components/account/AccountAvatar.vue",
      "app/components/base/Button.vue",
      "app/components/base/Modal.vue",
      "app/components/tabs/index.vue"
    ]);
  });
});

test("a Nuxt component named in a script (not just a template) is linked too", async () => {
  await withProject({
    "nuxt.config.ts": "export default {};\n",
    "app/components/nav/Bar.vue": '<script setup lang="ts">\nconst items = [{ component: NavButtonHome }];\n</script>\n<template><div /></template>\n',
    "app/components/nav/button/Home.vue": "<template><a /></template>\n"
  }, async (root) => {
    const { graph } = await analyze(root);
    assert.deepEqual(graph["app/components/nav/Bar.vue"], ["app/components/nav/button/Home.vue"]);
  });
});

test("Nuxt composables, utils, shared and server utils follow their own visibility", async () => {
  await withProject({
    "nuxt.config.ts": "export default {};\n",
    "app/composables/useUser.ts": "export const useUser = () => 1;\nexport default function useFallback() {}\n",
    "app/composables/auth/index.ts": "export const useAuth = () => 1;\n",
    "app/composables/deep/nested.ts": "export const useNested = () => 1;\n",
    "app/utils/format.ts": "export const formatDate = (d: Date) => d.toISOString();\n",
    "shared/utils/slug.ts": "export const slugify = (s: string) => s;\n",
    "server/utils/db.ts": "export const useDb = () => 1;\n",
    "app/pages/index.vue": [
      "<script setup lang=\"ts\">",
      "const user = useUser();",
      "const auth = useAuth();",
      "const nested = useNested();",
      "const when = formatDate(new Date());",
      "const slug = slugify('x');",
      "const db = useDb();",
      "</script>"
    ].join("\n"),
    "server/api/me.get.ts": "export default defineEventHandler(() => [useDb(), slugify('x'), useUser(), formatDate(new Date())]);\n"
  }, async (root) => {
    const { graph } = await analyze(root);
    assert.deepEqual(graph["app/pages/index.vue"].sort(), [
      "app/composables/auth/index.ts",
      "app/composables/useUser.ts",
      "app/utils/format.ts",
      "shared/utils/slug.ts"
    ]);
    // The server sees server/utils and shared/, never the app's composables.
    assert.deepEqual(graph["server/api/me.get.ts"].sort(), ["server/utils/db.ts", "shared/utils/slug.ts"]);
  });
});

test("a Nuxt helper must be called, so member access and locals do not link", async () => {
  await withProject({
    "nuxt.config.ts": "export default {};\n",
    "app/utils/format.ts": "export const format = (v: string) => v;\n",
    "app/pages/a.vue": "<script setup>\nconst out = date.format('x');\n</script>\n",
    "app/pages/b.vue": "<script setup>\nconst format = 'iso';\nconsole.log(format);\n</script>\n",
    "app/pages/c.vue": "<script setup>\nconst out = format('x');\n</script>\n"
  }, async (root) => {
    const { graph } = await analyze(root);
    assert.deepEqual(graph["app/pages/a.vue"], []);
    assert.deepEqual(graph["app/pages/b.vue"], []);
    assert.deepEqual(graph["app/pages/c.vue"], ["app/utils/format.ts"]);
  });
});

test("auto-import edges never appear in projects that are not Nuxt", async () => {
  await withProject({
    "package.json": pkg({ name: "plain" }),
    "app/composables/useThing.ts": "export const useThing = () => 1;\n",
    "app/main.ts": "export const x = useThing();\n"
  }, async (root) => {
    const { graph } = await analyze(root);
    assert.deepEqual(graph["app/main.ts"], []);
  });
});

test("an explicit import of an auto-imported file is not duplicated", async () => {
  await withProject({
    "nuxt.config.ts": "export default {};\n",
    "app/composables/useThing.ts": "export const useThing = () => 1;\n",
    "app/pages/index.vue": '<script setup>\nimport { useThing } from "~/composables/useThing";\nconst t = useThing();\n</script>\n'
  }, async (root) => {
    const { graph } = await analyze(root);
    assert.deepEqual(graph["app/pages/index.vue"], ["app/composables/useThing.ts"]);
  });
});

test("Nuxt component names follow the folder path and drop repeated prefixes", () => {
  assert.equal(componentName("account/AccountAvatar.vue"), "AccountAvatar");
  assert.equal(componentName("base/Button.vue"), "BaseButton");
  assert.equal(componentName("base/form/Input.vue"), "BaseFormInput");
  assert.equal(componentName("nav/button/Home.vue"), "NavButtonHome");
  assert.equal(componentName("tabs/index.vue"), "Tabs");
  assert.equal(componentName("Card.client.vue"), "Card");
  assert.equal(componentName("index.vue"), null);
});

// ------------------------------------------------------------ database

const manifestFile = (dependencies: Record<string, string>): ScannedFile => ({
  path: "package.json",
  absolutePath: "/p/package.json",
  extension: ".json",
  size: 0,
  lines: 1,
  content: pkg({ dependencies })
});

const sourceFile = (path: string): ScannedFile => ({
  path,
  absolutePath: `/p/${path}`,
  extension: path.slice(path.lastIndexOf(".")),
  size: 0,
  lines: 1,
  content: ""
});

test("a models/ folder alone is not Mongoose", () => {
  assert.equal(detectDatabase([sourceFile("src/models/user.ts"), sourceFile("src/schemas/order.ts")]), undefined);

  const withDependency = detectDatabase([
    manifestFile({ mongoose: "^8.0.0" }),
    sourceFile("src/models/user.ts"),
    sourceFile("src/schemas/order.ts")
  ]);
  assert.equal(withDependency?.provider, "Mongoose");
  assert.deepEqual(withDependency?.files, ["src/models/user.ts", "src/schemas/order.ts"]);
});

test("a primary data layer is reported together with the other stores", () => {
  assert.deepEqual(
    detectDatabase([manifestFile({ "@prisma/client": "^6", ioredis: "^5", "@supabase/supabase-js": "^2" })]),
    { provider: "Prisma", files: [], additional: ["Supabase", "Redis"] }
  );
});

test("a driver under an ORM is not reported as a second database", () => {
  assert.deepEqual(
    detectDatabase([manifestFile({ "drizzle-orm": "^0.4", postgres: "^3" })]),
    { provider: "Drizzle", files: [] }
  );
  assert.deepEqual(
    detectDatabase([manifestFile({ pg: "^8", mysql2: "^3" })]),
    { provider: "PostgreSQL (raw SQL)", files: [], additional: ["MySQL (raw SQL)"] }
  );
});

test("Redis is listed beside a database but never reported as the database itself", () => {
  assert.equal(detectDatabase([manifestFile({ ioredis: "^5" })]), undefined);
  assert.deepEqual(
    detectDatabase([manifestFile({ ioredis: "^5", pg: "^8" })]),
    { provider: "PostgreSQL (raw SQL)", files: [], additional: ["Redis"] }
  );
});

test("more ORMs and serverless drivers are recognized", () => {
  for (const [dependency, provider] of [
    ["typeorm", "TypeORM"],
    ["@nestjs/typeorm", "TypeORM"],
    ["sequelize", "Sequelize"],
    ["@mikro-orm/core", "MikroORM"],
    ["kysely", "Kysely"],
    ["knex", "Knex"],
    ["convex", "Convex"],
    ["firebase-admin", "Firebase"],
    ["mongodb", "MongoDB (native driver)"],
    ["@neondatabase/serverless", "PostgreSQL (raw SQL)"],
    ["@libsql/client", "SQLite (raw SQL)"]
  ] as const) {
    assert.equal(detectDatabase([manifestFile({ [dependency]: "1.0.0" })])?.provider, provider, dependency);
  }
});

// ------------------------------------------------------------ CommonJS

async function analyzeScript(code: string) {
  return new TsMorphAnalyzer().analyze(
    { path: "lib/x.js", absolutePath: "/p/lib/x.js", extension: ".js", size: code.length, lines: 1, content: code },
    {} as never
  );
}

test("module.exports = { ... } exposes its keys as exports", async () => {
  const analysis = await analyzeScript([
    "function helper() {}",
    "async function load() {}",
    "module.exports = { helper, load, run() {}, other: async () => 1 };"
  ].join("\n"));

  assert.deepEqual(analysis.exports, ["helper", "load", "other", "run"]);
  const bySymbol = Object.fromEntries(analysis.symbols.map((symbol) => [symbol.name, symbol]));
  assert.equal(bySymbol.helper.exported, true);
  assert.equal(bySymbol.load.async, true);
  assert.equal(bySymbol.other.kind, "function");
  assert.equal(bySymbol.other.async, true);
});

test("exports.x / module.exports.x assignments are exports", async () => {
  const analysis = await analyzeScript([
    "exports.parse = function () {};",
    "module.exports.render = async () => {};",
    "exports['kebab-name'] = 1;"
  ].join("\n"));

  assert.deepEqual(analysis.exports, ["kebab-name", "parse", "render"]);
});

test("module.exports = value is the default export and marks a local binding exported", async () => {
  const analysis = await analyzeScript("const router = {};\nmodule.exports = router;\n");
  assert.deepEqual(analysis.exports, ["default"]);
  assert.equal(analysis.symbols.find((symbol) => symbol.name === "router")?.exported, true);
});

test("ES module files are unaffected by the CommonJS reader", async () => {
  const analysis = await analyzeScript("export const a = 1;\nexport default function main() {}\n");
  assert.deepEqual(analysis.exports, ["a", "default"]);
});

// ------------------------------------------------------------ end to end

test("a workspace monorepo shows cross-package edges and its real entry points", async () => {
  await withProject({
    "package.json": pkg({ name: "mono", private: true, workspaces: ["apps/*", "packages/*"] }),
    "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
    "apps/web/package.json": pkg({
      name: "@m/web",
      private: true,
      dependencies: { next: "15.0.0", react: "19.0.0", "@m/ui": "workspace:*" }
    }),
    "apps/web/src/app/page.tsx": 'import { Button } from "@m/ui";\nexport default function Page() { return <Button />; }\n',
    "apps/web/src/app/layout.tsx": "export default function Layout({ children }: any) { return children; }\n",
    "packages/ui/package.json": pkg({ name: "@m/ui", private: true, exports: { ".": "./src/index.ts" } }),
    "packages/ui/src/index.ts": 'export { Button } from "./button";\n',
    "packages/ui/src/button.tsx": "export const Button = () => null;\n"
  }, async (root) => {
    const map = await createProjectMap(root);
    assert.ok(map.fileGraph["apps/web/src/app/page.tsx"].includes("packages/ui/src/index.ts"));
    assert.ok(map.entryPoints.includes("apps/web/src/app/page.tsx"));
    assert.ok(!map.entryPoints.includes("packages/ui/src/index.ts"), "an internal package root is not an entry");
  });
});
