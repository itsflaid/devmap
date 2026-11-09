import assert from "node:assert/strict";
import test from "node:test";
import { SQLExtractor } from "../src/analyzers/analysis/extractors/sqlExtractor.js";
import { DrizzleExtractor } from "../src/analyzers/analysis/extractors/drizzleExtractor.js";
import { extractEntities } from "../src/analyzers/analysis/extractors/index.js";
import { RouteFallbackExtractor, singularize } from "../src/analyzers/analysis/extractors/fallbackExtractor.js";
import { detectDatabase } from "../src/analyzers/detectors/databaseDetector.js";

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

test("singularize handles silent-e plurals distinctly from double-consonant plurals", () => {
  // Regression: "verses" was incorrectly becoming "Vers" instead of "Verse" —
  // the old rule stripped 2 chars for any "*ses" ending, which is only
  // correct for double-consonant stems (address→addresses), not silent-e
  // stems (verse→verses) that just add a bare "s".
  assert.equal(singularize("verses"), "Verse");
  assert.equal(singularize("houses"), "House");
  assert.equal(singularize("cases"), "Case");
  assert.equal(singularize("responses"), "Response");
  // Double-consonant stems still work correctly.
  assert.equal(singularize("addresses"), "Address");
  assert.equal(singularize("classes"), "Class");
  assert.equal(singularize("churches"), "Church");
  assert.equal(singularize("boxes"), "Box");
});

test("SQLExtractor detects pg usage and extracts table names from query strings", () => {
  const extractor = new SQLExtractor();
  const files = [
    scannedFile("src/db.ts", 'import { Pool } from "pg";\nexport const pool = new Pool();\n'),
    scannedFile(
      "src/routes/quran.ts",
      [
        'import { pool } from "../db.js";',
        'export async function getVerses() {',
        '  return pool.query("SELECT * FROM verses WHERE surah_id = $1", [1]);',
        '}'
      ].join("\n")
    )
  ];

  assert.equal(extractor.canHandle(files), true);
  const entities = extractor.extract(files);
  assert.ok(entities.some((e) => e.name === "Verse"));

  const verse = entities.find((e) => e.name === "Verse");
  assert.deepEqual(verse?.sourceFiles, ["src/routes/quran.ts"]);
});

test("SQLExtractor does not mistake a JS import statement for a SQL query", () => {
  // Regression: the table-name regex used to match the literal word "from"
  // inside `import { Pool } from "pg"`, producing a bogus "Pg" entity.
  const extractor = new SQLExtractor();
  const files = [scannedFile("src/db.ts", 'import { Pool } from "pg";\nexport const pool = new Pool();\n')];

  const entities = extractor.extract(files);
  assert.equal(entities.length, 0);
});

test("SQLExtractor does not activate for projects with no raw SQL client", () => {
  const extractor = new SQLExtractor();
  const files = [scannedFile("src/index.ts", 'export const x = 1;\n')];
  assert.equal(extractor.canHandle(files), false);
});

test("SQLExtractor ignores comment prose even when it contains SQL-shaped words", () => {
  // Regression: naive quote-pairing regex used to merge a JSDoc comment
  // ("...come from parsing route definitions...") with unrelated code into
  // one fake string literal, producing a bogus "Parsing" entity.
  const extractor = new SQLExtractor();
  const files = [
    scannedFile("src/db.ts", 'import { Pool } from "pg";\n'),
    scannedFile(
      "src/router.ts",
      [
        "/**",
        " * Route paths come from parsing route definitions instead of",
        " * folder conventions; ownership uses the exact same rule.",
        " */",
        "export function detectRoutes() { return []; }"
      ].join("\n")
    )
  ];
  assert.equal(extractor.extract(files).length, 0);
});

test("SQLExtractor ignores ordinary UI copy that happens to contain SQL verbs", () => {
  // Regression: "Update your billing information" (confirm/alert/toast text)
  // used to produce a bogus "Your" entity.
  const extractor = new SQLExtractor();
  const files = [
    scannedFile("src/db.ts", 'import { Pool } from "pg";\n'),
    scannedFile(
      "src/ui/checkout.ts",
      'alert("Update your billing information");\nconfirm("Delete this item?");\n'
    )
  ];
  assert.equal(extractor.extract(files).length, 0);
});

