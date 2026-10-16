import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";

const ROUTE = "export async function GET() { return Response.json([]); }\nexport async function POST() { return Response.json({}); }\n";

test("each CRUD resource becomes its own feature instead of collapsing into one", async () => {
  const root = await mkdtemp(join(tmpdir(), "devmap-crud-"));
  try {
    const write = async (path: string, content: string) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    };
    await write("package.json", JSON.stringify({
      name: "app",
      dependencies: { next: "15", react: "19", "react-dom": "19", "@prisma/client": "6" },
    }));
    await write("prisma/schema.prisma", [
      'datasource db { provider = "postgresql" url = env("DATABASE_URL") }',
      "model User { id Int @id name String posts Post[] invoices Invoice[] }",
      "model Post { id Int @id title String authorId Int author User @relation(fields: [authorId], references: [id]) }",
      "model Invoice { id Int @id amount Int userId Int user User @relation(fields: [userId], references: [id]) }",
    ].join("\n"));
    for (const resource of ["posts", "invoices", "users"]) {
      await write(`app/api/${resource}/route.ts`, ROUTE);
    }

    const map = await createProjectMap(root);
    const byName = new Map(map.features.map((feature) => [feature.name, feature]));

    for (const [name, resource] of [
      ["Post Management", "posts"],
      ["Invoice Management", "invoices"],
      ["User Management", "users"],
    ] as const) {
      const feature = byName.get(name);
      assert.ok(feature, `${name} should exist; got ${[...byName.keys()].join(", ")}`);
      assert.ok(feature.files.includes(`app/api/${resource}/route.ts`));
      const foreign = feature.files.filter((file) => file.startsWith("app/api/") && !file.includes(`/${resource}/`));
      assert.deepEqual(foreign, [], `${name} must not contain other resources' routes`);
    }

    const crudCapabilities = (map.capabilities ?? []).filter((capability) => capability.kind === "crud");
    assert.equal(crudCapabilities.length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
