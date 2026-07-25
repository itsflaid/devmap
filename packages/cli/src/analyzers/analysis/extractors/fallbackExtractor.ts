import type { RouteInfo } from "../../detectors/index.js";
import type { EntityInfo, IRouteFallbackExtractor } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Segments yang sering muncul di URL tapi bukan entity name.
 * Difilter biar gak muncul sebagai entity hint.
 */
const ROUTE_NON_ENTITY_SEGMENTS = new Set([
  "api", "v1", "v2", "v3",
  "public", "internal", "private",
  "auth", "oauth", "callback",
  "health", "ping", "status",
  "static", "assets", "files",
  "me", "self",
]);

/**
 * Kata irregular yang singularization-nya tidak bisa di-derive dari suffix rules.
 * Key = lowercase plural, value = singular yang benar.
 */
const IRREGULAR_SINGULAR = new Map([
  ["media", "media"],
  ["data", "data"],
  ["people", "person"],
  ["children", "child"],
  ["teeth", "tooth"],
  ["feet", "foot"],
  ["mice", "mouse"],
  ["geese", "goose"],
]);

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

/**
 * RouteFallbackExtractor — derive entity names dari URL segments sebagai
 * best-effort fallback kalau tidak ada schema source yang ditemukan.
 *
 * Confidence: low — hanya dapat names, zero field/relation data.
 * Tapi tetap berguna buat capabilityDetector dan domain inference.
 *
 * Contoh:
 *   /api/snippets        → "Snippet"
 *   /api/workspaces/[id] → "Workspace"
 *   /api/collections     → "Collection"
 */
export class RouteFallbackExtractor implements IRouteFallbackExtractor {
  readonly name = "route-fallback";

  extract(routes: RouteInfo[]): EntityInfo[] {
    const entityNames = new Set<string>();

    for (const route of routes.filter((r) => r.kind === "api")) {
      const segments = route.path.split("/").filter(Boolean);

      for (const segment of segments) {
        // Skip dynamic segments: [id], [slug], [...catchall]
        if (segment.startsWith("[")) continue;
        // Skip short segments: "v1", "id", dll
        if (segment.length <= 2) continue;
        // Skip common non-entity prefixes
        if (ROUTE_NON_ENTITY_SEGMENTS.has(segment.toLowerCase())) continue;

        entityNames.add(singularize(segment));
      }
    }

    return [...entityNames].map((name) => ({
      name,
      fields: [],
      relations: [],
      source: "route-hint" as const,
    }));
  }
}

// ---------------------------------------------------------------------------
// Singularization
// ---------------------------------------------------------------------------

/**
 * singularize — simple English singularization untuk route segments.
 * Cukup buat common REST conventions, bukan full NLP.
 *
 * "snippets"   → "Snippet"
 * "categories" → "Category"
 * "replies"    → "Reply"
 * "workspaces" → "Workspace"
 * "media"      → "Media"  (irregular, tidak diubah)
 */
export function singularize(word: string): string {
  const lower = word.toLowerCase();

  // Irregular — cek duluan sebelum suffix rules
  if (IRREGULAR_SINGULAR.has(lower)) {
    return capitalize(IRREGULAR_SINGULAR.get(lower) ?? lower);
  }

  // "categories" → "category", "replies" → "reply"
  if (lower.endsWith("ies")) {
    return capitalize(lower.slice(0, -3) + "y");
  }
  // "addresses" → "address", "churches" → "church", "boxes" → "box"
  // (stem itself ends in a hard consonant cluster that takes "-es")
  if (lower.endsWith("sses") || lower.endsWith("xes") || lower.endsWith("ches") || lower.endsWith("shes")) {
    return capitalize(lower.slice(0, -2));
  }
  // "verses" → "verse", "houses" → "house", "cases" → "case", "responses" → "response"
  // (singular already ends in a silent "e" before the "s" — plural just adds "s", not "es")
  if (lower.endsWith("ses")) {
    return capitalize(lower.slice(0, -1));
  }
  // "workspaces", "snippets", "collections" — trailing -s yang umum
  if (lower.endsWith("s") && !lower.endsWith("ss")) {
    return capitalize(lower.slice(0, -1));
  }

  return capitalize(lower);
}

function capitalize(str: string): string {
  return str.length === 0 ? str : str[0].toUpperCase() + str.slice(1);
}
