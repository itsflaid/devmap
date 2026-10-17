import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ScannedFile } from "../src/analyzers/analysis/index.js";
import { detectFrameworks, detectRoutes } from "../src/analyzers/detectors/index.js";
import { buildDependencyGraph, detectEntryPoints, isArchitectureSource } from "../src/analyzers/graph/index.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { detectProjectMetadata } from "../src/analyzers/pipeline/projectMetadata.js";

function fileOf(path: string, content = ""): ScannedFile {
  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
  return { path, absolutePath: `/p/${path}`, extension, size: content.length, lines: 1, content };
}

async function withProject(files: Record<string, string>, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "devmap-detect-"));
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

// ------------------------------------------------------------ framework + meta

test("a package.json with a UTF-8 BOM is still read", () => {
  const manifest = `﻿${JSON.stringify({ name: "api", dependencies: { express: "^4.0.0" } })}`;
  assert.deepEqual(detectFrameworks([fileOf("package.json", manifest)]), ["express"]);
});

test("@vue/cli-service marks a Vue app", () => {
  const manifest = JSON.stringify({
    name: "legacy", dependencies: { vue: "^2.6.0" }, devDependencies: { "@vue/cli-service": "~4.5.0" }
  });
  assert.deepEqual(detectFrameworks([fileOf("package.json", manifest)]), ["vue"]);
});

test("an Express app with npm init's default main is not downgraded to a library", () => {
  const manifest = JSON.stringify({ name: "api", main: "index.js", dependencies: { express: "^4.0.0" } });
  const files = [fileOf("package.json", manifest), fileOf("index.js", "const express = require('express');\n")];
  const frameworks = detectFrameworks(files);
  const metadata = detectProjectMetadata("/p", frameworks[0] ?? "unknown", files, frameworks);

  assert.equal(metadata.framework, "express");
  assert.ok(metadata.projectTypes.includes("api-service"));
  assert.ok(!metadata.projectTypes.includes("library"));
});

test("a plain package with main/exports and no app framework is still a library", () => {
  const files = [fileOf("package.json", JSON.stringify({ name: "lib", main: "dist/index.js" })), fileOf("src/index.ts", "export const a = 1;")];
  const metadata = detectProjectMetadata("/p", "unknown", files, []);
  assert.deepEqual(metadata.projectTypes, ["library"]);
});

// ------------------------------------------------------------ entry + scope

test("barrel index files that the app imports are not entry points", () => {
  const entries = detectEntryPoints({
    "src/main.ts": ["src/components/index.ts", "src/components/index.test.ts"],
    "src/components/index.ts": ["src/components/Button.ts"],
    "src/components/Button.ts": [],
    "src/components/index.test.ts": ["src/components/index.ts"]
  });
  assert.deepEqual(entries, ["src/main.ts"]);
});

test("a root index imported only by its tests is still an entry point", () => {
  const entries = detectEntryPoints({
    "src/index.ts": ["src/run.ts"],
    "src/run.ts": [],
    "src/index.test.ts": ["src/index.ts"]
  });
  assert.deepEqual(entries, ["src/index.ts"]);
});

test("feature folders named demo/docs are source; repo-level samples and test folders are not", () => {
  assert.equal(isArchitectureSource("src/features/demo/page.ts"), true);
  assert.equal(isArchitectureSource("src/docs/render.ts"), true);
  assert.equal(isArchitectureSource("examples/basic/index.ts"), false);
  assert.equal(isArchitectureSource("packages/ui/examples/a.ts"), false);
  assert.equal(isArchitectureSource("test/helpers.ts"), false);
  assert.equal(isArchitectureSource("src/util.test.mts"), false);
  assert.equal(isArchitectureSource("app/test_models.py"), false);
});