test("SQLExtractor ignores Title Case proper nouns after SQL verbs", () => {
  // Regression: DevMap's own CLI help text `.description("Update DevMap
  // configuration")` used to produce a bogus "Devmap" entity.
  const extractor = new SQLExtractor();
  const files = [
    scannedFile("src/db.ts", 'import { Pool } from "pg";\n'),
    scannedFile("src/index.ts", '.description("Update DevMap configuration");\n')
  ];
  assert.equal(extractor.extract(files).length, 0);
});

test("SQLExtractor does not scan test/doc/fixture files", () => {
  // Regression: files under docs/, test/, fixtures/ etc. were scanned like
  // any other source file, so illustrative SQL examples in documentation or
  // test-fixture query strings leaked into self-analysis output.
  const extractor = new SQLExtractor();
  const files = [
    scannedFile("src/db.ts", 'import { Pool } from "pg";\n'),
    scannedFile("docs/example.md", 'Example: `pool.query("SELECT * FROM widgets")`'),
    scannedFile("test/fixture.test.ts", 'pool.query("SELECT * FROM widgets");')
  ];
  assert.equal(extractor.extract(files).length, 0);
});

test("databaseDetector recognizes raw SQL clients (pg, mysql2, better-sqlite3)", () => {
  const pgProject = [
    scannedFile("package.json", JSON.stringify({ dependencies: { pg: "^8.0.0" } }))
  ];
  assert.equal(detectDatabase(pgProject)?.provider, "PostgreSQL (raw SQL)");

  const mysqlProject = [
    scannedFile("package.json", JSON.stringify({ dependencies: { mysql2: "^3.0.0" } }))
  ];
  assert.equal(detectDatabase(mysqlProject)?.provider, "MySQL (raw SQL)");

  const sqliteProject = [
    scannedFile("package.json", JSON.stringify({ dependencies: { "better-sqlite3": "^9.0.0" } }))
  ];
  assert.equal(detectDatabase(sqliteProject)?.provider, "SQLite (raw SQL)");
});

test("singularize keeps the trailing s of singulars that end in s", () => {
  assert.equal(singularize("statuses"), "Status");
  assert.equal(singularize("buses"), "Bus");
  assert.equal(singularize("aliases"), "Alias");
  assert.equal(singularize("exercises"), "Exercise");
  assert.equal(singularize("purchases"), "Purchase");
  assert.equal(singularize("licenses"), "License");
});

test("route-hint entities skip action segments such as /staff/reset", () => {
  const entities = new RouteFallbackExtractor().extract([
    { path: "/api/staff", file: "src/routes/api/staff/+server.ts", kind: "api", methods: ["GET", "POST"] },
    { path: "/api/staff/reset", file: "src/routes/api/staff/reset/+server.ts", kind: "api", methods: ["POST"] }
  ]);

  assert.deepEqual(entities.map((entity) => entity.name), ["Staff"]);
});

const DRIZZLE_SCHEMA = [
  "import { pgTable, text, integer, timestamp, boolean } from 'drizzle-orm/pg-core';",
  "import { relations, sql } from 'drizzle-orm';",
  "",
  "// Tabel bisnis; komentar dengan kurung ( dan tanda kutip ' tidak boleh merusak parser.",
  "export const business = pgTable('business', {",
  "  id: text('id').primaryKey(),",
  "  name: text('name').notNull(),",
  "  note: text('note').default('a, b, {c}')",
  "});",
  "",
  "export const user = pgTable('user', {",
  "  id: text('id').primaryKey(),",
  "  businessId: text('business_id').references(() => business.id),",
  "  email: text('email').notNull().unique()",
  "});",
  "",
  "export const staffInvitations = pgTable(",
  "  'staff_invitations',",
  "  {",
  "    id: text('id').primaryKey(),",
  "    businessId: text('business_id').notNull().references(() => business.id, { onDelete: 'cascade' }),",
  "    createdBy: text('created_by').references(() => user.id)",
  "  },",
  "  (t) => [sql`check (${t.id} <> '')`]",
  ");",
  "",
  "export const profile = pgTable('profile', {",
  "  id: text('id').primaryKey(),",
  "  userId: text('user_id').notNull().unique().references(() => user.id)",
  "});",
  "",
  "export const categoryNode = pgTable('category_node', {",
  "  id: text('id').primaryKey(),",
  "  parentId: text('parent_id').references((): any => categoryNode.id)",
  "});",
  "",
  "export const roleEnum = pgEnum('role', ['OWNER', 'STAFF']);"
].join("\n");

