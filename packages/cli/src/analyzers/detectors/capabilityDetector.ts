import type { RouteInfo } from "./routeDetector.js";
import type { EntityGraph } from "../analysis/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CapabilityKind =
  | "crud"
  | "sharing"
  | "collaboration"
  | "discovery"
  | "publishing"
  | "social"
  | "file-management"
  | "real-time"
  | "search"
  | "reporting";

export type CapabilityInfo = {
  kind: CapabilityKind;
  name: string;
  /** Entity yang capability ini beroperasi di atasnya */
  entities: string[];
  /** Route files sebagai evidence */
  evidence: string[];
  confidence: "high" | "medium" | "low";
};

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * detectCapabilities — derive capabilities dari route patterns + entity graph.
 *
 * Berbeda dari featureDetector yang detect *library* yang dipakai (Stripe, Redis, dll),
 * capabilityDetector detect *perilaku* yang di-expose project via routes.
 *
 * Contoh:
 *   GET+POST+PUT+DELETE /snippets → crud capability pada entity "Snippet"
 *   POST /snippets/[id]/share     → sharing capability
 *   POST /workspaces/[id]/members → collaboration capability
 *
 * Input: RouteInfo[] + EntityGraph (untuk entity name mapping)
 * Output: CapabilityInfo[]
 */
export function detectCapabilities(
  routes: RouteInfo[],
  entityGraph: EntityGraph
): CapabilityInfo[] {
  if (routes.length === 0) return [];

  const capabilities: CapabilityInfo[] = [];
  const apiRoutes = routes.filter((r) => r.kind === "api");
  const pageRoutes = routes.filter((r) => r.kind === "page");

  // --- CRUD detection ---
  const crudCapabilities = detectCrudCapabilities(apiRoutes, entityGraph);
  capabilities.push(...crudCapabilities);

  // --- Behavioral capabilities dari route patterns ---
  // Only use API routes for behavioral detection — page routes produce too many
  // false positives because page paths often contain domain keywords that
  // don't represent actual capabilities (e.g. /search page = UI, not search infra)
  const behavioral = detectBehavioralCapabilities(apiRoutes, entityGraph);
  capabilities.push(...behavioral);

  return deduplicateCapabilities(capabilities);
}

// ---------------------------------------------------------------------------
// CRUD detection
// ---------------------------------------------------------------------------

function detectCrudCapabilities(
  apiRoutes: RouteInfo[],
  entityGraph: EntityGraph
): CapabilityInfo[] {
  const resourceMap = new Map<string, { methods: Set<string>; files: Set<string> }>();

  for (const route of apiRoutes) {
    const resource = extractResourceName(route.path);
    if (!resource) continue;

    const existing = resourceMap.get(resource) ?? {
      methods: new Set<string>(),
      files: new Set<string>()
    };

    for (const method of route.methods ?? []) {
      existing.methods.add(method);
    }
    existing.files.add(route.file);
    resourceMap.set(resource, existing);
  }

  const capabilities: CapabilityInfo[] = [];

  for (const [resource, { methods, files }] of resourceMap) {
    const hasRead = methods.has("GET");
    const hasWrite = methods.has("POST") || methods.has("PUT") || methods.has("PATCH");
    const hasDelete = methods.has("DELETE");

    if (!hasRead && !hasWrite) continue;

    const entityName = resolveEntityName(resource, entityGraph);
    const isFull = hasRead && hasWrite && hasDelete;

    capabilities.push({
      kind: "crud",
      name: `${entityName} Management`,
      entities: [entityName],
      evidence: [...files],
      confidence: isFull ? "high" : "medium"
    });
  }

  return capabilities;
}

