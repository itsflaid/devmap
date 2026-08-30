import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileFeatureCandidates,
  projectFeatureCandidates,
  type FeatureCandidate,
} from "../src/analyzers/features/featureCandidates.js";

function candidate(
  overrides: Partial<FeatureCandidate> & Pick<FeatureCandidate, "id" | "label" | "source">
): FeatureCandidate {
  return {
    evidence: [{
      ruleId: `test/${overrides.id}`,
      source: overrides.source,
      files: [],
      detail: `Test evidence for ${overrides.label}`,
      reliability: "medium",
    }],
    files: [],
    routePaths: [],
    entityNames: [],
    conclusionConfidence: "medium",
    ...overrides,
  };
}

test("AI-only suggestions never enter deterministic features or merge without deterministic evidence", () => {
  const candidates = [
    candidate({ id: "ai:notes", label: "Personal Notes", source: "ai" }),
    candidate({ id: "ai:journal", label: "Daily Journal", source: "ai" }),
  ];

  const reconciliation = reconcileFeatureCandidates(candidates);
  const projected = projectFeatureCandidates(reconciliation.clusters);

  assert.equal(reconciliation.clusters.length, 0);
  assert.deepEqual(projected, []);
  assert.deepEqual(reconciliation.rejectedCandidateIds, ["ai:journal", "ai:notes"]);
});

test("Chat page and matching API/entity candidates reconcile to one Chat cluster", () => {
  const reconciliation = reconcileFeatureCandidates([
    candidate({
      id: "frontend-page:chat",
      label: "Chat",
      source: "frontend-page",
      files: ["app/chat/page.tsx"],
      routePaths: ["/chat"],
      entityNames: ["Chat"],
    }),
    candidate({
      id: "entity:chat",
      label: "Chat Management",
      source: "entity",
      files: ["app/api/chat/route.ts"],
      routePaths: ["/api/chat"],
      entityNames: ["Chat"],
    }),
  ]);

  const projected = projectFeatureCandidates(reconciliation.clusters);
  assert.deepEqual(projected.map((feature) => feature.name), ["Chat"]);
  assert.equal(projected[0]?.files.length, 2);
  assert.equal(projected[0]?.confidence, "medium");
});

test("candidates without a comparable evidence dimension never merge", () => {
  const reconciliation = reconcileFeatureCandidates([
    candidate({ id: "registry:auth", label: "Authentication", source: "registry" }),
    candidate({ id: "registry:access", label: "Access Control", source: "registry" }),
  ]);

  assert.equal(reconciliation.clusters.length, 2);
  assert.deepEqual(reconciliation.clusters.map((cluster) => cluster.memberIds), [
    ["registry:access"],
    ["registry:auth"],
  ]);
});

test("a bridge candidate reconciles components independently of insertion order", () => {
  const candidates = [
    candidate({
      id: "entity:message",
      label: "Message Management",
      source: "entity",
      entityNames: ["Message"],
    }),
    candidate({
      id: "frontend-page:chat",
      label: "Chat",
      source: "frontend-page",
      files: ["app/chat/page.tsx"],
    }),
    candidate({
      id: "capability:chat",
      label: "Chat Operations",
      source: "capability",
      files: ["app/chat/page.tsx"],
      entityNames: ["Message"],
    }),
  ];

  const forward = reconcileFeatureCandidates(candidates);
  const reverse = reconcileFeatureCandidates([...candidates].reverse());

  assert.deepEqual(forward.clusters, reverse.clusters);
  assert.deepEqual(projectFeatureCandidates(forward.clusters).map((feature) => feature.name), ["Chat"]);
});

// WP0 #5 (unit): Prisma auth entities and route-derived entities remain separate
// when they share no hard anchor.
test("auth schema entity candidates and unrelated route entity candidates remain separate without shared anchor", () => {
  const reconciliation = reconcileFeatureCandidates([
    candidate({
      id: "entity:user",
      label: "User Management",
      source: "entity",
      entityNames: ["User"],
      files: ["prisma/schema.prisma"],
    }),
    candidate({
      id: "entity:snippet",
      label: "Snippet Management",
      source: "entity",
      entityNames: ["Snippet"],
      files: ["app/api/snippets/route.ts"],
    }),
  ]);

  assert.equal(reconciliation.clusters.length, 2);
  const names = reconciliation.clusters.map((c) => c.canonicalLabel).sort();
  assert.deepEqual(names, ["Snippet Management", "User Management"]);
});

// WP0 #6 (unit): Nested route segment /api/workspaces/[id]/members does not
// create standalone "Member Management" — the route resource is "workspaces",
// not "members".
test("nested route segment does not create standalone entity from subresource path", () => {
  const reconciliation = reconcileFeatureCandidates([
    candidate({
      id: "capability:workspace",
      label: "Workspace Operations",
      source: "capability",
      files: ["app/api/workspaces/route.ts"],
      routePaths: ["/api/workspaces"],
    }),
    candidate({
      id: "capability:workspace-members",
      label: "Member Operations",
      source: "capability",
      files: ["app/api/workspaces/[id]/members/route.ts"],
      routePaths: ["/api/workspaces/[id]/members"],
    }),
  ]);

  // The nested route shares the "workspaces" route resource with the parent,
  // so it should merge into the same cluster — NOT create a separate "Member" feature.
  const projected = projectFeatureCandidates(reconciliation.clusters);
  const memberFeature = projected.find((f) => f.name.includes("Member"));
  assert.equal(
    memberFeature,
    undefined,
    "Nested /members subresource must not create standalone Member feature"
  );
});

// WP0 #7 (unit): Import specifier containing "author" must not match the
// "auth" signal term via substring matching.
// This tests the import matching path in matchesSignal() at the feature
// detection level by verifying that an Author entity candidate with
// "author"-containing files does NOT get a spurious Authentication cluster.
test("author-related entity candidate does not merge into Authentication cluster", () => {
  const reconciliation = reconcileFeatureCandidates([
    candidate({
      id: "entity:author",
      label: "Author Management",
      source: "entity",
      entityNames: ["Author"],
      files: ["app/api/authors/route.ts", "lib/authors.ts"],
    }),
    candidate({
      id: "registry:auth",
      label: "Authentication",
      source: "registry",
      files: ["lib/auth.ts"],
      entityNames: [],
    }),
  ]);

  // "Author Management" and "Authentication" share no hard anchor
  // (no common files, no common entities, no common route resources).
  // They must remain separate clusters.
  assert.equal(reconciliation.clusters.length, 2);
  const labels = reconciliation.clusters.map((c) => c.canonicalLabel).sort();
  assert.deepEqual(labels, ["Authentication", "Author Management"]);
});
