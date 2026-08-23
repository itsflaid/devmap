import assert from "node:assert/strict";
import test from "node:test";
import { detectProjectMetadata } from "../src/analyzers/pipeline/projectMetadata.js";

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

// ---------------------------------------------------------------------------
// Regression: monorepo root containing a CLI/library subpackage must not
// blank out a framework correctly detected elsewhere in the same repo.
// https://github.com/itsflaid/devmap — found by dogfooding `devmap analyze`
// on the devmap-main monorepo itself (apps/web is Astro, packages/cli has a
// bin field; framework came back "unknown" instead of "astro").
// ---------------------------------------------------------------------------

test("monorepo root with a CLI subpackage keeps the framework detected elsewhere", () => {
  const files = [
    createScannedFile("package.json", JSON.stringify({
      name: "workspace-root",
      private: true,
      workspaces: ["apps/*", "packages/*"]
    })),
    createScannedFile("apps/web/package.json", JSON.stringify({
      name: "web",
      dependencies: { astro: "^5.0.0" }
    })),
    createScannedFile("packages/cli/package.json", JSON.stringify({
      name: "cli",
      bin: { devmap: "./dist/index.js" }
    }))
  ];

  const project = detectProjectMetadata("/fixture", "astro", files, ["astro"]);

  assert.equal(project.framework, "astro");
  assert.equal(project.workspaceType, "monorepo");
  // The CLI subpackage should still be visible in the multi-label
  // classification — it just shouldn't erase the framework.
  assert.ok(project.projectTypes.includes("node-cli"));
  assert.ok(project.projectTypes.includes("web-app"));
});

test("monorepo root with a library subpackage keeps the framework detected elsewhere", () => {
  const files = [
    createScannedFile("package.json", JSON.stringify({
      name: "workspace-root",
      private: true,
      workspaces: ["apps/*", "packages/*"]
    })),
    createScannedFile("apps/web/package.json", JSON.stringify({
      name: "web",
      dependencies: { next: "^15.0.0" }
    })),
    createScannedFile("packages/utils/package.json", JSON.stringify({
      name: "utils",
      main: "./dist/index.js",
      exports: "./dist/index.js"
    }))
  ];

  const project = detectProjectMetadata("/fixture", "nextjs", files, ["nextjs"]);

  assert.equal(project.framework, "nextjs");
  assert.ok(project.projectTypes.includes("library"));
});

test("a single-package CLI project still reports framework as unknown", () => {
  const files = [
    createScannedFile("package.json", JSON.stringify({
      name: "some-cli",
      bin: { "some-cli": "./dist/index.js" },
      dependencies: { react: "^19.0.0" }
    }))
  ];

  // Even if a framework-ish dependency is present, a project whose ROOT
  // package is itself the CLI keeps the original "unknown" framework
  // behavior — this must not regress.
  const project = detectProjectMetadata("/fixture", "react", files, ["react"]);

  assert.equal(project.framework, "unknown");
  assert.equal(project.workspaceType, "single-package");
  assert.ok(project.projectTypes.includes("node-cli"));
});

test("a single-package library still reports framework as unknown", () => {
  const files = [
    createScannedFile("package.json", JSON.stringify({
      name: "some-lib",
      main: "./dist/index.js",
      exports: "./dist/index.js"
    }))
  ];

  const project = detectProjectMetadata("/fixture", "unknown", files, []);

  assert.equal(project.framework, "unknown");
  assert.ok(project.projectTypes.includes("library"));
});
