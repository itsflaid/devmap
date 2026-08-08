import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { detectFrameworks } from "../src/analyzers/detectors/frameworkDetector.js";
import { detectRoutes } from "../src/analyzers/detectors/routeDetector.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";

function createScannedFile(path: string, content: string) {
  return {
    path,
    absolutePath: `C:/fixture/${path}`,
    extension: path.slice(path.lastIndexOf(".")),
    size: Buffer.byteLength(content),
    lines: content.split(/\r?\n/).length,
    content
  };
}

async function buildFixture(files: Record<string, string>): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-framework-routes-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(projectRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return projectRoot;
}

// ---------------------------------------------------------------------------
// Astro
// ---------------------------------------------------------------------------

test("detectRoutes maps Astro pages and endpoints", () => {
  const files = [
    createScannedFile("package.json", JSON.stringify({ dependencies: { astro: "^5.0.0" } })),
    createScannedFile("src/pages/index.astro", "---\n---\n<h1>Home</h1>\n"),
    createScannedFile("src/pages/about.astro", "<h1>About</h1>\n"),
    createScannedFile("src/pages/blog/index.astro", "<h1>Blog</h1>\n"),
    createScannedFile("src/pages/blog/[slug].astro", "<h1>Post</h1>\n"),
    createScannedFile("src/pages/guides/[...slug].astro", "<h1>Docs</h1>\n"),
    createScannedFile("src/pages/_components/Card.astro", "<h1>Card</h1>\n"),
    createScannedFile("src/pages/api/subscribe.ts", "export const POST = async () => new Response();\n"),
    createScannedFile("src/content/blog/first.md", "# Hello\n")
  ];

  assert.deepEqual(detectFrameworks(files), ["astro"]);
  const routes = detectRoutes(files, ["astro"]);
  assert.deepEqual(
    routes.map((route) => [route.path, route.kind, route.methods]),
    [
      ["/", "page", undefined],
      ["/about", "page", undefined],
      ["/api/subscribe", "api", ["POST"]],
      ["/blog", "page", undefined],
      ["/blog/[slug]", "page", undefined],
      ["/guides/[...slug]", "page", undefined]
    ]
  );
});

test("Astro pages surface as features through project map", async () => {
  const projectRoot = await buildFixture({
    "package.json": JSON.stringify({ name: "astro-site", dependencies: { astro: "^5.0.0" } }),
    "src/pages/index.astro": "---\n---\n<h1>Home</h1>\n",
    "src/pages/blog/index.astro": "<h1>Blog</h1>\n",
    "src/pages/blog/[slug].astro": "<h1>Post</h1>\n"
  });

  try {
    const snapshot = await createProjectMap(projectRoot);
    assert.equal(snapshot.framework, "astro");
    assert.deepEqual(
      snapshot.routes.map((route) => route.path).sort(),
      ["/", "/blog", "/blog/[slug]"]
    );
    const names = snapshot.features.map((feature) => feature.name);
    assert.ok(names.includes("Blog"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Nuxt
// ---------------------------------------------------------------------------

test("detectFrameworks and detectRoutes handle Nuxt file-based routing", () => {
  const files = [
    createScannedFile("package.json", JSON.stringify({
      dependencies: { nuxt: "^3.12.0", vue: "^3.4.0" }
    })),
    createScannedFile("nuxt.config.ts", "export default defineNuxtConfig({});\n"),
    createScannedFile("pages/index.vue", "<template><div>Home</div></template>\n"),
    createScannedFile("pages/blog/index.vue", "<template><div>Blog</div></template>\n"),
    createScannedFile("pages/blog/[slug].vue", "<template><div>Post</div></template>\n"),
    createScannedFile("src/App.vue", "<template><div>App</div></template>\n")
  ];

  assert.deepEqual(detectFrameworks(files), ["nuxt"]);
  const routes = detectRoutes(files, ["nuxt"]);
  assert.deepEqual(
    routes.map((route) => [route.path, route.kind]),
    [
      ["/", "page"],
      ["/blog", "page"],
      ["/blog/[slug]", "page"]
    ]
  );
});

test("Nuxt pages surface as features through project map", async () => {
  const projectRoot = await buildFixture({
    "package.json": JSON.stringify({ name: "nuxt-app", dependencies: { nuxt: "^3.12.0", vue: "^3.4.0" } }),
    "nuxt.config.ts": "export default defineNuxtConfig({});\n",
    "pages/index.vue": "<template><div>Home</div></template>\n",
    "pages/blog/index.vue": "<template><div>Blog</div></template>\n",
    "pages/blog/[slug].vue": "<template><div>Post</div></template>\n"
  });

  try {
    const snapshot = await createProjectMap(projectRoot);
    assert.equal(snapshot.framework, "nuxt");
    assert.deepEqual(
      snapshot.routes.map((route) => route.path).sort(),
      ["/", "/blog", "/blog/[slug]"]
    );
    const names = snapshot.features.map((feature) => feature.name);
    assert.ok(names.includes("Blog"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Vue (SPA + Vue Router)
// ---------------------------------------------------------------------------

test("Vue Router routes resolve for identifier and lazy-import forms", async () => {
  const projectRoot = await buildFixture({
    "package.json": JSON.stringify({
      name: "vue-spa",
      dependencies: { vue: "^3.4.0", "vue-router": "^4.3.0" },
      devDependencies: { "@vitejs/plugin-vue": "^5.0.0", vite: "^7.0.0" }
    }),
    "src/App.vue": "<template><div>App</div></template>\n",
    "src/router.ts": [
      'import { createRouter, createWebHistory } from "vue-router";',
      'import { AboutPage } from "./views/AboutPage.vue";',
      "export const router = createRouter({",
      "  history: createWebHistory(),",
      "  routes: [",
      '    { path: "/about", component: AboutPage },',
      '    { path: "/contact", component: () => import("./views/ContactPage.vue") },',
      "  ]",
      "});"
    ].join("\n"),
    "src/views/AboutPage.vue": '<script>export default { name: "AboutPage" }</script>\n<template><div>About</div></template>\n',
    "src/views/ContactPage.vue": '<script>export default { name: "ContactPage" }</script>\n<template><div>Contact</div></template>\n'
  });

  try {
    const snapshot = await createProjectMap(projectRoot);
    assert.equal(snapshot.framework, "vue");
    const names = snapshot.features.map((feature) => feature.name);
    assert.ok(names.includes("About"), "identifier form resolves to a feature");
    assert.ok(names.includes("Contact"), "lazy-import form resolves to a feature");

    const contact = snapshot.features.find((feature) => feature.name === "Contact");
    assert.ok(contact?.files.includes("src/views/ContactPage.vue"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
