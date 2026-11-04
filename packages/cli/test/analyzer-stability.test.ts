import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LineIndex } from "../src/analyzers/analysis/lineIndex.js";
import { MAX_READ_BYTES, scanFiles, type ScannedFile } from "../src/analyzers/analysis/fileScanner.js";
import { TsMorphAnalyzer } from "../src/analyzers/analysis/tsMorphAnalyzer.js";
import { detectExternalServices } from "../src/analyzers/detectors/serviceDetector.js";
import { buildDependencyGraph } from "../src/analyzers/graph/dependencyGraph.js";
import { createProjectFingerprint, createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { compareText } from "../src/utils/compare.js";

function scanned(path: string, content: string): ScannedFile {
  return {
    path,
    absolutePath: `/fixture/${path}`,
    extension: path.slice(path.lastIndexOf(".")),
    size: Buffer.byteLength(content),
    lines: content.split(/\r?\n/).length,
    content
  };
}

async function withTempProject(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "devmap-stability-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function timed<T>(run: () => Promise<T> | T): Promise<{ value: T; ms: number }> {
  const started = performance.now();
  const value = await run();
  return { value, ms: performance.now() - started };
}

// The budgets below are an order of magnitude above the measured time and far
// below what the quadratic implementations needed (minutes), so they only trip
// on a real regression and not on a slow CI machine.

test("LineIndex returns the same line as counting newlines before the position", () => {
  const text = "first\nsecond\r\nthird\n\n  fifth line\nlast";
  const index = new LineIndex(text);

  for (let position = 0; position <= text.length; position += 1) {
    const expected = text.slice(0, position).split("\n").length;
    assert.equal(index.lineAt(position), expected, `position ${position}`);
  }
});

test("a generated file with tens of thousands of declarations is analyzed in linear time", async () => {
  const count = 40_000;
  const content = Array.from(
    { length: count },
    (_, index) => `export function f${index}(a: number, b: string): number { return a + b.length + ${index}; }`
  ).join("\n");
  const analyzer = new TsMorphAnalyzer();

  const { value: analysis, ms } = await timed(() => analyzer.analyze(scanned("src/generated.ts", content), { files: [] }));

  assert.equal(analysis.symbols.length, count);
  assert.equal(analysis.symbols[0]?.line, 1);
  assert.equal(analysis.symbols[count - 1]?.line, count);
  assert.ok(ms < 20_000, `analysis took ${Math.round(ms)}ms`);
});

test("symbol lines are right for CRLF sources and for CommonJS exports", async () => {
  const content = [
    "const a = 1;",
    "",
    "function load() {}",
    "class Box {",
    "  open() {}",
    "}",
    "module.exports = { load, extra: () => 1 };"
  ].join("\r\n");

  const analysis = await new TsMorphAnalyzer().analyze(scanned("src/box.js", content), { files: [] });
  const lineOf = (name: string) => analysis.symbols.find((symbol) => symbol.name === name)?.line;

  assert.equal(lineOf("a"), 1);
  assert.equal(lineOf("load"), 3);
  assert.equal(lineOf("Box"), 4);
  assert.equal(lineOf("open"), 5);
  assert.equal(lineOf("extra"), 7);
  assert.equal(analysis.symbols.find((symbol) => symbol.name === "load")?.exported, true);
});

test("import specifiers are still read from every import form without parser output", () => {
  const files = [
    scanned("src/main.ts", [
      'import a from "./a";',
      'import { b1, b2 } from "./b";',
      'import * as c from "./c";',
      'import type { D } from "./d";',
      "import {",
      "  e1,",
      "  e2,",
      '} from "./e";',
      'export * from "./f";',
      'export { g } from "./g";',
      'const h = require("./h");',
      'const i = await import("./i");',
      'import "./j";'
    ].join("\n")),
    ...["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((name) => scanned(`src/${name}.ts`, `export const ${name} = 1;\n`))
  ];

  const { graph } = buildDependencyGraph(files, {});

  assert.deepEqual(
    [...(graph["src/main.ts"] ?? [])].sort(),
    ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((name) => `src/${name}.ts`)
  );
});

test("import scanning does not rescan a quote-free file from every export", async () => {
  const count = 40_000;
  const content = Array.from({ length: count }, (_, index) => `export function f${index}() { return ${index}; }`).join("\n");
  const files = [scanned("src/generated.ts", content), scanned("package.json", '{"name":"x"}')];

  const graph = await timed(() => buildDependencyGraph(files, {}));
  const services = await timed(() => detectExternalServices(files));

  assert.deepEqual(graph.value.graph["src/generated.ts"], []);
  assert.deepEqual(services.value, []);
  assert.ok(graph.ms < 10_000, `dependency graph took ${Math.round(graph.ms)}ms`);
  assert.ok(services.ms < 10_000, `service detection took ${Math.round(services.ms)}ms`);
});

test("a very long identifier does not stall the search-term index", async () => {
  await withTempProject(async (root) => {
    await writeFile(join(root, "package.json"), '{"name":"long-name"}');
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "index.ts"), `export class ${"A".repeat(300_000)} {}\n`);

    const { value: map, ms } = await timed(() => createProjectMap(root));

    assert.equal(map.stats.totalFiles, 2);
    assert.ok(ms < 20_000, `createProjectMap took ${Math.round(ms)}ms`);
  });
});

