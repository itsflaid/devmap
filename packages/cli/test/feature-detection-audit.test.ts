import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { pageFeatureName } from "../src/analyzers/detectors/frontendFeatureDetector.js";
import { singularize } from "../src/analyzers/analysis/extractors/fallbackExtractor.js";

async function featureNames(files: Record<string, string>): Promise<string[]> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-feature-audit-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(projectRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    const snapshot = await createProjectMap(projectRoot);
    return snapshot.features.map((feature) => feature.name);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

const page = (name: string, extra = "") => `${extra}export default function ${name}() { return null; }\n`;

test("generic words are not feature signals: index files are not Search, service workers are not jobs", async () => {
  const names = await featureNames({
    "package.json": JSON.stringify({ name: "plain-app" }),
    "src/index.ts": "export const start = () => 1;\n",
    "src/lib/index.ts": "export * from './util.js';\n",
    "src/lib/util.ts": "export const util = 1;\n",
    "public/index.html": "<html></html>\n",
    "src/service-worker/sw.ts": "self.addEventListener('install', () => {});\n",
    "src/event.ts": "export const event = 1;\n",
    "src/content.ts": "export const content = 1;\n"
  });

  for (const unwanted of ["Search", "Background Jobs", "Analytics", "CMS & Content"]) {
    assert.ok(!names.includes(unwanted), `${unwanted} should not be detected from generic names (got ${names.join(", ")})`);
  }
});

test("a real search signal still counts", async () => {
  const names = await featureNames({
    "package.json": JSON.stringify({ name: "search-app" }),
    "src/search/engine.ts": "export const engine = 1;\n",
    "src/search/results.ts": "export const results = 1;\n"
  });
  assert.ok(names.includes("Search"));
});

test("package-only terms need a package import, not a local file of the same name", async () => {
  const withPackage = await featureNames({
    "package.json": JSON.stringify({ name: "blob-app" }),
    "src/storage.ts": "import { put } from '@vercel/blob'; export const save = put;\n"
  });
  assert.ok(withPackage.includes("File Upload"));

  const localOnly = await featureNames({
    "package.json": JSON.stringify({ name: "blob-local" }),
    "src/blob.ts": "export const blob = 1;\n",
    "src/use.ts": "import { blob } from './blob.js'; export const use = blob;\n"
  });
  assert.ok(!localOnly.includes("File Upload"));
});

test("tool-owned dot folders and end-to-end folders do not create features", async () => {
  const names = await featureNames({
    "package.json": JSON.stringify({ name: "dot-app" }),
    "src/main.ts": "export const main = 1;\n",
    ".tool/client/registry/search.ts": "export const search = 1;\n",
    ".tool/client/registry/search2.ts": "export const search2 = 1;\n",
    "cypress/support/create-user.ts": "export const createUser = 1;\n",
    "e2e/auth/login.ts": "import 'next-auth'; export const login = 1;\n"
  });
  assert.ok(!names.includes("Search"));
  assert.ok(!names.includes("Authentication"));
  assert.ok(!names.some((name) => /user/i.test(name)));
});

test("metadata and operational endpoints are not resources with a Management feature", async () => {
  const names = await featureNames({
    "package.json": JSON.stringify({ name: "next-site", dependencies: { next: "15.0.0" } }),
    "app/robots.ts": "export default function robots() { return { rules: [] }; }\n",
    "app/sitemap.ts": "export default function sitemap() { return []; }\n",
    "app/api/healthcheck/route.ts": "export async function GET() { return Response.json({ ok: true }); }\n",
    "app/api/revalidate/route.ts": "export async function POST() { return Response.json({ ok: true }); }\n",
    "app/api/login/route.ts": "export async function POST() { return Response.json({ ok: true }); }\n",
    "app/api/posts/route.ts": "export async function GET() { return Response.json([]); }\nexport async function POST() { return Response.json({}); }\n"
  });

  for (const unwanted of ["Robots.txt Management", "Sitemap.xml Management", "Healthcheck Management", "Revalidate Management", "Login Management"]) {
    assert.ok(!names.includes(unwanted), `${unwanted} should not exist (got ${names.join(", ")})`);
  }
  assert.ok(names.includes("Post Management"));
});

test("page names keep words that look plural and read like a title", () => {
  assert.equal(pageFeatureName("settings"), "Settings");
  assert.equal(pageFeatureName("status"), "Status");
  assert.equal(pageFeatureName("analytics"), "Analytics");
  assert.equal(pageFeatureName("scheduled-posts"), "Scheduled Post");
  assert.equal(pageFeatureName("domain_blocks"), "Domain Block");
  assert.equal(pageFeatureName("notes"), "Note");
  assert.equal(singularize("categories"), "Category");
});

test("the root page is a Home feature that does not swallow the pages it links to", async () => {
  const names = await featureNames({
    "package.json": JSON.stringify({ name: "shop", dependencies: { next: "15.0.0" } }),
    "app/page.tsx": page("HomePage", "import { Hero } from '../components/hero';\nimport { Grid } from '../components/grid';\n"),
    "app/product/[handle]/page.tsx": page("ProductPage", "import { Grid } from '../../../components/grid';\nimport { Gallery } from '../../../components/gallery';\n"),
    "app/search/page.tsx": page("SearchPage", "import { Grid } from '../../components/grid';\n"),
    "components/hero.tsx": "export const Hero = () => null;\n",
    "components/grid.tsx": "export const Grid = () => null;\n",
    "components/gallery.tsx": "export const Gallery = () => null;\n"
  });

  assert.ok(names.includes("Home"), names.join(", "));
  assert.ok(names.includes("Product"), names.join(", "));
  assert.ok(names.includes("Search"), names.join(", "));
});

test("a component shared by two pages belongs to neither", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-feature-shared-"));
  try {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "shared", dependencies: { next: "15.0.0" } }),
      "app/orders/page.tsx": page("Orders", "import { Table } from '../../components/table';\nimport { OrderRow } from '../../components/order-row';\n"),
      "app/invoices/page.tsx": page("Invoices", "import { Table } from '../../components/table';\n"),
      "components/table.tsx": "export const Table = () => null;\n",
      "components/order-row.tsx": "export const OrderRow = () => null;\n"
    };
    for (const [path, content] of Object.entries(files)) {
      const target = join(projectRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    const snapshot = await createProjectMap(projectRoot);
    const orders = snapshot.features.find((feature) => feature.name === "Order");
    const invoices = snapshot.features.find((feature) => feature.name === "Invoice");

    assert.ok(orders && invoices, snapshot.features.map((feature) => feature.name).join(", "));
    assert.ok(orders.files.includes("components/order-row.tsx"));
    assert.ok(!orders.files.includes("components/table.tsx"));
    assert.ok(!invoices.files.includes("components/table.tsx"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("Authentication does not glue the login pages to the product pages", async () => {
  const names = await featureNames({
    "package.json": JSON.stringify({ name: "remix-notes", dependencies: { "@remix-run/react": "2.0.0" } }),
    "app/root.tsx": page("Root"),
    "app/session.server.ts": "import 'next-auth'; export const getSession = () => null;\n",
    "app/routes/join.tsx": page("Join", "import { getSession } from '../session.server';\n"),
    "app/routes/login.tsx": page("Login", "import { getSession } from '../session.server';\n"),
    "app/routes/notes._index.tsx": page("Notes", "import { getSession } from '../session.server';\n"),
    "app/routes/notes.new.tsx": page("NewNote", "import { getSession } from '../session.server';\n")
  });

  assert.ok(names.includes("Note"), names.join(", "));
  assert.ok(names.includes("Join"), names.join(", "));
  assert.ok(names.includes("Login"), names.join(", "));
});

test("CLI Commands needs a command line program, not just a folder or main.ts name", async () => {
  const webApp = await featureNames({
    "package.json": JSON.stringify({ name: "web", dependencies: { "@angular/core": "19.0.0" } }),
    "src/main.ts": "import { bootstrapApplication } from '@angular/platform-browser'; bootstrapApplication(App);\n",
    "src/app/commands/palette.ts": "export const palette = 1;\n"
  });
  assert.ok(!webApp.includes("CLI Commands"), webApp.join(", "));

  const cli = await featureNames({
    "package.json": JSON.stringify({ name: "tool", bin: { tool: "dist/index.js" } }),
    "src/index.ts": "import { Command } from 'commander';\nexport const program = new Command();\n",
    "src/commands/build.ts": "export const build = () => 1;\n"
  });
  assert.ok(cli.includes("CLI Commands"), cli.join(", "));
});

test("rate limiting, background jobs and encryption are not swallowed by each other or by Reminders", async () => {
  const names = await featureNames({
    "package.json": JSON.stringify({ name: "chat", dependencies: { next: "15.0.0" } }),
    "src/server/rateLimit.ts": "import { Ratelimit } from '@upstash/ratelimit';\nimport { Redis } from '@upstash/redis';\nexport const limit = new Ratelimit({ redis: Redis.fromEnv() });\n",
    "src/lib/encryption.ts": "export const encrypt = (value: string) => value;\n",
    "src/lib/qstash.ts": "import { Client } from '@upstash/qstash';\nexport const queue = new Client({});\n",
    "src/app/api/reminders/trigger/route.ts": "import { encrypt } from '../../../../lib/encryption';\nimport { queue } from '../../../../lib/qstash';\nexport async function POST() { return Response.json([encrypt, queue].length); }\n",
    "src/app/api/reminders/[id]/done/route.ts": "export async function POST() { return Response.json({ ok: true }); }\n"
  });

  for (const expected of ["Rate Limiting", "Background Jobs", "Encryption", "Reminder Management"]) {
    assert.ok(names.includes(expected), `${expected} missing (got ${names.join(", ")})`);
  }
  assert.ok(!names.includes("Caching"), "a single redis import is not caching");
});

test("scoped package terms match the full package name", async () => {
  const names = await featureNames({
    "package.json": JSON.stringify({ name: "monitored" }),
    "src/a.ts": "import * as Sentry from '@sentry/nextjs'; export const a = Sentry;\n",
    "src/b.ts": "export const b = 1;\n"
  });
  assert.ok(names.includes("Logging & Monitoring"), names.join(", "));
});

test("a feature's entry point is its page, not a script that mentions it", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-feature-entry-"));
  try {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "rooms", dependencies: { next: "15.0.0" } }),
      "app/room/[id]/page.tsx": page("RoomPage", "import { Bubble } from '../../../components/bubble';\n"),
      "app/room/[id]/info/page.tsx": page("RoomInfo"),
      "components/bubble.tsx": "export const Bubble = () => null;\n",
      "scripts/generate-room-icons.mjs": "console.log('room icons');\n"
    };
    for (const [path, content] of Object.entries(files)) {
      const target = join(projectRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    const snapshot = await createProjectMap(projectRoot);
    const room = snapshot.features.find((feature) => feature.name === "Room");
    assert.ok(room, snapshot.features.map((feature) => feature.name).join(", "));
    assert.equal(room.entryPoint, "app/room/[id]/page.tsx");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("a VS Code extension is a feature of its own", async () => {
  const names = await featureNames({
    "package.json": JSON.stringify({ name: "ext", engines: { vscode: "^1.90.0" } }),
    "src/extension.ts": "import * as vscode from 'vscode';\nexport function activate(context: vscode.ExtensionContext) { return context; }\n",
    "src/commands.ts": "import { window } from 'vscode';\nexport const hello = () => window.showInformationMessage('hi');\n"
  });
  assert.ok(names.includes("VS Code Extension"), names.join(", "));
});