// ---------------------------------------------------------------------------
// Behavioral capabilities
//
// Threshold design rationale:
//
//   highConfidenceAt = 1 was too aggressive — a single route match on a
//   generic path like /search or /stats was enough to create a "high"
//   confidence feature, even when that route was just a UI page.
//
//   New thresholds:
//   - Search: 2 — one /search page is a UI pattern, not a search infrastructure
//   - Reporting: 2 — one /stats or /dashboard page doesn't mean reporting infra
//   - Social: 3 — needs multiple social signals (likes AND comments, etc.)
//   - All others: 1 or 2 depending on signal specificity
//
//   Additionally: behavioral detection now only runs on API routes (not page
//   routes) to avoid UI pages being confused with backend capabilities.
// ---------------------------------------------------------------------------

const BEHAVIORAL_SIGNALS: Array<{
  kind: CapabilityKind;
  name: string;
  pathPatterns: RegExp[];
  /** Minimum number of matching API routes to reach "high" confidence */
  highConfidenceAt: number;
  /** Minimum matches to surface as a capability at all (default: 1) */
  minimumMatches?: number;
}> = [
  // Sharing — specific enough that 1 match is fine
  {
    kind: "sharing",
    name: "Content Sharing",
    pathPatterns: [/\/(share|shares|shareId|shared)(\/|$)/i],
    highConfidenceAt: 2,
    minimumMatches: 1,
  },
  // Publishing
  {
    kind: "publishing",
    name: "Content Publishing",
    pathPatterns: [/\/(publish|unpublish|draft|drafts)(\/|$)/i],
    highConfidenceAt: 1,
    minimumMatches: 1,
  },
  // Collaboration — workspace/member/invite are strong signals
  {
    kind: "collaboration",
    name: "Team Collaboration",
    pathPatterns: [
      /\/(workspace|workspaces)(\/|$)/i,
      /\/(member|members|membership)(\/|$)/i,
      /\/(invite|invites?|join)(\/|$)/i,
      /\/(team|teams)(\/|$)/i,
    ],
    highConfidenceAt: 2,
    minimumMatches: 1,
  },
  // Discovery
  {
    kind: "discovery",
    name: "Public Discovery",
    pathPatterns: [
      /\/(explore|discover|browse)(\/|$)/i,
      /\/(feed|trending|featured)(\/|$)/i,
    ],
    highConfidenceAt: 1,
    minimumMatches: 1,
  },
  // Social — needs multiple signals to avoid false positives
  // e.g. a single /comments route could be anything
  {
    kind: "social",
    name: "Social Interactions",
    pathPatterns: [
      /\/(like|likes|favorite|favorites)(\/|$)/i,
      /\/(reaction|reactions|upvote|downvote)(\/|$)/i,
      /\/(comment|comments|reply|replies)(\/|$)/i,
      /\/(follow|followers|following)(\/|$)/i,
    ],
    highConfidenceAt: 3,
    minimumMatches: 2,  // needs at least 2 distinct social routes to surface
  },
  // File management
  {
    kind: "file-management",
    name: "File Management",
    pathPatterns: [
      /\/(upload|uploads)(\/|$)/i,
      /\/(attachment|attachments)(\/|$)/i,
      /\/(media|asset|assets)(\/|$)/i,
    ],
    highConfidenceAt: 1,
    minimumMatches: 1,
  },
  // Real-time — transport-level signals only, very specific
  {
    kind: "real-time",
    name: "Real-time Features",
    pathPatterns: [
      /\/(ws|websocket|socket)(\/|$)/i,
      /\/(live|stream|streaming)(\/|$)/i,
      /\/(sse|server-sent)(\/|$)/i,
    ],
    highConfidenceAt: 1,
    minimumMatches: 1,
  },
  // Search — needs at least 2 API routes to surface
  // A single /api/search could be a simple filter, not search infrastructure
  {
    kind: "search",
    name: "Search",
    pathPatterns: [/\/(search|find|query|lookup)(\/|$)/i],
    highConfidenceAt: 2,
    minimumMatches: 2,  // must have at least 2 distinct search API routes
  },
  // Reporting — dashboard alone is not enough (many apps have a /dashboard page)
  {
    kind: "reporting",
    name: "Statistics & Reporting",
    pathPatterns: [
      /\/(stats?|analytics?|metric|metrics)(\/|$)/i,
      /\/(report|reports)(\/|$)/i,
    ],
    highConfidenceAt: 2,
    minimumMatches: 1,
  },
];

