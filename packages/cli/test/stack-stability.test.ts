import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SveltePreprocessor, VuePreprocessor } from "../src/analyzers/analysis/preprocessors/index.js";
import { detectEntryPoints } from "../src/analyzers/graph/index.js";
import { detectProjectMetadata } from "../src/analyzers/pipeline/projectMetadata.js";

function scannedFile(path: string, content: string) {
  return {
    path,
    absolutePath: `/tmp/${path}`,
    extension: path.slice(path.lastIndexOf(".")),
    size: Buffer.byteLength(content),
    lines: content.split(/\r?\n/).length,
    content
  };
}

// ---------------------------------------------------------------- SFC scripts

test("Vue SFC with <script> and <script setup> keeps the imports of both blocks", () => {
  const sfc = [
    "<template><Comment /></template>",
    "<script>",
    'import { useArticleStore } from "@/store/article";',
    "export default { name: 'RwvArticle' };",
    "</script>",
    '<script setup lang="ts">',
    'import Comment from "@/components/Comment";',
    "const props = defineProps<{ slug: string }>();",
    "</script>"
  ].join("\n");

  const extracted = new VuePreprocessor().extract(sfc, "src/views/Article.vue");

  assert.ok(extracted);
  assert.match(extracted.code, /@\/store\/article/);
  assert.match(extracted.code, /@\/components\/Comment/);
  assert.equal(extracted.language, "ts");
});

test("Vue SFC with a single script block and a template-only SFC behave as before", () => {
  const preprocessor = new VuePreprocessor();

  const single = preprocessor.extract('<script>import a from "./a";</script>', "A.vue");
  assert.equal(single?.language, "js");
  assert.match(single?.code ?? "", /\.\/a/);

  assert.equal(preprocessor.extract("<template><p>hi</p></template>", "B.vue"), null);
  assert.equal(preprocessor.extract("<script>\n  \n</script><template/>", "C.vue"), null);
});

test("Vue SFC ignores a self-closing external script tag and JSON script data", () => {
  const sfc = [
    '<script src="./legacy.js" />',
    '<script type="application/ld+json">{ "@context": "x" }</script>',
    "<script setup>",
    'import b from "./b";',
    "</script>"
  ].join("\n");

  const extracted = new VuePreprocessor().extract(sfc, "D.vue");

  assert.ok(extracted);
  assert.match(extracted.code, /\.\/b/);
  assert.doesNotMatch(extracted.code, /@context/);
});

test("Svelte component reads its instance script and its module script", () => {
  const component = [
    '<script module>',
    'export { helper } from "./helper";',
    "</script>",
    '<script lang="ts">',
    'import Child from "./Child.svelte";',
    "let count = 0;",
    "</script>"
  ].join("\n");
  const legacy = [
    '<script context="module">export const prerender = true;</script>',
    '<script>import Other from "./Other.svelte";</script>'
  ].join("\n");

  const preprocessor = new SveltePreprocessor();
  const modern = preprocessor.extract(component, "Page.svelte");
  const old = preprocessor.extract(legacy, "Old.svelte");

  assert.match(modern?.code ?? "", /\.\/helper/);
  assert.match(modern?.code ?? "", /\.\/Child\.svelte/);
  assert.equal(modern?.virtualExtension, ".ts");
  assert.match(old?.code ?? "", /prerender/);
  assert.match(old?.code ?? "", /\.\/Other\.svelte/);
});

// --------------------------------------------------------------- entry points

test("ambient .d.ts files are never entry points, even when nothing imports them", () => {
  const entries = detectEntryPoints({
    "src/main.ts": ["src/app/routes.ts"],
    "src/app/routes.ts": [],
    "src/app/auth/user-request.d.ts": ["src/app/models/user.ts"],
    "src/app/models/user.ts": [],
    "src/env.d.mts": ["src/app/models/user.ts"]
  });

  assert.deepEqual(entries, ["src/main.ts"]);
});

// ------------------------------------------------------------- workspace type

function metadataFor(files: Array<[string, string]>, framework = "nextjs", root = "/fixture") {
  const scanned = files.map(([path, content]) => scannedFile(path, content));
  const frameworks = framework === "unknown" ? [] : [framework];
  return detectProjectMetadata(root, framework as never, scanned, frameworks as never);
}

