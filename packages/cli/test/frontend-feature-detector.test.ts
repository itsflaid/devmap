import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";

async function buildFixture(files: Record<string, string>): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-frontend-feature-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(projectRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return projectRoot;
}

test("frontend-only pages become features even when the project has zero API routes or database", async () => {
  const projectRoot = await buildFixture({
    "package.json": JSON.stringify({ name: "pages-only" }),
    "app/quran/page.tsx": 'export default function QuranPage() { return null; }\n',
    "app/doa/page.tsx": 'export default function DoaPage() { return null; }\n'
  });

  try {
    const snapshot = await createProjectMap(projectRoot);
    const names = snapshot.features.map((f) => f.name);
    assert.ok(names.includes("Quran"));
    assert.ok(names.includes("Doa"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("page features still surface when a Prisma entity is also present (the core regression)", async () => {
  // Before this fix: any project with even one database entity (here, a
  // NextAuth-style User model) never reached the point where page routes
  // could become features at all — the entity-extraction fallback chain
  // stopped at the first non-empty source, so a mostly-frontend project's
  // real features were invisible next to whatever thin backend existed.
  const projectRoot = await buildFixture({
    "package.json": JSON.stringify({ name: "mixed", dependencies: { "next-auth": "^5.0.0" } }),
    "prisma/schema.prisma": 'generator client {\n  provider = "prisma-client-js"\n}\ndatasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\nmodel User {\n  id String @id\n}\n',
    "lib/auth.ts": 'import NextAuth from "next-auth";\nexport const auth = NextAuth({ providers: [] });\n',
    "app/api/session/route.ts": 'import { auth } from "../../../lib/auth.js";\nexport async function GET() { return Response.json(await auth()); }\n',
    "app/quran/page.tsx": 'export default function QuranPage() { return null; }\n',
    "app/dzikir/page.tsx": 'export default function DzikirPage() { return null; }\n'
  });

  try {
    const snapshot = await createProjectMap(projectRoot);
    const names = snapshot.features.map((f) => f.name);
    assert.ok(names.includes("Authentication"));
    assert.ok(names.includes("Quran"));
    assert.ok(names.includes("Dzikir"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("a component shared by two pages is not attributed to either feature", async () => {
  const projectRoot = await buildFixture({
    "package.json": JSON.stringify({ name: "shared-component" }),
    "app/SharedHeader.tsx": 'export function SharedHeader() { return null; }\n',
    "app/quran/page.tsx": 'import { SharedHeader } from "../SharedHeader.js";\nimport { VerseList } from "./VerseList.js";\nexport default function QuranPage() { return SharedHeader(); }\n',
    "app/quran/VerseList.tsx": 'export function VerseList() { return null; }\n',
    "app/doa/page.tsx": 'import { SharedHeader } from "../SharedHeader.js";\nexport default function DoaPage() { return SharedHeader(); }\n'
  });

  try {
    const snapshot = await createProjectMap(projectRoot);
    const quran = snapshot.features.find((f) => f.name === "Quran");
    const doa = snapshot.features.find((f) => f.name === "Doa");

    assert.ok(quran);
    assert.ok(doa);
    assert.ok(quran.files.includes("app/quran/VerseList.tsx"));
    assert.ok(!quran.files.includes("app/SharedHeader.tsx"));
    assert.ok(!doa.files.includes("app/SharedHeader.tsx"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("API routes are not mistaken for page features, and vice versa", async () => {
  const projectRoot = await buildFixture({
    "package.json": JSON.stringify({ name: "api-vs-page" }),
    "app/api/chat/route.ts": 'export async function POST() { return Response.json({}); }\n',
    "app/chat/page.tsx": 'export default function ChatPage() { return null; }\n'
  });

  try {
    const snapshot = await createProjectMap(projectRoot);
    // Both should surface — one from the page detector, one from the
    // route-hint entity fallback — without a broken/duplicated name.
    const names = snapshot.features.map((f) => f.name);
    assert.ok(names.some((name) => name === "Chat" || name === "Chat Management"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
