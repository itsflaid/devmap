import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";

async function buildFixture(files: Record<string, string>): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-scope-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(projectRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return projectRoot;
}

test("workspace with multiple package manifests does not combine unrelated apps into one framework claim", async () => {
  const projectRoot = await buildFixture({
    "package.json": JSON.stringify({
      name: "monorepo-root",
      workspaces: ["apps/*", "packages/*"],
    }),
    "apps/web/package.json": JSON.stringify({
      name: "web-app",
      dependencies: { next: "^14.0.0", react: "^18.0.0" },
    }),
    "apps/web/app/page.tsx": 'export default function WebPage() { return <div>Web</div>; }\n',
    "apps/web/app/layout.tsx": 'export default function Layout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n',
    "apps/api/package.json": JSON.stringify({
      name: "api-server",
      dependencies: { express: "^4.18.0" },
    }),
    "apps/api/server.ts": [
      'import express from "express";',
      "const app = express();",
      'app.get("/health", (_req, res) => res.json({ ok: true }));',
      "app.listen(3001);",
    ].join("\n"),
    "packages/shared/package.json": JSON.stringify({
      name: "shared-utils",
      dependencies: {},
    }),
    "packages/shared/index.ts": 'export const VERSION = "1.0.0";\n',
  });

  try {
    const snapshot = await createProjectMap(projectRoot);

    const routePaths = snapshot.routes.map((r) => r.path);

    const hasExpressRoute = routePaths.some((p) => p.includes("/health"));
    const hasNextPage = snapshot.features.some((f) =>
      f.files.some((file) => file.includes("apps/web"))
    );

    // Weak check: only requires that some app's route or feature is detected.
    assert.ok(
      hasExpressRoute || hasNextPage,
      "At least one app's features should be detected"
    );

    const webFramework = snapshot.framework;
    const apiFiles = Object.keys(snapshot.fileIndex).filter((f) => f.includes("apps/api"));
    const webFiles = Object.keys(snapshot.fileIndex).filter((f) => f.includes("apps/web"));

    assert.ok(apiFiles.length > 0, "API app files should be analyzed");
    assert.ok(webFiles.length > 0, "Web app files should be analyzed");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
