import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFiles } from "../src/analyzers/pipeline/analyzerRegistry.js";
import type { ScannedFile } from "../src/analyzers/analysis/fileScanner.js";

test("ts-morph analyzer extracts JavaScript and TypeScript structure", async () => {
  const file = createScannedFile("src/service.ts", [
    'import { readFile } from "node:fs/promises";',
    'export { join } from "node:path";',
    "export interface ServiceOptions { enabled: boolean }",
    "export type ServiceResult = string;",
    "export enum ServiceState { Ready }",
    "export class ServiceClient {",
    "  async run(): Promise<string> { return readFile.toString(); }",
    "}",
    "export const DEFAULT_SERVICE = 'devmap';",
    "export async function createService(): Promise<ServiceClient> {",
    "  return new ServiceClient();",
    "}"
  ].join("\n"));

  const analysis = (await analyzeFiles([file]))[file.path];

  assert.equal(analysis.analyzer, "ts-morph");
  assert.equal(analysis.confidence, "high");
  assert.deepEqual(analysis.imports, ["node:fs/promises", "node:path"]);
  assert.deepEqual(analysis.exports, [
    "DEFAULT_SERVICE",
    "ServiceClient",
    "ServiceOptions",
    "ServiceResult",
    "ServiceState",
    "createService",
    "join"
  ]);
  assert.deepEqual(
    analysis.symbols.map((symbol) => [symbol.name, symbol.kind, symbol.exported]),
    [
      ["ServiceOptions", "interface", true],
      ["ServiceResult", "type", true],
      ["ServiceState", "enum", true],
      ["ServiceClient", "class", true],
      ["run", "method", false],
      ["DEFAULT_SERVICE", "const", true],
      ["createService", "function", true]
    ]
  );
  assert.deepEqual(
    analysis.topFunctions.find((item) => item.name === "createService"),
    {
      name: "createService",
      kind: "function",
      line: 10,
      exported: true,
      async: true
    }
  );
});

test("registry uses ts-morph's script-block preprocessor for .vue source files", async () => {
  const file = createScannedFile("src/App.vue", [
    "<script setup>",
    'import Header from "./Header.vue";',
    "export const pageTitle = 'Home';",
    "</script>"
  ].join("\n"));

  const analysis = (await analyzeFiles([file]))[file.path];

  assert.equal(analysis.analyzer, "ts-morph");
  assert.equal(analysis.confidence, "high");
  assert.deepEqual(analysis.imports, ["./Header.vue"]);
  assert.deepEqual(analysis.exports, ["pageTitle"]);
});

test("ts-morph analyzer preserves CommonJS require dependencies", async () => {
  const file = createScannedFile(
    "src/server.js",
    'const express = require("express");\nmodule.exports = express();\n'
  );

  const analysis = (await analyzeFiles([file]))[file.path];

  assert.equal(analysis.analyzer, "ts-morph");
  assert.deepEqual(analysis.imports, ["express"]);
});

test("registry uses a low-confidence fallback for unknown file types", async () => {
  const file = createScannedFile("notes.md", "# Notes\n\nNo source declarations here.\n");

  const analysis = (await analyzeFiles([file]))[file.path];

  assert.equal(analysis.analyzer, "fallback");
  assert.equal(analysis.confidence, "low");
  assert.deepEqual(analysis.imports, []);
  assert.deepEqual(analysis.exports, []);
  assert.deepEqual(analysis.symbols, []);
});

function createScannedFile(path: string, content: string): ScannedFile {
  return {
    path,
    absolutePath: `C:/fixture/${path}`,
    extension: path.slice(path.lastIndexOf(".")),
    size: Buffer.byteLength(content),
    lines: content.split(/\r?\n/).length,
    content
  };
}
