import type { RouteInfo } from "./routeDetector.js";
import type { EntityGraph } from "./extractors/types.js";

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
  // Group routes by resource (base path segment) lalu cek method coverage
  const crudCapabilities = detectCrudCapabilities(apiRoutes, entityGraph);
  capabilities.push(...crudCapabilities);

  // --- Behavioral capabilities dari route patterns ---
  const behavioral = detectBehavioralCapabilities(apiRoutes, pageRoutes, entityGraph);
  capabilities.push(...behavioral);

  // Deduplicate kalau ada overlap
  return deduplicateCapabilities(capabilities);
}

// ---------------------------------------------------------------------------
// CRUD detection
// ---------------------------------------------------------------------------

/**
 * detectCrudCapabilities — group API routes by resource, cek HTTP method coverage.
 *
 * Logic:
 *   /api/snippets         GET POST      → resource "snippet", partial CRUD
 *   /api/snippets/[id]    GET PUT DELETE → resource "snippet", full CRUD
 *
 *   Gabungkan methods dari semua routes ke resource yang sama.
 *   GET + (POST atau PUT) + DELETE = full CRUD → confidence "high"
 *   Hanya GET = read-only → confidence "medium"
 *   Hanya POST = write-only → confidence "medium"
 */
function detectCrudCapabilities(
  apiRoutes: RouteInfo[],
  entityGraph: EntityGraph
): CapabilityInfo[] {
  // Map: resourceName → { methods: Set, files: Set }
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

    // Perlu minimal read+write atau write+delete buat dianggap CRUD meaningful
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
// ---------------------------------------------------------------------------

/**
 * BEHAVIORAL_SIGNALS — map route patterns ke capability kinds.
 *
 * Ordered dari paling spesifik ke paling general.
 * Tiap signal: patterns di-test terhadap route.path, bukan file path.
 */
const BEHAVIORAL_SIGNALS: Array<{
  kind: CapabilityKind;
  name: string;
  // Test terhadap route path (/api/snippets/[id]/share)
  pathPatterns: RegExp[];
  // Minimum routes yang match buat confidence "high" (default 1 = "medium")
  highConfidenceAt?: number;
}> = [
  // Sharing
  {
    kind: "sharing",
    name: "Content Sharing",
    pathPatterns: [/\/(share|shares|shareId|shared)(\/|$)/i],
    highConfidenceAt: 2
  },
  // Publishing
  {
    kind: "publishing",
    name: "Content Publishing",
    pathPatterns: [/\/(publish|unpublish|draft|drafts)(\/|$)/i],
    highConfidenceAt: 1
  },
  // Collaboration — workspace + members
  {
    kind: "collaboration",
    name: "Team Collaboration",
    pathPatterns: [
      /\/(workspace|workspaces)(\/|$)/i,
      /\/(member|members|membership)(\/|$)/i,
      /\/(invite|invites?|join)(\/|$)/i,
      /\/(team|teams)(\/|$)/i,
    ],
    highConfidenceAt: 2
  },
  // Discovery
  {
    kind: "discovery",
    name: "Public Discovery",
    pathPatterns: [
      /\/(explore|discover|browse)(\/|$)/i,
      /\/(feed|trending|featured)(\/|$)/i,
    ],
    highConfidenceAt: 1
  },
  // Social
  {
    kind: "social",
    name: "Social Interactions",
    pathPatterns: [
      /\/(like|likes|favorite|favorites)(\/|$)/i,
      /\/(reaction|reactions|upvote|downvote)(\/|$)/i,
      /\/(comment|comments|reply|replies)(\/|$)/i,
      /\/(follow|followers|following)(\/|$)/i,
    ],
    highConfidenceAt: 2
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
    highConfidenceAt: 1
  },
  // Real-time
  {
    kind: "real-time",
    name: "Real-time Features",
    pathPatterns: [
      /\/(ws|websocket|socket)(\/|$)/i,
      /\/(live|stream|streaming)(\/|$)/i,
      /\/(event|events|subscribe)(\/|$)/i,
    ],
    highConfidenceAt: 1
  },
  // Search
  {
    kind: "search",
    name: "Search",
    pathPatterns: [/\/(search|find|query|lookup)(\/|$)/i],
    highConfidenceAt: 1
  },
  // Reporting
  {
    kind: "reporting",
    name: "Statistics & Reporting",
    pathPatterns: [
      /\/(stats?|analytics?|metric|metrics)(\/|$)/i,
      /\/(report|reports)(\/|$)/i,
      /\/(dashboard)(\/|$)/i,
    ],
    highConfidenceAt: 1
  },
];

function detectBehavioralCapabilities(
  apiRoutes: RouteInfo[],
  pageRoutes: RouteInfo[],
  entityGraph: EntityGraph
): CapabilityInfo[] {
  const allRoutes = [...apiRoutes, ...pageRoutes];
  const capabilities: CapabilityInfo[] = [];

  for (const signal of BEHAVIORAL_SIGNALS) {
    const matched = allRoutes.filter((route) =>
      signal.pathPatterns.some((pattern) => pattern.test(route.path))
    );

    if (matched.length === 0) continue;

    // Extract entity names dari matched route paths
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

/**
 * extractResourceName — extract resource name dari route path.
 *
 * /api/snippets             → "snippet"
 * /api/snippets/[id]        → "snippet"
 * /api/snippets/[id]/share  → "snippet"
 * /api/workspaces/[id]/members → "workspace"
 *
 * Ambil segment non-dynamic pertama setelah "api" prefix.
 */
function extractResourceName(path: string): string | null {
  const segments = path
    .split("/")
    .filter(Boolean)
    .filter((s) => !s.startsWith("["))
    .filter((s) => !["api", "v1", "v2", "v3"].includes(s.toLowerCase()));

  if (segments.length === 0) return null;

  const segment = segments[0].toLowerCase();

  // Skip terlalu pendek atau common non-resource segments
  if (segment.length <= 2) return null;
  if (NON_RESOURCE_SEGMENTS.has(segment)) return null;

  return segment;
}

/**
 * resolveEntityName — coba match resource name ke entity yang dikenal.
 *
 * "snippet" → cek entityGraph → ada "Snippet"? → return "Snippet"
 * "snippets" → singularize → "Snippet" → ada di graph? → return "Snippet"
 * "unknown-resource" → capitalize fallback → "Unknown-resource"
 */
function resolveEntityName(resource: string, entityGraph: EntityGraph): string {
  const lower = resource.toLowerCase();

  // Direct match (case-insensitive)
  const direct = entityGraph.entityNames.find(
    (name) => name.toLowerCase() === lower
  );
  if (direct) return direct;

  // Singularized match
  const singular = singularize(lower);
  const singularMatch = entityGraph.entityNames.find(
    (name) => name.toLowerCase() === singular.toLowerCase()
  );
  if (singularMatch) return singularMatch;

  // Fallback: capitalize
  return singular;
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

function capitalize(str: string): string {
  return str.length === 0 ? str : str[0].toUpperCase() + str.slice(1);
}

function deduplicateCapabilities(capabilities: CapabilityInfo[]): CapabilityInfo[] {
  const seen = new Map<string, CapabilityInfo>();

  for (const cap of capabilities) {
    const existing = seen.get(cap.kind);
    if (!existing) {
      seen.set(cap.kind, cap);
      continue;
    }

    // Merge — gabungkan entities + evidence, ambil confidence tertinggi
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

const NON_RESOURCE_SEGMENTS = new Set([
  "auth", "oauth", "callback", "health",
  "ping", "status", "public", "internal",
  "static", "assets", "files", "me", "self",
]);