test("scanFiles lists a file over the size limit without reading it", async () => {
  await withTempProject(async (root) => {
    await writeFile(join(root, "real.ts"), "export const x = 1;\n");
    await writeFile(join(root, "dataset.csv"), "");
    await truncate(join(root, "dataset.csv"), MAX_READ_BYTES + 1);

    const files = await scanFiles(root);
    const dataset = files.find((file) => file.path === "dataset.csv");

    assert.ok(dataset, "the oversize file is still listed");
    assert.equal(dataset.oversize, true);
    assert.equal(dataset.content, "");
    assert.equal(dataset.lines, 0);
    assert.equal(dataset.size, MAX_READ_BYTES + 1);
    assert.equal(files.find((file) => file.path === "real.ts")?.oversize, undefined);
    assert.equal(files.find((file) => file.path === "real.ts")?.lines, 2);
  });
});

test("an unread file still changes the fingerprint when its size changes, and is reported", async () => {
  await withTempProject(async (root) => {
    await writeFile(join(root, "package.json"), '{"name":"with-dump"}');
    await writeFile(join(root, "dump.sql"), "");
    await truncate(join(root, "dump.sql"), MAX_READ_BYTES + 10);

    const before = await scanFiles(root);
    const map = await createProjectMap(root);
    await truncate(join(root, "dump.sql"), MAX_READ_BYTES + 20);
    const after = await scanFiles(root);

    assert.notEqual(createProjectFingerprint(before), createProjectFingerprint(after));
    assert.ok(
      map.warnings?.some((warning) => warning.includes("dump.sql") && warning.includes("not read")),
      `warnings: ${JSON.stringify(map.warnings)}`
    );
  });
});

test("scanFiles counts lines the way split on line breaks does", async () => {
  await withTempProject(async (root) => {
    await writeFile(join(root, "crlf.ts"), "a\r\nb\nc");
    await writeFile(join(root, "trailing.ts"), "a\n");
    await writeFile(join(root, "empty.ts"), "");

    const lines = Object.fromEntries((await scanFiles(root)).map((file) => [file.path, file.lines]));

    assert.deepEqual(lines, { "crlf.ts": 3, "empty.ts": 0, "trailing.ts": 2 });
  });
});

test("scanFiles skips a symlinked file that points outside the project and keeps one that stays inside", async () => {
  const outside = await mkdtemp(join(tmpdir(), "devmap-outside-"));
  try {
    await writeFile(join(outside, "secret.ts"), "export const secret = 'not part of the project';\n");

    await withTempProject(async (root) => {
      await writeFile(join(root, "real.ts"), "export const x = 1;\n");
      await symlink(join(root, "real.ts"), join(root, "inside-link.ts"));
      await symlink(join(outside, "secret.ts"), join(root, "outside-link.ts"));

      const paths = (await scanFiles(root)).map((file) => file.path);

      assert.deepEqual(paths, ["inside-link.ts", "real.ts"]);
    });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("compareText orders names the same way under every machine locale", () => {
  assert.ok(compareText("schema.prisma", "seed.ts") < 0, "cs_CZ would sort seed.ts first");
  assert.ok(compareText("index.ts", "Input.module.css") < 0, "tr_TR would treat the dotted i as a different letter");
  assert.deepEqual(["seed.ts", "schema.prisma", "Alpha", "beta"].sort(compareText), ["Alpha", "beta", "schema.prisma", "seed.ts"]);
  assert.equal(compareText("same", "same"), 0);
});

test("no source file orders text with String#localeCompare", async () => {
  const sourceRoot = join(fileURLToPath(new URL("../src", import.meta.url)));
  const offenders: string[] = [];

  for (const entry of await readdir(sourceRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const path = join(entry.parentPath, entry.name);
    if (/\.localeCompare\(/.test(await readFile(path, "utf8"))) offenders.push(path);
  }

  assert.deepEqual(offenders, [], "use compareText from utils/compare.ts so output does not depend on LANG");
});
