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
      routePaths: ["/chat"],
    }),
    candidate({
      id: "capability:chat",
      label: "Chat Management",
      source: "capability",
      files: ["app/chat/page.tsx"],
      routePaths: ["/chat"],
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
      label: "Workspace Management",
      source: "capability",
      files: ["app/api/workspaces/route.ts"],
      routePaths: ["/api/workspaces"],
    }),
    candidate({
      id: "capability:workspace-members",
      label: "Member Management",
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

// WP3: High fan-in shared files should NOT serve as merge anchors.
test("high fan-in shared file does not merge unrelated candidates", () => {
  const candidates = [
    candidate({
      id: "capability:chat",
      label: "Chat Management",
      source: "capability",
      files: ["app/chat/route.ts", "lib/shared-utils.ts"],
    }),
    candidate({
      id: "entity:dashboard",
      label: "Dashboard",
      source: "entity",
      files: ["app/dashboard/route.ts", "lib/shared-utils.ts"],
    }),
  ];

  // shared-utils.ts is imported by 8 different files — it's a hub, not evidence
  const reconciliation = reconcileFeatureCandidates(candidates, {
    "lib/shared-utils.ts": 8,
  });

  assert.equal(reconciliation.clusters.length, 2, "Hub file should not merge candidates");

  // Control: same file with low refcount should still merge
  const reconciliationControl = reconcileFeatureCandidates(candidates, {
    "lib/shared-utils.ts": 1,
  });

  assert.equal(reconciliationControl.clusters.length, 1, "Low refcount file should still merge");
});

test("a bridge candidate cannot fuse two distinct entity features into one cluster", () => {
  const reconciliation = reconcileFeatureCandidates([
    candidate({
      id: "capability:route-capability:bridge",
      label: "Bridge Management",
      source: "capability",
      files: ["app/api/invoices/route.ts", "app/api/posts/route.ts"],
    }),
    candidate({
      id: "entity:entity-Invoice Management:invoice-management",
      label: "Invoice Management",
      source: "entity",
      files: ["app/api/invoices/route.ts"],
      entityNames: ["Invoice"],
    }),
    candidate({
      id: "entity:entity-Post Management:post-management",
      label: "Post Management",
      source: "entity",
      files: ["app/api/posts/route.ts"],
      entityNames: ["Post"],
    }),
  ]);

  const labels = reconciliation.clusters
    .map((cluster) => cluster.candidates.filter((item) => item.source === "entity").map((item) => item.label))
    .sort();
  assert.deepEqual(labels, [["Invoice Management"], ["Post Management"]]);
  assert.ok(
    reconciliation.mergeDecisions?.some((decision) =>
      decision.outcome === "retained" && /distinct entities/.test(decision.reason)
    )
  );
});

test("entity candidates that name the same entity still merge", () => {
  const reconciliation = reconcileFeatureCandidates([
    candidate({
      id: "entity:entity-Post Management:post-management",
      label: "Post Management",
      source: "entity",
      files: ["lib/post.ts"],
      entityNames: ["Post"],
    }),
    candidate({
      id: "frontend-page:file-page:posts",
      label: "Posts",
      source: "frontend-page",
      files: ["lib/post.ts"],
      entityNames: ["Post"],
    }),
  ]);

  assert.equal(reconciliation.clusters.length, 1);
});

test("two pages never merge through a shared component, and a signal does not glue pages together", () => {
  const pages = [
    candidate({
      id: "frontend-page:notes",
      label: "Note",
      source: "frontend-page",
      files: ["app/notes/page.tsx", "components/card.tsx"],
    }),
    candidate({
      id: "frontend-page:join",
      label: "Join",
      source: "frontend-page",
      files: ["app/join/page.tsx", "components/card.tsx"],
    }),
    candidate({
      id: "registry:signal-Authentication",
      label: "Authentication",
      source: "registry",
      files: ["app/join/page.tsx", "app/notes/page.tsx", "lib/session.ts"],
      routePaths: ["/join", "/notes"],
    }),
  ];

  const labels = reconcileFeatureCandidates(pages, { "components/card.tsx": 2 })
    .clusters.map((cluster) => cluster.canonicalLabel).sort();

  assert.deepEqual(labels, ["Authentication", "Join", "Note"]);
});

test("a page and a signal with the same name are the same feature", () => {
  const labels = reconcileFeatureCandidates([
    candidate({
      id: "frontend-page:search",
      label: "Search",
      source: "frontend-page",
      files: ["app/search/page.tsx"],
    }),
    candidate({
      id: "registry:signal-Search",
      label: "Search",
      source: "registry",
      files: ["lib/search.ts"],
    }),
  ]).clusters.map((cluster) => cluster.canonicalLabel);

  assert.deepEqual(labels, ["Search"]);
});

test("a standalone candidate is never merged, even through an entity or file anchor", () => {
  const home = { ...candidate({
    id: "frontend-page:home",
    label: "Home",
    source: "frontend-page",
    files: ["app/page.tsx", "lib/post.ts"],
    entityNames: ["Post"],
  }), standalone: true };
  const post = candidate({
    id: "entity:post",
    label: "Post",
    source: "entity",
    files: ["lib/post.ts"],
    entityNames: ["Post"],
  });

  const labels = reconcileFeatureCandidates([home, post]).clusters.map((cluster) => cluster.canonicalLabel).sort();
  assert.deepEqual(labels, ["Home", "Post"]);
});

test("signals that share a file stay separate features", () => {
  const labels = reconcileFeatureCandidates([
    candidate({ id: "registry:signal-Caching", label: "Caching", source: "registry", files: ["src/rateLimit.ts"] }),
    candidate({ id: "registry:signal-Rate Limiting", label: "Rate Limiting", source: "registry", files: ["src/rateLimit.ts", "src/trpc.ts"] }),
    candidate({
      id: "capability:reminder-management",
      label: "Reminder Management",
      source: "capability",
      files: ["src/rateLimit.ts", "src/reminders.ts"],
      entityNames: ["Reminder"],
    }),
  ]).clusters.map((cluster) => cluster.canonicalLabel).sort();

  assert.deepEqual(labels, ["Caching", "Rate Limiting", "Reminder Management"]);
});

test("a page and an entity that only share a component stay separate, but a shared route resource merges them", () => {
  const room = candidate({
    id: "frontend-page:room",
    label: "Room",
    source: "frontend-page",
    files: ["app/room/page.tsx", "components/bubble.tsx"],
    routePaths: ["/room/[id]"],
  });
  const message = candidate({
    id: "entity:message",
    label: "Message Management",
    source: "entity",
    files: ["components/bubble.tsx"],
    entityNames: ["Message"],
  });
  const roomEntity = candidate({
    id: "entity:room",
    label: "Room Management",
    source: "entity",
    files: ["server/room.ts"],
    routePaths: ["/api/room"],
    entityNames: ["Room"],
  });

  const labels = reconcileFeatureCandidates([room, message, roomEntity])
    .clusters.map((cluster) => cluster.canonicalLabel).sort();
  assert.deepEqual(labels, ["Message Management", "Room"]);
});

test("a CRUD capability keeps its resource: it cannot be pulled into another resource's feature", () => {
  const labels = reconcileFeatureCandidates([
    candidate({
      id: "capability:snippets",
      label: "Snippet Management",
      source: "capability",
      files: ["api/snippets/route.ts", "api/snippets/[id]/collections/route.ts"],
      routePaths: ["/api/snippets", "/api/snippets/[id]/collections"],
      entityNames: ["Snippet"],
    }),
    candidate({
      id: "entity:collection",
      label: "Collection Management",
      source: "entity",
      files: ["api/snippets/[id]/collections/route.ts"],
      routePaths: ["/api/snippets/[id]/collections"],
      entityNames: ["Collection"],
    }),
    candidate({
      id: "entity:snippet",
      label: "Snippet Management",
      source: "entity",
      files: ["api/snippets/route.ts"],
      entityNames: ["Snippet"],
    }),
  ]).clusters.map((cluster) => cluster.canonicalLabel).sort();

  assert.deepEqual(labels, ["Collection Management", "Snippet Management"]);
});

test("a behavioral capability (sharing, publishing) never fuses a resource with its siblings through shared routes", () => {
  const labels = reconcileFeatureCandidates([
    candidate({
      id: "capability:sharing",
      label: "Content Sharing",
      source: "capability",
      files: ["api/snippets/[id]/share/route.ts"],
      routePaths: ["/api/snippets/[id]/share"],
    }),
    candidate({
      id: "capability:snippets",
      label: "Snippet Management",
      source: "capability",
      files: ["api/snippets/route.ts"],
      routePaths: ["/api/snippets"],
      entityNames: ["Snippet"],
    }),
    candidate({
      id: "capability:collections",
      label: "Collection Management",
      source: "capability",
      files: ["api/collections/route.ts"],
      routePaths: ["/api/collections", "/api/snippets"],
      entityNames: ["Collection"],
    }),
  ]).clusters.map((cluster) => cluster.canonicalLabel).sort();

  assert.deepEqual(labels, ["Collection Management", "Content Sharing", "Snippet Management"]);
});