test("DrizzleExtractor reads tables, columns and foreign keys from a schema file", () => {
  const extractor = new DrizzleExtractor();
  const files = [scannedFile("src/lib/server/db/schema.ts", DRIZZLE_SCHEMA)];

  assert.equal(extractor.canHandle(files), true);
  const entities = extractor.extract(files);

  assert.deepEqual(entities.map((entity) => entity.name), [
    "Business", "User", "StaffInvitation", "Profile", "CategoryNode"
  ]);
  assert.ok(entities.every((entity) => entity.source === "drizzle"));

  const business = entities.find((entity) => entity.name === "Business");
  assert.deepEqual(business?.fields.filter((field) => !field.isRelation).map((field) => field.name), ["id", "name", "note"]);
  assert.equal(business?.fields.find((field) => field.name === "name")?.isOptional, false);
  assert.equal(business?.fields.find((field) => field.name === "note")?.isOptional, true);
});

test("DrizzleExtractor turns foreign keys into relations in both directions", () => {
  const entities = new DrizzleExtractor().extract([scannedFile("db/schema.ts", DRIZZLE_SCHEMA)]);
  const relations = entities.flatMap((entity) => entity.relations);
  const has = (from: string, to: string, kind: string) =>
    relations.some((relation) => relation.from === from && relation.to === to && relation.kind === kind);

  assert.ok(has("Business", "User", "one-to-many"));
  assert.ok(has("Business", "StaffInvitation", "one-to-many"));
  assert.ok(has("User", "StaffInvitation", "one-to-many"));
  // A unique foreign key is a one-to-one, and a self reference is not a cross-entity relation.
  assert.ok(relations.some((relation) => relation.from.length > 0 && relation.to === "Profile" && relation.kind === "one-to-one"));
  assert.ok(!relations.some((relation) => relation.from === "CategoryNode" && relation.to === "CategoryNode"));
});

test("DrizzleExtractor names an entity from the SQL table, not from a `usersTable` variable", () => {
  const entities = new DrizzleExtractor().extract([
    scannedFile(
      "src/db/schema.ts",
      "import { sqliteTable, text } from 'drizzle-orm/sqlite-core';\nexport const usersTable = sqliteTable('users', { id: text('id') });\n"
    )
  ]);

  assert.deepEqual(entities.map((entity) => entity.name), ["User"]);
});

test("DrizzleExtractor reads relations() declarations that have no foreign key", () => {
  const entities = new DrizzleExtractor().extract([
    scannedFile(
      "src/db/schema.ts",
      [
        "import { mysqlTable, int } from 'drizzle-orm/mysql-core';",
        "import { relations } from 'drizzle-orm';",
        "export const author = mysqlTable('author', { id: int('id').primaryKey() });",
        "export const book = mysqlTable('book', { id: int('id').primaryKey(), authorId: int('author_id') });",
        "export const authorRelations = relations(author, ({ many }) => ({ books: many(book) }));"
      ].join("\n")
    )
  ]);

  const relations = entities.flatMap((entity) => entity.relations);
  assert.ok(relations.some((relation) => relation.from === "Author" && relation.to === "Book" && relation.kind === "one-to-many"));
});

test("DrizzleExtractor ignores pgTable look-alikes in files that do not use drizzle-orm", () => {
  const extractor = new DrizzleExtractor();
  const files = [
    scannedFile("src/other.ts", "export const pgTable = () => 1;\nexport const t = pgTable('x', {});\n"),
    scannedFile("docs/schema.md", "import from 'drizzle-orm'\npgTable('x', {})")
  ];

  assert.equal(extractor.canHandle(files), false);
  assert.deepEqual(extractor.extract(files), []);
});

test("extractEntities prefers a Prisma schema over Drizzle and Drizzle over route hints", () => {
  const routes = [{ path: "/api/widgets", file: "src/routes/api/widgets/+server.ts", kind: "api" as const, methods: ["GET", "POST"] }];
  const drizzleFile = scannedFile("src/db/schema.ts", DRIZZLE_SCHEMA);
  const prismaFile = scannedFile("prisma/schema.prisma", "model Order {\n  id Int @id\n}\n");

  assert.equal(extractEntities([drizzleFile], routes).source, "drizzle");
  assert.deepEqual(extractEntities([drizzleFile], routes).entityNames.includes("Widget"), false);
  assert.equal(extractEntities([drizzleFile, prismaFile], routes).source, "prisma");
});
