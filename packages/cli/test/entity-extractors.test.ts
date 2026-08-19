import assert from "node:assert/strict";
import test from "node:test";
import { SQLExtractor } from "../src/analyzers/analysis/extractors/sqlExtractor.js";
import { singularize } from "../src/analyzers/analysis/extractors/fallbackExtractor.js";
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