function detectBehavioralCapabilities(
  // Only API routes now — page routes removed to cut false positives
  apiRoutes: RouteInfo[],
  entityGraph: EntityGraph
): CapabilityInfo[] {
  const capabilities: CapabilityInfo[] = [];

  for (const signal of BEHAVIORAL_SIGNALS) {
    const matched = apiRoutes.filter((route) =>
      signal.pathPatterns.some((pattern) => pattern.test(route.path))
    );

    const minimum = signal.minimumMatches ?? 1;
    if (matched.length < minimum) continue;

    const entities = [...new Set(
      matched
        .map((r) => extractResourceName(r.path))
        .filter((r): r is string => r !== null)
        .map((r) => resolveEntityName(r, entityGraph))
    )];

    const threshold = signal.highConfidenceAt ?? 1;
    const confidence = matched.length >= threshold ? "high" : "medium";

    capabilities.push({
      kind: signal.kind,
      name: signal.name,
      entities,
      evidence: [...new Set(matched.map((r) => r.file))].slice(0, 5),
      confidence
    });
  }

  return capabilities;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractResourceName(path: string): string | null {
  const segments = path
    .split("/")
    .filter(Boolean)
    .filter((s) => !s.startsWith("["))
    .filter((s) => !["api", "v1", "v2", "v3"].includes(s.toLowerCase()));

  if (segments.length === 0) return null;

  const segment = segments[0].toLowerCase();

  if (segment.length <= 2) return null;
  if (NON_RESOURCE_SEGMENTS.has(segment)) return null;

  return segment;
}

function resolveEntityName(resource: string, entityGraph: EntityGraph): string {
  const lower = resource.toLowerCase();

  const direct = entityGraph.entityNames.find(
    (name) => name.toLowerCase() === lower
  );
  if (direct) return direct;

  const singular = singularize(lower);
  const singularMatch = entityGraph.entityNames.find(
    (name) => name.toLowerCase() === singular.toLowerCase()
  );
  if (singularMatch) return singularMatch;

  return singular.length === 0 ? singular : singular[0].toUpperCase() + singular.slice(1);
}

function singularize(word: string): string {
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (
    word.endsWith("sses") ||
    word.endsWith("xes") ||
    word.endsWith("ches") ||
    word.endsWith("ses")
  ) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function deduplicateCapabilities(capabilities: CapabilityInfo[]): CapabilityInfo[] {
  const seen = new Map<string, CapabilityInfo>();

  for (const cap of capabilities) {
    const existing = seen.get(cap.kind);
    if (!existing) {
      seen.set(cap.kind, cap);
      continue;
    }

    seen.set(cap.kind, {
      ...existing,
      entities: [...new Set([...existing.entities, ...cap.entities])],
      evidence: [...new Set([...existing.evidence, ...cap.evidence])].slice(0, 5),
      confidence: higherConfidence(existing.confidence, cap.confidence)
    });
  }

  return [...seen.values()];
}

function higherConfidence(
  a: CapabilityInfo["confidence"],
  b: CapabilityInfo["confidence"]
): CapabilityInfo["confidence"] {
  const rank = { high: 2, medium: 1, low: 0 };
  return rank[a] >= rank[b] ? a : b;
}

// NON_RESOURCE_SEGMENTS — path segments yang bukan nama resource.
const NON_RESOURCE_SEGMENTS = new Set([
  "auth", "oauth", "callback", "health",
  "ping", "status", "public", "internal",
  "static", "assets", "files", "me", "self",
  "history", "session", "sessions",
  // tambahan: common Next.js/UI page paths yang bukan API resource
  "dashboard", "settings", "profile", "search",
]);
