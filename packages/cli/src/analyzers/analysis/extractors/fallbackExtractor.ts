import { isDynamicSegment, isOperationalSegment, LARGE_API_ROUTE_COUNT } from "../../detectors/nonResourceSegments.js";
import type { RouteInfo } from "../../detectors/index.js";
import type { EntityInfo, IRouteFallbackExtractor } from "./types.js";

/** URL segments that are common but never entity names. */
const ROUTE_NON_ENTITY_SEGMENTS = new Set([
  "api", "v1", "v2", "v3",
  "public", "internal", "private",
  "auth", "oauth", "callback",
  "health", "ping", "status",
  "static", "assets", "files",
  "me", "self",
]);

/** Words whose singular cannot be derived from suffix rules. Key is the lowercase plural form. */
const IRREGULAR_SINGULAR = new Map([
  ["media", "media"],
  ["data", "data"],
  ["people", "person"],
  ["children", "child"],
  ["teeth", "tooth"],
  ["feet", "foot"],
  ["mice", "mouse"],
  ["geese", "goose"],
  // Plural-looking words that are already the singular name of a page or resource.
  ["settings", "settings"],
  ["analytics", "analytics"],
  ["metrics", "metrics"],
  ["statistics", "statistics"],
  ["news", "news"],
  ["series", "series"],
  ["species", "species"],
  ["status", "status"],
  ["analysis", "analysis"],
  ["bonus", "bonus"],
  ["campus", "campus"],
]);

const SINGULAR_ENDS_IN_S_PLURAL = /(?:status|bus|alias|campus|bonus|virus|canvas|bias|atlas)es$/;

/**
 * Derives entity names from API route segments when no schema source exists
 * (`/api/snippets` gives "Snippet"). Low confidence: names only, no fields or relations, but
 * capabilityDetector and domain inference still use them.
 */
export class RouteFallbackExtractor implements IRouteFallbackExtractor {
  readonly name = "route-fallback";

  extract(routes: RouteInfo[]): EntityInfo[] {
    const apiRoutes = routes.filter((r) => r.kind === "api");
    const found = new Map<string, { writes: boolean; files: Set<string> }>();

    for (const route of apiRoutes) {
      const segments = route.path.split("/").filter(Boolean);
      let prevWasDynamic = false;
      const writes = (route.methods ?? []).some((method) => method !== "GET" && method !== "HEAD" && method !== "QUERY");

      for (const segment of segments) {
        // Dynamic segments: [id], [slug], [...catchall], :id
        if (isDynamicSegment(segment)) {
          prevWasDynamic = true;
          continue;
        }
        // A segment right after a dynamic parameter is a sub-resource (`/api/workspaces/[id]/members`),
        // which is skipped so it does not become its own entity.
        if (prevWasDynamic) {
          prevWasDynamic = false;
          continue;
        }
        // Short segments such as "v1" and "id".
        if (segment.length <= 2) continue;
        if (ROUTE_NON_ENTITY_SEGMENTS.has(segment.toLowerCase())) continue;
        if (isOperationalSegment(segment)) continue;

        const name = resourceEntityName(segment);
        const entry = found.get(name) ?? { writes: false, files: new Set<string>() };
        entry.writes = entry.writes || writes || route.methods === undefined;
        entry.files.add(route.file);
        found.set(name, entry);
        prevWasDynamic = false;
      }
    }

    const large = apiRoutes.length >= LARGE_API_ROUTE_COUNT;
    return [...found]
      // In a large API a single read-only endpoint is plumbing, not an entity.
      .filter(([, { writes, files }]) => !large || writes || files.size >= 2)
      .map(([name]) => ({
        name,
        fields: [],
        relations: [],
        source: "route-hint" as const,
      }));
  }
}

/** `snippets` → "Snippet", `user-stats` → "UserStat". */
export function resourceEntityName(segment: string): string {
  const words = segment.split(/[-_]+/).filter(Boolean);
  if (words.length <= 1) return singularize(segment);
  words[words.length - 1] = singularize(words[words.length - 1]);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
}

/**
 * Singularizes a route segment and capitalizes it ("categories" gives "Category", "media" stays
 * "Media"). Covers common REST naming only, not English in general.
 */
export function singularize(word: string): string {
  const lower = word.toLowerCase();

  // Irregulars first: suffix rules would mangle them.
  if (IRREGULAR_SINGULAR.has(lower)) {
    return capitalize(IRREGULAR_SINGULAR.get(lower) ?? lower);
  }

  // A one or two letter word ("s", "us") is not a plural: stripping its "s" leaves nothing.
  if (lower.length <= 2) return capitalize(lower);

  // "statuses" → "status", "aliases" → "alias": the singular already ends in "s", so the plural takes "-es".
  if (SINGULAR_ENDS_IN_S_PLURAL.test(lower)) {
    return capitalize(lower.slice(0, -2));
  }

  // "categories" → "category", "replies" → "reply"
  if (lower.endsWith("ies")) {
    return capitalize(lower.slice(0, -3) + "y");
  }
  // "addresses", "churches", "boxes": the stem ends in a sound that takes "-es".
  if (lower.endsWith("sses") || lower.endsWith("xes") || lower.endsWith("ches") || lower.endsWith("shes")) {
    return capitalize(lower.slice(0, -2));
  }
  // "verses", "houses", "responses": the singular ends in a silent "e" and the plural adds only "s".
  if (lower.endsWith("ses")) {
    return capitalize(lower.slice(0, -1));
  }
  // Plain trailing "s"; "ss" words ("class") are left alone.
  if (lower.endsWith("s") && !lower.endsWith("ss")) {
    return capitalize(lower.slice(0, -1));
  }

  return capitalize(lower);
}

function capitalize(str: string): string {
  return str.length === 0 ? str : str[0].toUpperCase() + str.slice(1);
}