test("root-level test folders and SvelteKit pages get the right file scope", async () => {
  await withProject({
    "package.json": JSON.stringify({ name: "kit", devDependencies: { "@sveltejs/kit": "^2.0.0" } }),
    "src/routes/+page.svelte": "<script>let a = 1;</script>\n<p>{a}</p>\n",
    "src/routes/api/items/+server.ts": "export const GET = () => new Response('ok');\n",
    "test/helpers.ts": "export const helper = 1;\n"
  }, async (root) => {
    const map = await createProjectMap(root);
    assert.equal(map.fileIndex["src/routes/+page.svelte"]?.scope, "ui");
    assert.equal(map.fileIndex["src/routes/api/items/+server.ts"]?.scope, "api");
    assert.equal(map.fileIndex["test/helpers.ts"]?.scope, "test");
  });
});

// ------------------------------------------------------------------- routes

test("pages/index is the root route and not /index", () => {
  const routes = detectRoutes([
    fileOf("pages/index.tsx", "export default () => null;"),
    fileOf("pages/blog/index.tsx", "export default () => null;")
  ], ["nextjs"]);
  assert.deepEqual(routes.map((route) => route.path), ["/", "/blog"]);
});

test("route handlers exported through lists or destructuring still report their methods", () => {
  const routes = detectRoutes([
    fileOf("app/api/a/route.ts", "const handler = () => {};\nexport { handler as GET, handler as POST };\n"),
    fileOf("app/api/auth/route.ts", "export const { GET, POST } = handlers;\n"),
    fileOf("app/api/c/route.ts", 'export { PUT, DELETE } from "./impl";\n')
  ], ["nextjs"]);
  const byPath = Object.fromEntries(routes.map((route) => [route.path, route.methods]));
  assert.deepEqual(byPath["/api/a"], ["GET", "POST"]);
  assert.deepEqual(byPath["/api/auth"], ["GET", "POST"]);
  assert.deepEqual(byPath["/api/c"], ["DELETE", "PUT"]);
});

test("nuxt server/api and server/routes are API routes with method suffixes", () => {
  const routes = detectRoutes([
    fileOf("server/api/users/index.get.ts", "export default defineEventHandler(() => []);"),
    fileOf("server/api/users/[id].delete.ts", "export default defineEventHandler(() => ({}));"),
    fileOf("server/routes/health.ts", "export default defineEventHandler(() => 'ok');"),
    fileOf("pages/index.vue", "<template><div/></template>")
  ], ["nuxt"]);

  const summary = routes.map((route) => `${route.kind} ${route.path} ${(route.methods ?? []).join(",")}`.trim());
  assert.deepEqual(summary, [
    "page /",
    "api /api/users GET",
    "api /api/users/[id] DELETE",
    "api /health"
  ]);
});

test("express routers mounted through several levels compose every prefix", () => {
  const files = [
    fileOf("src/app.ts", [
      'import express from "express";',
      'import { apiRouter } from "./api";',
      "const app = express();",
      'app.use("/api", apiRouter);'
    ].join("\n")),
    fileOf("src/api.ts", [
      'import { Router } from "express";',
      'import { usersRouter } from "./users";',
      "export const apiRouter = Router();",
      'apiRouter.use("/v1", usersRouter);'
    ].join("\n")),
    fileOf("src/users.ts", [
      'import { Router } from "express";',
      "export const usersRouter = Router();",
      'usersRouter.get("/me", () => {});',
      'usersRouter.post("/", () => {});'
    ].join("\n"))
  ];
  const { graph } = buildDependencyGraph(files);
  const routes = detectRoutes(files, ["express"], graph);

  assert.deepEqual(routes.map((route) => `${route.path} ${route.methods?.join(",")}`), [
    "/api/v1 POST",
    "/api/v1/me GET"
  ]);
});

test("express mounts with middleware before the router still resolve", () => {
  const files = [
    fileOf("src/app.ts", [
      'import { ordersRouter } from "./orders";',
      "const app = express();",
      'app.use("/orders", requireAuth, limiter(), ordersRouter);'
    ].join("\n")),
    fileOf("src/orders.ts", 'export const ordersRouter = Router();\nordersRouter.get("/", () => {});\n')
  ];
  const { graph } = buildDependencyGraph(files);
  const routes = detectRoutes(files, ["express"], graph);
  assert.deepEqual(routes.map((route) => `${route.path} ${route.methods?.join(",")}`), ["/orders GET"]);
});
