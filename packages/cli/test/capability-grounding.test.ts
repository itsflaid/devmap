import assert from "node:assert/strict";
import test from "node:test";
import { detectCapabilities } from "../src/analyzers/detectors/capabilityDetector.js";
import { detectFeatures } from "../src/analyzers/features/featureDetector.js";

const graph = (names: string[]) => ({
  entities: names.map((name) => ({ name, fields: [], relations: [], source: "prisma" as const })),
  relations: [],
  entityNames: names,
  source: "prisma" as const
});

const api = (path: string, methods: string[]) => ({
  path,
  file: `src/app/api${path.replace(/^\/api/, "")}/route.ts`,
  kind: "api" as const,
  methods
});

function scanned(path: string, content = "export const x = 1;\n") {
  return {
    path,
    absolutePath: `/fixture/${path}`,
    extension: path.slice(path.lastIndexOf(".")),
    size: Buffer.byteLength(content),
    lines: content.split(/\r?\n/).length,
    content
  };
}

test("a plural resource resolves to the model that carries its singular name", () => {
  const capabilities = detectCapabilities(
    [api("/api/exercises", ["GET", "POST"]), api("/api/exercises/[id]", ["GET", "PUT", "DELETE"])],
    graph(["Exercise"])
  );

  assert.deepEqual(capabilities.map((capability) => capability.name), ["Exercise Management"]);
});

test("a resource without a model is named from its singular, silent-e plurals included", () => {
  const capabilities = detectCapabilities(
    [api("/api/responses", ["GET", "POST"]), api("/api/statuses", ["GET", "POST"])],
    graph([])
  );

  assert.deepEqual(capabilities.map((capability) => capability.name).sort(), ["Response Management", "Status Management"]);
});

test("read-only stats and report endpoints are reporting, not a managed resource", () => {
  const capabilities = detectCapabilities(
    [
      api("/api/exercises", ["GET", "POST"]),
      api("/api/stats", ["GET"]),
      api("/api/stats/today", ["GET"]),
      api("/api/reports/weekly", ["GET"]),
      api("/api/reports/monthly", ["GET"])
    ],
    graph(["Exercise"])
  );
  const names = capabilities.map((capability) => capability.name);

  assert.ok(names.includes("Exercise Management"));
  assert.ok(names.includes("Statistics & Reporting"));
  assert.ok(!names.includes("Stat Management"));
  assert.ok(!names.includes("Report Management"));
});

test("a stats resource that accepts writes is still a managed resource", () => {
  const capabilities = detectCapabilities([api("/api/reports", ["GET", "POST", "DELETE"])], graph([]));

  assert.ok(capabilities.some((capability) => capability.name === "Report Management"));
});

test("a cart checkout file does not make a Payments feature", () => {
  const { features } = detectFeatures(
    [
      scanned("src/lib/server/domains/transactions/checkout.ts"),
      scanned("src/lib/server/domains/transactions/index.ts", "export * from './checkout';\n")
    ],
    {},
    []
  );

  assert.ok(!features.some((feature) => feature.name === "Payments"));
});

test("a payment provider module still makes a Payments feature", () => {
  const { features } = detectFeatures(
    [scanned("src/lib/stripe.ts"), scanned("src/lib/payment/webhook.ts")],
    {},
    []
  );

  assert.ok(features.some((feature) => feature.name === "Payments"));
});
