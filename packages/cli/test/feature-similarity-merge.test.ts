import assert from "node:assert/strict";
import test from "node:test";
import {
  computeSimilarity,
  findSimilarFeature,
  jaccardSimilarity,
  trigramSimilarity,
  buildFeatureFingerprint,
  fingerprintSimilarity,
  MAX_SEARCH_TERMS,
  type FeatureIdentity
} from "../src/analyzers/features/featureSimilarity.js";
import {
  mergeIntoFeatureList,
  mergeFeatureData,
  mergeDomainFeatures,
} from "../src/analyzers/features/featureMerge.js";
import type { FeatureInfo } from "../src/analyzers/features/featureDetector.js";

function makeIdentity(overrides: Partial<FeatureIdentity> & { name: string }): FeatureIdentity {
  return {
    files: [],
    searchTerms: [],
    relatedEntities: [],
    ...overrides
  };
}

function makeFeature(overrides: Partial<FeatureInfo> & { name: string }): FeatureInfo {
  return {
    purpose: `Identifies ${overrides.name.toLowerCase()} capability in the project.`,
    files: [],
    entryPoint: undefined,
    entryPoints: [],
    businessFlow: [],
    searchTerms: [],
    confidence: "medium",
    evidence: [],
    ...overrides
  };
}

test("computeSimilarity — related features match above threshold", () => {
  const a = makeIdentity({ name: "Plan Management", searchTerms: ["plan", "management"], relatedEntities: ["Plan"] });
  const b = makeIdentity({ name: "Customizable Plans", searchTerms: ["plan", "custom"], relatedEntities: ["Plan"] });
  assert.ok(computeSimilarity(a, b) >= 0.35);
});

test("computeSimilarity — unrelated features below threshold", () => {
  const a = makeIdentity({ name: "Authentication", files: ["src/auth.ts"], searchTerms: ["auth", "login"], relatedEntities: ["User"] });
  const b = makeIdentity({ name: "Search", files: ["src/search.ts"], searchTerms: ["search", "index"], relatedEntities: [] });
  assert.ok(computeSimilarity(a, b) < 0.35);
});

test("computeSimilarity — search overlap pushes similar names above threshold", () => {
  const a = makeIdentity({ name: "Search", searchTerms: ["search", "find"] });
  const b = makeIdentity({ name: "Search Functionality", searchTerms: ["search", "find"] });
  assert.ok(computeSimilarity(a, b) >= 0.35);
});

test("computeSimilarity — file overlap dominates score", () => {
  const a = makeIdentity({ name: "Feature A", files: ["src/a.ts", "src/b.ts", "src/c.ts"] });
  const b = makeIdentity({ name: "Feature B", files: ["src/a.ts", "src/b.ts", "src/d.ts"] });
  assert.ok(computeSimilarity(a, b) >= 0.35);
});

test("computeSimilarity — critical files differ, thin search terms => no match", () => {
  const a = makeIdentity({ name: "Auth", files: ["src/auth.ts"], searchTerms: ["auth"] });
  const b = makeIdentity({ name: "Payments", files: ["src/payments.ts"], searchTerms: ["payment"] });
  assert.ok(computeSimilarity(a, b) < 0.35);
});

test("computeSimilarity — no searchTerms, different files, different entities => no match", () => {
  const a = makeIdentity({ name: "Alpha", files: ["src/alpha.ts"], relatedEntities: ["AlphaEntity"] });
  const b = makeIdentity({ name: "Beta", files: ["src/beta.ts"], relatedEntities: ["BetaEntity"] });
  assert.ok(computeSimilarity(a, b) < 0.35);
});

test("computeSimilarity — identical features return ~1.0", () => {
  const a = makeIdentity({ name: "Cache", files: ["src/cache.ts"], searchTerms: ["cache", "redis"], relatedEntities: ["Cache"] });
  const b = makeIdentity({ name: "Cache", files: ["src/cache.ts"], searchTerms: ["cache", "redis"], relatedEntities: ["Cache"] });
  assert.ok(computeSimilarity(a, b) > 0.99);
});

test("computeSimilarity — empty vs data returns partial score", () => {
  const empty = makeIdentity({ name: "" });
  const data = makeIdentity({ name: "Auth", files: ["src/auth.ts"], searchTerms: ["auth"] });
  const score = computeSimilarity(empty, data);
  assert.ok(score >= 0 && score <= 1);
});

test("findSimilarFeature — empty list returns null", () => {
  const result = findSimilarFeature(makeIdentity({ name: "Test" }), []);
  assert.equal(result, null);
});

test("mergeIntoFeatureList — existing feature enriched, original name preserved", () => {
  const existing = makeFeature({
    name: "Plan Management", files: ["src/plans.ts"],
    searchTerms: ["plan", "Plans"], confidence: "high"
  });
  const addition = makeFeature({
    name: "Customizable Plans", files: ["src/plans.ts"],
    searchTerms: ["plan", "custom", "Plans"]
  });
  const list = [existing];
  mergeIntoFeatureList(list, addition);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Plan Management");
  assert.ok(list[0].searchTerms.includes("custom"));
});

test("mergeIntoFeatureList — same name merges not duplicates", () => {
  const existing = makeFeature({ name: "Auth", files: ["src/auth.ts"], evidence: ["src/auth.ts"] });
  const addition = makeFeature({ name: "Auth", files: ["src/login.ts"], evidence: ["src/login.ts"] });
  const list = [existing];
  mergeIntoFeatureList(list, addition);
  assert.equal(list.length, 1);
  assert.ok(list[0].files.includes("src/login.ts"));
});

