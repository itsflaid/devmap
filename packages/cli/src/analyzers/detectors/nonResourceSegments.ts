/**
 * URL segments that name an operation, a file served at a fixed URL or a piece of
 * plumbing rather than a product resource. "/api/healthcheck", "/robots.txt" and
 * "/login" are endpoints; "Healthcheck Management" is not a feature.
 */
export const OPERATIONAL_SEGMENTS: ReadonlySet<string> = new Set([
  // health and diagnostics
  "health", "healthcheck", "healthz", "health-check", "ping", "status", "ready", "readyz",
  "livez", "live", "metrics", "version",
  // build and cache plumbing
  "revalidate", "webhook", "webhooks", "cron", "csrf", "trpc", "graphql", "preview", "draft",
  // generated images and metadata files
  "og", "opengraph-image", "twitter-image", "icon", "sitemap", "robots", "manifest",
  // verbs of the auth flow
  "login", "logout", "signin", "signout", "signup", "register", "verify", "refresh",
]);

/** A file served at a fixed URL (robots.txt, sitemap.xml, favicon.ico) is never a resource. */
export function isOperationalSegment(segment: string): boolean {
  const lower = segment.toLowerCase();
  return lower.includes(".") || OPERATIONAL_SEGMENTS.has(lower);
}