// The file really exists next to the project: the old check only looked at the disk,
// so a yaml that merely exists must not be enough to call the repo a monorepo.
function withWorkspaceFile<T>(yaml: string, run: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "devmap-workspace-"));
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), yaml);
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("pnpm-workspace.yaml without a packages list is single-package pnpm config", () => {
  const yaml = "onlyBuiltDependencies:\n  - esbuild\n";
  const project = withWorkspaceFile(yaml, (root) => metadataFor([
    ["package.json", JSON.stringify({ name: "kit", devDependencies: { next: "^15" } })],
    ["pnpm-workspace.yaml", yaml]
  ], "nextjs", root));

  assert.equal(project.workspaceType, "single-package");
});

test("a workspace that only lists the root is not a monorepo", () => {
  const yaml = '# pnpm < 10.5 needs `packages`\npackages: ["."]\nallowBuilds:\n  sharp: true\n';
  const project = withWorkspaceFile(yaml, (root) => metadataFor([
    ["package.json", JSON.stringify({ name: "blog", dependencies: { astro: "^5" } })],
    ["pnpm-workspace.yaml", yaml]
  ], "astro", root));

  assert.equal(project.workspaceType, "single-package");
});

test("a workspace with a real member is a monorepo, including members named like tooling", () => {
  const block = metadataFor([
    ["package.json", JSON.stringify({ name: "root", dependencies: { nuxt: "^4" } })],
    ["pnpm-workspace.yaml", "packages:\n  - proxy\n"],
    ["proxy/package.json", JSON.stringify({ name: "proxy" })]
  ], "nuxt");
  const named = metadataFor([
    ["package.json", JSON.stringify({ name: "root", private: true, workspaces: { packages: ["apps/*"] } })],
    ["apps/docs/package.json", JSON.stringify({ name: "docs", dependencies: { next: "^15" } })]
  ]);
  const negated = metadataFor([
    ["package.json", JSON.stringify({ name: "root", workspaces: ["packages/*", "!packages/legacy"] })],
    ["packages/legacy/package.json", JSON.stringify({ name: "legacy" })]
  ]);

  assert.equal(block.workspaceType, "monorepo");
  assert.equal(named.workspaceType, "monorepo");
  assert.equal(negated.workspaceType, "single-package");
});

test("a tooling package.json (remix.init, scripts) does not make a repo a monorepo", () => {
  const project = metadataFor([
    ["package.json", JSON.stringify({ name: "stack", dependencies: { "@remix-run/react": "^2" } })],
    ["remix.init/package.json", JSON.stringify({ name: "remix.init" })],
    ["scripts/package.json", JSON.stringify({ name: "scripts" })]
  ], "remix");

  assert.equal(project.workspaceType, "single-package");
});

test("a scaffold hook manifest (remix.init) does not add a library label to a web app", () => {
  const project = metadataFor([
    ["package.json", JSON.stringify({ name: "stack", dependencies: { "@remix-run/react": "^2" } })],
    ["remix.init/package.json", JSON.stringify({ name: "remix.init", main: "index.js" })]
  ], "remix");

  assert.deepEqual(project.projectTypes, ["web-app"]);
});

test("two packages without a declared workspace (frontend/ + server root) are a multi-package repo", () => {
  const project = metadataFor([
    ["package.json", JSON.stringify({ name: "mern", main: "server.js", dependencies: { express: "^4" } })],
    ["frontend/package.json", JSON.stringify({ name: "frontend", dependencies: { react: "^18", "react-dom": "^18" } })]
  ], "react");

  assert.equal(project.workspaceType, "monorepo");
});

// ---------------------------------------------------------- framework in MERN

test("a root that declares a secondary framework is an app, not a library, even if React wins", () => {
  const scanned = [
    scannedFile("package.json", JSON.stringify({
      name: "proshop",
      main: "server.js",
      dependencies: { express: "^4", mongoose: "^5" }
    })),
    scannedFile("frontend/package.json", JSON.stringify({
      name: "frontend",
      dependencies: { react: "^16", "react-dom": "^16", "react-scripts": "3.4.3" }
    }))
  ];

  const project = detectProjectMetadata("/fixture", "react", scanned, ["react", "express"]);

  assert.equal(project.framework, "react");
  assert.deepEqual(project.frameworks, ["react", "express"]);
});

test("a root with only a main field and no framework dependency is still a library", () => {
  const scanned = [
    scannedFile("package.json", JSON.stringify({ name: "lib", main: "index.js", dependencies: { lodash: "^4" } })),
    scannedFile("example/package.json", JSON.stringify({ name: "demo", dependencies: { react: "^18", "react-dom": "^18" } }))
  ];

  const project = detectProjectMetadata("/fixture", "react", scanned, ["react"]);

  assert.equal(project.framework, "unknown");
});