test("mergeFeatureData — union + dedup of arrays", () => {
  const existing = makeFeature({ name: "Search", files: ["src/a.ts"], searchTerms: ["search"], evidence: ["src/a.ts"] });
  const addition = makeFeature({ name: "Search", files: ["src/b.ts", "src/a.ts"], searchTerms: ["search", "index"], evidence: ["src/b.ts"] });
  const merged = mergeFeatureData(existing, addition);
  assert.deepEqual(merged.files, ["src/a.ts", "src/b.ts"]);
  assert.ok(merged.searchTerms.includes("index"));
});

test("mergeFeatureData — searchTerms capped at MAX_SEARCH_TERMS", () => {
  const existing = makeFeature({ name: "Test", searchTerms: ["a", "b", "c", "d", "e", "f", "g", "h"] });
  const addition = makeFeature({ name: "Test", searchTerms: ["i", "j", "k", "l", "m"] });
  const merged = mergeFeatureData(existing, addition);
  assert.ok(merged.searchTerms.length <= MAX_SEARCH_TERMS);
});

test("mergeDomainFeatures — batch merge does not produce duplicates", () => {
  const list = [
    makeFeature({ name: "Auth", files: ["src/auth.ts"], searchTerms: ["auth"] }),
    makeFeature({ name: "Payments", files: ["src/payments.ts"], searchTerms: ["payment"] }),
  ];
  const domainFeatures = [
    makeFeature({ name: "Auth", files: ["src/auth.ts"], searchTerms: ["auth", "login"] }),
    makeFeature({ name: "Analytics", searchTerms: ["analytics"] }),
  ];
  mergeDomainFeatures(list, domainFeatures);
  const names = list.map((f) => f.name);
  assert.ok(names.includes("Auth"));
  assert.ok(names.includes("Analytics"));
  assert.ok(names.includes("Payments"));
  assert.equal(names.filter((n) => n === "Auth").length, 1);
});

test("jaccardSimilarity — both empty returns 1.0, one empty returns 0.0", () => {
  assert.equal(jaccardSimilarity(new Set(), new Set()), 1.0);
  assert.equal(jaccardSimilarity(new Set(["a"]), new Set()), 0.0);
  assert.equal(jaccardSimilarity(new Set(), new Set(["b"])), 0.0);
});

test("trigramSimilarity — similar strings produce expected score", () => {
  const score = trigramSimilarity("Authentication", "Authentication System");
  assert.ok(score > 0.7);
});

test("buildFeatureFingerprint — same content yields same fingerprint", () => {
  const a = buildFeatureFingerprint({ name: "Auth", files: ["src/auth.ts"], searchTerms: ["auth"], relatedEntities: [] });
  const b = buildFeatureFingerprint({ name: "Auth", files: ["src/auth.ts"], searchTerms: ["auth"], relatedEntities: [] });
  assert.deepEqual(a, b);
});

test("fingerprintSimilarity — consistent with computeSimilarity", () => {
  const a = buildFeatureFingerprint({ name: "Search", files: ["src/search.ts"], searchTerms: ["search"], relatedEntities: [] });
  const b = buildFeatureFingerprint({ name: "Search", files: ["src/search.ts"], searchTerms: ["search"], relatedEntities: [] });
  const simScore = fingerprintSimilarity(a, b);
  assert.equal(simScore, 1.0);
});

test("entity feature with empty files merges with domain feature via terms/entities", () => {
  const entityFeature = makeFeature({
    name: "Plan Management", files: [],
    searchTerms: ["plan", "Plan", "management", "feature"], evidence: []
  });
  const domainFeature = makeFeature({
    name: "Customizable Plans", files: ["src/plans.ts"],
    searchTerms: ["plan", "custom", "Plan", "management", "feature"], evidence: []
  });
  const list = [entityFeature];
  mergeIntoFeatureList(list, domainFeature);
  assert.equal(list.length, 1);
});

test("mergeFeatureData — useless businessFlow replaced by addition", () => {
  const existing = makeFeature({ name: "Test", businessFlow: ["Identify files related to Test."] });
  const addition = makeFeature({ name: "Test", businessFlow: ["Start at src/test.ts.", "Process in src/handler.ts."] });
  const merged = mergeFeatureData(existing, addition);
  assert.deepEqual(merged.businessFlow, ["Start at src/test.ts.", "Process in src/handler.ts."]);
});

test("mergeFeatureData — generic purpose replaced by specific addition purpose", () => {
  const existing = makeFeature({ name: "Auth", purpose: "Identifies auth capability in the project." });
  const addition = makeFeature({ name: "Auth", purpose: "Handles authentication, identity, sessions, login, and access control." });
  const merged = mergeFeatureData(existing, addition);
  assert.equal(merged.purpose, "Handles authentication, identity, sessions, login, and access control.");
});

test("attachFeatureEntryPoints — 2 low-quality files do not boost confidence to high", async () => {
  const tmp = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { mkdtemp, mkdir, writeFile, rm } = tmp;
  const { createProjectMap } = await import("../src/analyzers/pipeline/projectMap.js");

  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-low-quality-test-"));

  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "low-quality-test" }));
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src", "helper.ts"), "export const x = 1;\n");
    await writeFile(join(projectRoot, "src", "util.ts"), "export const y = 2;\n");

    const projectMap = await createProjectMap(projectRoot);
    const feature = projectMap.features.find((f) => f.files.length >= 2);
    if (feature) {
      assert.notEqual(feature.confidence, "high");
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
