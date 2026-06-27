import type { FileAnalysis } from "./fileAnalysis.js";
import type { DatabaseInfo } from "./databaseDetector.js";
import type { ScannedFile } from "./fileScanner.js";
import type { RouteInfo } from "./routeDetector.js";
import type { EntityGraph, RelationInfo } from "./extractors/types.js";
import type { CapabilityInfo } from "./capabilityDetector.js";
import { classifyFileRole, isTechnicalFeatureSource, isDocumentationMeta, type FileRole } from "./fileRole.js";
import { isArchitectureSource } from "./sourceScope.js";

export type FeatureInfo = {
  name: string;
  purpose: string;
  files: string[];
  entryPoint?: string;
  entryPoints: string[];
  businessFlow: string[];
  searchTerms: string[];
  confidence: "high" | "medium" | "low";
  evidence: string[];
};

export type AuthSemanticRole = "auth-config" | "guard" | "provider" | "consumer";

const FEATURE_SIGNALS: Array<{
  name: string;
  terms: string[];
  purpose: string;
}> = [
  {
    name: "Authentication",
    terms: [
      "next-auth", "auth0", "clerk", "lucia", "better-auth", "passport",
      "firebase/auth", "@supabase/auth", "kinde",
      "auth", "login", "session", "jwt", "oauth", "openid",
    ],
    purpose: "Handles authentication, identity, sessions, login, and access control."
  },
  {
    name: "Payments",
    terms: [
      "stripe", "midtrans", "xendit", "@xendit", "paypal", "braintree",
      "razorpay", "paddle", "lemonsqueezy", "lemon-squeezy",
      "payment", "checkout", "billing", "subscription", "invoice",
    ],
    purpose: "Handles payment providers, billing, and transaction workflows."
  },
  {
    name: "File Upload",
    terms: [
      "multer", "formidable", "busboy", "cloudinary", "uploadthing",
      "aws-sdk/s3", "@aws-sdk/client-s3", "minio", "backblaze",
      "firebase/storage", "@supabase/storage",
      "upload", "storage", "bucket", "blob",
    ],
    purpose: "Handles file ingestion, cloud storage, and upload providers."
  },
  {
    name: "Email",
    terms: [
      "resend", "nodemailer", "@sendgrid/mail", "sendgrid", "mailgun",
      "postmark", "@postmark", "aws-sdk/ses", "@aws-sdk/client-ses",
      "react-email", "@react-email",
      "email", "mailer", "smtp",
    ],
    purpose: "Handles transactional email delivery and templates."
  },
  {
    name: "AI Integration",
    terms: [
      // Provider SDKs only — no generic terms like "ai", "llm", "embedding"
      // Path matching is disabled for AI; detection is import-only (see matchesSignal)
      "openai", "groq", "openrouter", "@anthropic-ai/sdk", "anthropic",
      "google-generative-ai", "@google/generative-ai", "@google/genai", "cohere",
      "mistralai", "together", "replicate", "huggingface",
      "langchain", "@langchain", "llamaindex", "@vercel/ai", "ai/react",
    ],
    purpose: "Handles AI providers, LLM calls, prompts, and model context."
  },
  {
    name: "Notifications",
    terms: [
      "web-push", "pusher", "ably", "soketi", "firebase-messaging",
      "@firebase/messaging", "onesignal", "novu", "@novu",
      "notification", "push", "realtime", "websocket",
    ],
    purpose: "Handles push notifications, real-time events, and user alerts."
  },
  {
    name: "Caching",
    terms: [
      "ioredis", "redis", "@upstash/redis", "upstash", "keyv",
      "lru-cache", "node-cache", "memcached",
      "cache", "ttl", "invalidate",
    ],
    purpose: "Handles in-memory and distributed caching strategies."
  },
  {
    name: "Search",
    terms: [
      "meilisearch", "typesense", "algolia", "@algolia",
      "elasticsearch", "@elastic/elasticsearch",
      "orama", "@orama",
      "search", "fulltext", "index", "facet",
    ],
    purpose: "Handles full-text search, indexing, and faceted filtering."
  },
  {
    name: "Background Jobs",
    terms: [
      "bullmq", "bull", "bee-queue", "agenda", "node-cron",
      "inngest", "@inngest", "trigger.dev", "@trigger.dev",
      "quirrel",
      "queue", "worker", "job", "cron", "scheduler",
    ],
    purpose: "Handles background processing, job queues, and scheduled tasks."
  },
  {
    name: "Logging & Monitoring",
    terms: [
      "pino", "winston", "bunyan", "morgan",
      "@sentry/node", "@sentry/nextjs", "sentry",
      "datadog", "dd-trace", "opentelemetry", "@opentelemetry",
      "posthog", "@posthog",
      "logger", "telemetry", "tracing",
    ],
    purpose: "Handles application logging, error tracking, and observability."
  },
  {
    name: "Testing",
    terms: [
      "vitest", "jest", "@testing-library", "playwright",
      "cypress", "supertest", "msw",
      "test", "spec", "mock", "fixture",
    ],
    purpose: "Contains test suites, mocks, and testing infrastructure."
  },
  {
    name: "Internationalization",
    terms: [
      "next-intl", "next-i18next", "i18next", "react-i18next",
      "lingui", "@lingui", "formatjs", "react-intl",
      "i18n", "l10n", "locale", "translation",
    ],
    purpose: "Handles multi-language support, locale routing, and translations."
  },
  {
    name: "Analytics",
    terms: [
      "posthog", "mixpanel", "@mixpanel", "amplitude",
      "google-analytics", "gtag", "plausible",
      "segment", "@segment",
      "analytics", "tracking", "event",
    ],
    purpose: "Handles user analytics, event tracking, and product metrics."
  },
  {
    name: "Rate Limiting",
    terms: [
      "@upstash/ratelimit", "express-rate-limit",
      "rate-limiter-flexible", "bottleneck",
      "ratelimit", "rate-limit", "throttle",
    ],
    purpose: "Handles API rate limiting and request throttling."
  },
  {
    name: "CMS & Content",
    terms: [
      "contentlayer", "@contentlayer", "sanity", "@sanity",
      "contentful", "strapi", "payload", "keystatic",
      "notion", "@notionhq",
      "cms", "content", "mdx",
    ],
    purpose: "Handles CMS integrations and structured content management."
  },
];

// ---------------------------------------------------------------------------
// ROLE_FEATURES — only user-visible features, not architectural layers.
//
// Excluded intentionally:
//   "api-handler", "service", "middleware", "repository", "ui-component"
//   → architectural implementation concerns, not domain features
//   "ai-integration"
//   → detected via FEATURE_SIGNALS (import-based), role-based too noisy
//   "documentation"
//   → re-added with strict meta-file filtering via isDocumentationEvidence()
// ---------------------------------------------------------------------------
const ROLE_FEATURES: Array<{
  role: FileRole;
  name: string;
  purpose: string;
  terms: string[];
}> = [
  {
    role: "documentation",
    name: "Documentation",
    purpose: "Contains project documentation, API references, and developer guides.",
    terms: ["documentation", "docs", "guide", "reference", "api", "wiki"]
  },
  {
    role: "landing-ui",
    name: "Web Landing",
    purpose: "Contains public-facing landing page and marketing UI components.",
    terms: ["web", "landing", "marketing", "hero", "ui", "homepage"]
  },
  {
    role: "cli-command",
    name: "CLI Commands",
    purpose: "Contains CLI entry points and command handlers.",
    terms: ["cli", "command", "bin", "argv", "commander", "yargs"]
  },
];

// ---------------------------------------------------------------------------
// Infrastructure entity names — auth provider internals and ORM bookkeeping
// entities that should never appear as standalone domain features.
//
// These are excluded from entityGraphToFeatures regardless of their relations.
//
// Rule: an entity is infrastructure if it exists solely to support an
// external system (auth provider, ORM, payment processor) and has no
// business logic of its own visible to the application domain.
//
// "Account" is excluded here because in NextAuth / Lucia schemas it
// represents an OAuth provider link record, not a user-facing account.
// Projects that genuinely use "Account" as a domain entity (e.g. billing
// accounts, bank accounts) will still detect it via FEATURE_SIGNALS or
// capabilitiesToFeatures — so excluding it here is safe.
// ---------------------------------------------------------------------------
const INFRASTRUCTURE_ENTITY_NAMES = new Set([
  // NextAuth / Lucia / Better-Auth internals
  "Account",
  "Session",
  "VerificationToken",
  "VerificationCode",
  "Authenticator",

  // Generic auth infrastructure
  "PasswordResetToken",
  "RefreshToken",
  "OAuthToken",
  "OAuthAccount",

  // Audit / system tables
  "AuditLog",
  "ActivityLog",
  "EventLog",
]);

// ---------------------------------------------------------------------------
// Documentation evidence filter
// ---------------------------------------------------------------------------

function isDocumentationEvidence(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  const filename = normalized.split("/").at(-1) ?? normalized;

  if (/(^|\/)\.github(\/|$)/.test(normalized)) return false;
  if (isDocumentationMeta(filename)) return false;

  return (
    /(^|\/)docs?(\/|$)/.test(normalized)
    || /(^|\/)wiki(\/|$)/.test(normalized)
    || filename === "readme.md"
    || /\.(guide|tutorial|reference)\.(md|mdx)$/.test(filename)
    || /(openapi|swagger)\.(json|yaml|yml)$/.test(filename)
  );
}

// ---------------------------------------------------------------------------
// Feature evidence file filter
//
// Excludes files that are generated artifacts or migration history —
// these contain domain keywords (table/column names) that cause false
// positive feature detection without representing actual implementation.
// ---------------------------------------------------------------------------
function isFeatureEvidenceFile(path: string): boolean {
  const lower = path.toLowerCase();

  return !(
    /\/prisma\/migrations\//.test(lower)
    || /\/migrations\//.test(lower)
    || /\.sql$/.test(lower)
    || /\/generated\//.test(lower)
    || /\.generated\./.test(lower)
    || /\/prisma\/schema\.prisma$/.test(lower)
    || /^prisma\/schema\.prisma$/.test(lower)
  );
}

// ---------------------------------------------------------------------------
// FEATURE_FILE_PRIORITIES
// ---------------------------------------------------------------------------
const FEATURE_FILE_PRIORITIES: Record<string, RegExp[]> = {
  Documentation: [
    /(^|\/)readme\.md$/,
    /(^|\/)contributing\.md$/,
    /(^|\/)changelog\.md$/,
    /(^|\/)license(\.md)?$/,
    /(^|\/)docs\/index\.md$/,
    /(^|\/)docs\//,
  ],
  Authentication: [
    /(^|\/)src\/auth\.[cm]?[jt]sx?$/,
    /(^|\/)auth\.[cm]?[jt]sx?$/,
    /\/auth\/config\.[cm]?[jt]sx?$/,
    /(^|\/)middleware\.[cm]?[jt]sx?$/,
    /\/auth\/middleware\.[cm]?[jt]sx?$/,
    /\/api\/auth\//,
    /\/api\/.*\/(login|register|logout)\.[cm]?[jt]sx?$/,
    /\/providers?\/auth[^/]*\.[cm]?[jt]sx?$/,
    /\/context\/auth[^/]*\.[cm]?[jt]sx?$/,
  ],
  Payments: [
    /\/lib\/stripe\.[cm]?[jt]sx?$/,
    /\/lib\/payment[^/]*\.[cm]?[jt]sx?$/,
    /\/api\/.*webhook[^/]*\.[cm]?[jt]sx?$/,
    /\/api\/.*checkout[^/]*\.[cm]?[jt]sx?$/,
    /\/api\/.*payment[^/]*\.[cm]?[jt]sx?$/,
  ],
  "AI Integration": [
    /\/lib\/ai\.[cm]?[jt]sx?$/,
    /\/ai\/provider\.[cm]?[jt]sx?$/,
    /\/ai\/client\.[cm]?[jt]sx?$/,
    /\/lib\/openai\.[cm]?[jt]sx?$/,
    /\/lib\/groq\.[cm]?[jt]sx?$/,
    /\/ai\/prompts?\.[cm]?[jt]sx?$/,
    /\/ai\/completion\.[cm]?[jt]sx?$/,
  ],
  Email: [
    /\/lib\/email[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/mailer[^/]*\.[cm]?[jt]sx?$/,
    /\/emails?\//,
    /\/templates?\//,
  ],
  "File Upload": [
    /\/lib\/upload[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/storage[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/cloudinary[^/]*\.[cm]?[jt]sx?$/,
    /\/api\/.*upload[^/]*\.[cm]?[jt]sx?$/,
  ],
  "Background Jobs": [
    /\/lib\/queue[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/worker[^/]*\.[cm]?[jt]sx?$/,
    /\/workers?\//,
    /\/jobs?\//,
    /\/queues?\//,
  ],
  Caching: [
    /\/lib\/redis\.[cm]?[jt]sx?$/,
    /\/lib\/cache[^/]*\.[cm]?[jt]sx?$/,
    /\/cache\//,
  ],
  "CLI Commands": [
    /\/src\/index\.[cm]?[jt]sx?$/,
    /\/bin\//,
    /\/commands?\/index\.[cm]?[jt]sx?$/,
    /\/commands?\//,
  ],
  "Web Landing": [
    /\/pages\/index\.(astro|tsx?|jsx?)$/,
    /\/app\/page\.(tsx?|jsx?)$/,
    /\/landing\//,
    /(hero|pricing|features?section)[^/]*\.(astro|tsx?|jsx?|vue|svelte)$/,
  ],
  Testing: [
    /\/(vitest|jest)\.config\.[cm]?[jt]sx?$/,
    /\/test-utils?\.[cm]?[jt]sx?$/,
    /\/setup\.(test|spec)\.[cm]?[jt]sx?$/,
  ],
  Search: [
    /\/lib\/search[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/meilisearch[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/algolia[^/]*\.[cm]?[jt]sx?$/,
  ],
  "Logging & Monitoring": [
    /\/lib\/logger[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/sentry[^/]*\.[cm]?[jt]sx?$/,
    /\/instrumentation\.[cm]?[jt]sx?$/,
    /\/sentry\.(client|server|edge)\.[cm]?[jt]sx?$/,
  ],
};

// ---------------------------------------------------------------------------
// Entry point scoring
//
// Lower score = better entry point candidate.
// Generic utility/helper files score >= ENTRY_POINT_EXCLUDE_THRESHOLD (excluded).
// ---------------------------------------------------------------------------
const ENTRY_POINT_EXCLUDE_THRESHOLD = 90;

function scoreEntryPointRelevance(file: string, _context: string): number {
  const lower = file.toLowerCase();

  if (/\/(utils?|helpers?|constants?|types?|shared)\.[cm]?[jt]sx?$/.test(lower)) return 100;
  if (/\/(index)\.[cm]?[jt]sx?$/.test(lower) && !/\/(api|routes?|commands?)\//.test(lower)) return 95;
  if (/\.(d\.ts)$/.test(lower)) return 100;

  if (/\/(route|handler)\.[cm]?[jt]sx?$/.test(lower)) return 5;
  if (/\/api\//.test(lower)) return 10;

  if (/\.(service|usecase|action)\.[cm]?[jt]sx?$/.test(lower)) return 20;
  if (/\/services?\//.test(lower)) return 25;

  if (/\/(commands?|bin)\//.test(lower)) return 15;

  if (/\/(pages?|app)\/.+\/(page|layout)\.[cm]?[jt]sx?$/.test(lower)) return 30;
  if (/\/components?\//.test(lower)) return 50;

  if (/\/lib\//.test(lower)) return 60;

  return 70;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function detectFeatures(
  files: ScannedFile[],
  analyses: Record<string, FileAnalysis>,
  routes: RouteInfo[],
  database?: DatabaseInfo,
  entityGraph?: EntityGraph,
  capabilities?: CapabilityInfo[]
): FeatureInfo[] {
  const features: FeatureInfo[] = [];
  const scopedFiles = files.filter((file) => isArchitectureSource(file.path));

  // --- ROLE_FEATURES ---
  for (const definition of ROLE_FEATURES) {
    const evidence = scopedFiles
      .filter((file) =>
        classifyFileRole(file.path) === definition.role
        || (definition.name === "CLI Commands"
          && /(^|\/)src\/index\.[cm]?[jt]s$/.test(file.path.toLowerCase()))
      )
      .filter((file) => isFeatureEvidenceFile(file.path))
      .filter((file) =>
        definition.role !== "documentation" || isDocumentationEvidence(file.path)
      )
      .map((file) => file.path)
      .sort((left, right) =>
        featureFilePriority(definition.name, left) - featureFilePriority(definition.name, right)
        || left.localeCompare(right)
      )
      .slice(0, 12);

    if (evidence.length > 0) {
      features.push(createFeatureInfo(
        definition.name,
        evidence,
        definition.terms,
        definition.purpose,
        analyses
      ));
    }
  }

  // --- FEATURE_SIGNALS ---
  // Pre-filter once here — avoids redundant isFeatureEvidenceFile calls inside each signal loop
  const technicalFiles = scopedFiles
    .filter((file) => isTechnicalFeatureSource(file.path))
    .filter((file) => isFeatureEvidenceFile(file.path));

  for (const signal of FEATURE_SIGNALS) {
    const evidence = technicalFiles
      .filter((file) => matchesSignal(file, analyses[file.path], signal.terms, signal.name))
      .map((file) => file.path)
      .sort((left, right) =>
        featureFilePriority(signal.name, left) - featureFilePriority(signal.name, right)
        || left.localeCompare(right)
      )
      .slice(0, 5);

    if (evidence.length > 0) {
      mergeFeature(features, createFeatureInfo(
        signal.name,
        evidence,
        signal.terms,
        signal.purpose,
        analyses
      ));
    }
  }

  // Database and API Routes are architectural concerns, not domain features.
  // Database info lives in snapshot.database, routes in snapshot.routes.

  if (capabilities && capabilities.length > 0) {
    for (const feature of capabilitiesToFeatures(capabilities)) {
      if (feature !== null) mergeFeature(features, feature);
    }
  }

  if (entityGraph && entityGraph.entityNames.length > 0) {
    for (const feature of entityGraphToFeatures(entityGraph)) {
      mergeFeature(features, feature);
    }
  }

  return enrichAuthenticationFeature(features, scopedFiles, analyses)
    .sort((left, right) => left.name.localeCompare(right.name));
}

// ---------------------------------------------------------------------------
// capabilitiesToFeatures
//
// Capabilities with no resolvable entry points are dropped — they represent
// route patterns detected without backing implementation files, which
// produces low-quality features (empty criticalFiles, misleading names).
//
// Example: ChatMe's "Message Exchange" capability has entryPoints: [] because
// Message is the core data model (notes), not a messaging feature. Dropping
// it avoids surfacing a misleading feature with zero file evidence.
// ---------------------------------------------------------------------------
function capabilitiesToFeatures(capabilities: CapabilityInfo[]): Array<FeatureInfo | null> {
  return capabilities.map((cap) => {
    const terms = [cap.kind, ...cap.entities.map((e) => e.toLowerCase())];

    const scoredEvidence = cap.evidence
      .map((file) => ({ file, score: scoreEntryPointRelevance(file, cap.kind) }))
      .sort((a, b) => a.score - b.score);

    const entryPoints = scoredEvidence
      .filter((e) => e.score < ENTRY_POINT_EXCLUDE_THRESHOLD)
      .slice(0, 2)
      .map((e) => e.file);

    // Drop capabilities with no resolvable entry points and non-high confidence.
    // These are weak detections: route pattern matched but no backing file found.
    if (entryPoints.length === 0 && cap.confidence !== "high") return null;

    return {
      name: cap.name,
      purpose: purposeFromCapability(cap),
      files: cap.evidence,
      entryPoints,
      businessFlow: [],
      searchTerms: [...new Set(terms)].slice(0, 8),
      confidence: cap.confidence,
      evidence: cap.evidence
    };
  });
}

function purposeFromCapability(cap: CapabilityInfo): string {
  const entityList = cap.entities.length > 0 ? cap.entities.join(", ") : "resources";
  switch (cap.kind) {
    case "crud":            return `Handles create, read, update, and delete operations for ${entityList}.`;
    case "sharing":         return `Handles content sharing via public links and share tokens.`;
    case "collaboration":   return `Handles team collaboration, workspaces, and member management.`;
    case "discovery":       return `Handles public content discovery and browsing.`;
    case "publishing":      return `Handles content publishing and visibility management.`;
    case "social":          return `Handles social interactions like likes, favorites, and reactions.`;
    case "file-management": return `Handles file uploads, storage, and media management.`;
    case "real-time":       return `Handles real-time events, websockets, and live updates.`;
    case "search":          return `Handles full-text search and content filtering.`;
    case "reporting":       return `Handles usage statistics, analytics, and reporting.`;
    default:                return `Handles ${cap.kind} operations for ${entityList}.`;
  }
}

// ---------------------------------------------------------------------------
// entityGraphToFeatures
//
// Entity ownership model:
//
//   TRUE CHILD — entity with a single parent via one-to-many AND no own
//                children (leaf node), OR has a child-like name suffix.
//                Skipped as standalone feature; mentioned in parent's purpose.
//                Example: ChecklistItem (owned by Message, no children, suffix "Item")
//
//   STANDALONE — entity with multiple parents, or entity that itself owns
//                other entities (intermediate node). Gets its own feature.
//                Example: Room (owned by User, but owns Message[])
//                Example: Message (owned by User+Room, but owns ChecklistItem[])
//
//   OWNED      — non-infra, non-true-child entities this entity owns via
//                one-to-many. Shown in purpose string.
//
//   PEER       — many-to-many associations. Shown as "associates with X".
//
//   REFERENCED-BY — other entities holding FK to this entity.
//                NOT included in purpose — belongs to the referencing entity.
//
// Infrastructure entities (auth provider internals, ORM bookkeeping) are
// excluded entirely via INFRASTRUCTURE_ENTITY_NAMES.
// ---------------------------------------------------------------------------

// Suffixes that semantically indicate a sub-item of a parent entity.
// Used as a tiebreaker when an entity has a single parent and no children.
const TRUE_CHILD_SUFFIXES = /(?:Item|Entry|Detail|Line|Row|Part|Step|Variant|Option)$/;

/**
 * isTrueChildEntity — determines if an entity should be skipped as standalone.
 *
 * An entity is a true child if ALL of:
 *   1. Exactly ONE parent owns it via one-to-many (single exclusive owner)
 *   2. It has NO outgoing one-to-many of its own (leaf node)
 *      OR its name has a child-like suffix (Item, Entry, Detail, etc.)
 *
 * Rationale for condition 2:
 *   - ChecklistItem: single parent (Message), no children, suffix "Item" → true child ✅
 *   - Room: single parent (User) BUT owns Message[] → NOT true child, gets own feature ✅
 *   - Message: owned by User+Room (2 parents) → NOT true child, gets own feature ✅
 */
function isTrueChildEntity(entityName: string, relations: RelationInfo[]): boolean {
  const parents = relations.filter((r) => r.to === entityName && r.kind === "one-to-many");
  if (parents.length === 0) return false; // no parent = not a child
  if (parents.length > 1) return false;   // multiple parents = shared entity

  const hasOwnChildren = relations.some(
    (r) => r.from === entityName && r.kind === "one-to-many"
  );

  if (!hasOwnChildren) return true;
  if (TRUE_CHILD_SUFFIXES.test(entityName)) return true;

  return false;
}

function entityGraphToFeatures(entityGraph: EntityGraph): FeatureInfo[] {
  if (entityGraph.source === "empty") return [];

  // Deduplicate relations across the graph (entities each hold their own slice)
  const relations: RelationInfo[] = [];
  const seenRelKeys = new Set<string>();
  for (const entity of entityGraph.entities) {
    for (const r of entity.relations) {
      const key = `${r.from}→${r.to}:${r.kind}`;
      if (!seenRelKeys.has(key)) {
        seenRelKeys.add(key);
        relations.push(r);
      }
    }
  }

  // Build true child set using the heuristic
  const trueChildNames = new Set<string>(
    entityGraph.entities
      .map((e) => e.name)
      .filter((name) => isTrueChildEntity(name, relations))
  );

  const features: FeatureInfo[] = [];

  const meaningfulEntities = entityGraph.source === "prisma"
    ? entityGraph.entities.filter((e) =>
        relations.some((r) => r.from === e.name || r.to === e.name)
      )
    : entityGraph.entities;

  for (const entity of meaningfulEntities.slice(0, 8)) {
    // Skip true child entities — they appear inside their parent's purpose
    if (trueChildNames.has(entity.name)) continue;

    // Skip known infrastructure entities — auth provider internals, ORM bookkeeping
    if (INFRASTRUCTURE_ENTITY_NAMES.has(entity.name)) continue;

    // OWNED: non-infra, non-true-child entities this entity owns via one-to-many
    const ownedNames = relations
      .filter((r) => r.from === entity.name && r.kind === "one-to-many")
      .map((r) => r.to)
      .filter((n) => !INFRASTRUCTURE_ENTITY_NAMES.has(n) && !trueChildNames.has(n));

    const oneToOneOwned = relations
      .filter((r) => r.from === entity.name && r.kind === "one-to-one")
      .map((r) => r.to)
      .filter((n) => !INFRASTRUCTURE_ENTITY_NAMES.has(n) && !trueChildNames.has(n));

    const allOwned = [...new Set([...ownedNames, ...oneToOneOwned])];

    // PEER: many-to-many associations — not ownership, just relationships
    const peerNames = relations
      .filter((r) =>
        r.kind === "many-to-many"
        && (r.from === entity.name || r.to === entity.name)
      )
      .map((r) => r.from === entity.name ? r.to : r.from)
      .filter((n) => !INFRASTRUCTURE_ENTITY_NAMES.has(n) && !trueChildNames.has(n) && n !== entity.name);

    const purpose = buildEntityPurpose(entity.name, allOwned, peerNames);

    const searchTerms = [
      entity.name.toLowerCase(),
      ...allOwned.map((n) => n.toLowerCase()),
      ...peerNames.map((n) => n.toLowerCase()),
      "management", "crud"
    ].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 8);

    features.push({
      name: `${entity.name} Management`,
      purpose,
      files: [],
      entryPoints: [],
      businessFlow: [],
      searchTerms,
      confidence: entityGraph.source === "prisma" ? "high" : "medium",
      evidence: []
    });
  }

  return features;
}

function buildEntityPurpose(
  entityName: string,
  owned: string[],
  peers: string[]
): string {
  if (owned.length > 0 && peers.length > 0) {
    return `Manages ${entityName} (including ${owned.join(", ")}) and its associations with ${peers.join(", ")}.`;
  }
  if (owned.length > 0) {
    return `Manages ${entityName} and its owned items: ${owned.join(", ")}.`;
  }
  if (peers.length > 0) {
    return `Manages ${entityName} and its associations with ${peers.join(", ")}.`;
  }
  return `Manages ${entityName} data and operations.`;
}

// ---------------------------------------------------------------------------
// Confidence calculation
// ---------------------------------------------------------------------------
function calculateFeatureConfidence(
  evidence: string[],
  analyses: Record<string, FileAnalysis>
): FeatureInfo["confidence"] {
  if (evidence.length === 0) return "low";
  const highQualityCount = evidence.filter(
    (path) => analyses[path]?.confidence === "high"
  ).length;
  if (highQualityCount >= 2) return "high";
  if (highQualityCount >= 1 || evidence.length >= 2) return "medium";
  return "low";
}

function createFeatureInfo(
  name: string,
  evidence: string[],
  terms: string[],
  purpose = `Identifies ${name.toLowerCase()} capability in the project.`,
  analyses: Record<string, FileAnalysis> = {}
): FeatureInfo {
  const files = evidence.filter((item) => item.includes("/") || /\.[A-Za-z0-9]+$/.test(item));

  const entryPoints = files
    .map((file) => ({ file, score: scoreEntryPointRelevance(file, name.toLowerCase()) }))
    .sort((a, b) => a.score - b.score)
    .filter((e) => e.score < ENTRY_POINT_EXCLUDE_THRESHOLD)
    .slice(0, 2)
    .map((e) => e.file);

  return {
    name,
    purpose,
    files,
    businessFlow: [],
    entryPoints,
    searchTerms: [...new Set(terms.map((term) => term.toLowerCase()))].slice(0, 8),
    confidence: calculateFeatureConfidence(evidence, analyses),
    evidence
  };
}

function mergeFeature(features: FeatureInfo[], addition: FeatureInfo): void {
  const existingIndex = features.findIndex((feature) => feature.name === addition.name);
  if (existingIndex === -1) {
    features.push(addition);
    return;
  }
  const existing = features[existingIndex];
  features[existingIndex] = {
    ...existing,
    files: [...new Set([...existing.files, ...addition.files])],
    evidence: [...new Set([...existing.evidence, ...addition.evidence])],
    searchTerms: [...new Set([...existing.searchTerms, ...addition.searchTerms])].slice(0, 8),
    confidence: mergeTwoConfidences(existing.confidence, addition.confidence)
  };
}

function mergeTwoConfidences(
  a: FeatureInfo["confidence"],
  b: FeatureInfo["confidence"]
): FeatureInfo["confidence"] {
  const rank: Record<FeatureInfo["confidence"], number> = { high: 2, medium: 1, low: 0 };
  return rank[a] >= rank[b] ? a : b;
}

// ---------------------------------------------------------------------------
// matchesSignal
//
// AI Integration: import-only, no path matching.
//   "ai", "llm", "embedding", "model" appear in too many non-AI contexts.
//   Only a recognized provider import is reliable evidence.
//
// All other signals: path matching first, then import matching.
// ---------------------------------------------------------------------------

const AI_PROVIDER_IMPORTS = new Set([
  "openai",
  "groq",
  "openrouter",
  "anthropic",
  "@anthropic-ai/sdk",
  "cohere",
  "mistralai",
  "together",
  "replicate",
  "huggingface",
  "llamaindex",
]);

const AI_PROVIDER_PREFIXES = [
  "langchain",
  "@langchain/",
  "google-generative-ai",
  "@google/generative-ai",
  "@google/genai",
  "@vercel/ai",
  "ai/",
];

function isAiProviderImport(specifier: string): boolean {
  const lower = specifier.toLowerCase();
  if (AI_PROVIDER_IMPORTS.has(lower)) return true;
  return AI_PROVIDER_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function matchesSignal(
  file: ScannedFile,
  analysis: FileAnalysis | undefined,
  terms: string[],
  featureName?: string
): boolean {
  if (featureName === "AI Integration") {
    if (!analysis) return false;
    return analysis.imports.some(isAiProviderImport);
  }

  const path = file.path.toLowerCase();

  if (terms.some((term) => matchesPathTerm(path, term))) return true;

  if (analysis) {
    return terms.some((term) =>
      analysis.imports.some((specifier) => specifier.toLowerCase().includes(term))
    );
  }

  return false;
}

function matchesPathTerm(path: string, term: string): boolean {
  // Short terms (≤3 chars) — whole-word match only
  // Prevents "ai" matching "detail", "tailwind", "email"
  if (term.length <= 3) {
    return new RegExp(`(?:^|[/._-])${escapeRegex(term)}(?:[/._-]|$)`).test(path);
  }
  return path.includes(term);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Authentication enrichment
// ---------------------------------------------------------------------------
function enrichAuthenticationFeature(
  features: FeatureInfo[],
  files: ScannedFile[],
  analyses: Record<string, FileAnalysis>
): FeatureInfo[] {
  const authFiles = collectAuthenticationFeatureFiles(files, analyses);
  if (authFiles.length === 0) return features;

  const existingAuth = features.find((f) => f.name === "Authentication");
  if (existingAuth) {
    return features.map((feature) =>
      feature.name === "Authentication"
        ? {
            ...feature,
            files: orderAuthenticationFiles([...new Set([...feature.files, ...authFiles])]),
            evidence: orderAuthenticationFiles([...new Set([...feature.evidence, ...authFiles])]),
            confidence: calculateFeatureConfidence(
              [...new Set([...feature.evidence, ...authFiles])],
              analyses
            )
          }
        : feature
    );
  }

  return [
    ...features,
    createFeatureInfo("Authentication", authFiles, [
      "auth", "authentication", "login", "session", "jwt", "next-auth"
    ], undefined, analyses)
  ];
}

function collectAuthenticationFeatureFiles(
  files: ScannedFile[],
  analyses: Record<string, FileAnalysis>
): string[] {
  return orderAuthenticationFiles(
    files
      .filter((file) => isArchitectureSource(file.path))
      .filter((file) => isTechnicalFeatureSource(file.path))
      .filter((file) => isFeatureEvidenceFile(file.path))
      .filter((file) => !isAnalyzerImplementationFile(file.path))
      .filter((file) => classifyFileRole(file.path) !== "ai-integration")
      .filter((file) => {
        const analysis = analyses[file.path];
        const imports = analysis?.imports ?? extractImportsFallback(file.content);
        const symbols = analysis
          ? analysis.symbols.map((s) => s.name)
          : extractSymbolsFallback(file.content);
        return detectAuthenticationSemanticRole(file.path, symbols, imports, file.content) !== null;
      })
      .map((file) => file.path)
  );
}

function isAnalyzerImplementationFile(path: string): boolean {
  const normalized = path.toLowerCase();
  return (
    /(^|\/)(analyzers?|detectors?)\//.test(normalized)
    || /(^|\/)[^/]+(?:analyzer|detector)\.[cm]?[jt]sx?$/.test(normalized)
  );
}

export function detectAuthenticationSemanticRole(
  path: string,
  symbols: string[],
  imports: string[],
  content = ""
): AuthSemanticRole | null {
  const normalizedPath = path.toLowerCase();
  const text = `${normalizedPath} ${symbols.join(" ")} ${imports.join(" ")} ${content}`.toLowerCase();
  const normalizedImports = imports.map((s) => s.toLowerCase());

  const hasAuthImport = normalizedImports.some((s) =>
    /(^|[/@-])(auth|next-auth|auth0|clerk|lucia|better-auth|passport|kinde)([/.-]|$)/.test(s)
    || /supabase.*auth/.test(s)
    || /firebase\/auth/.test(s)
  );
  const hasAuthSymbol = symbols.some((s) =>
    /(auth|session|login|register|signin|signout|jwt|token|credential)/i.test(s)
  );
  const hasAuthPath = /(^|[/._-])(auth|session|login|register|signin|signout)([/._-]|$)/.test(normalizedPath);
  const hasGuardPath = /(^|[/._-])(guard|middleware|proxy|protected)([/._-]|$)/.test(normalizedPath);
  const hasGuardSymbol = symbols.some((s) => /(guard|middleware|proxy|protected)/i.test(s));

  if (
    /(^|\/)src\/auth\.[cm]?[jt]sx?$/.test(normalizedPath)
    || /(^|\/)auth\.[cm]?[jt]sx?$/.test(normalizedPath)
    || (hasSymbol(symbols, "auth") && hasSymbol(symbols, "handlers"))
    || (hasAuthImport && /\b(nextauth|getserversession|getsession|credentials|authconfig)\b/.test(text))
  ) return "auth-config";

  if (
    /(^|\/)(src\/)?(proxy|middleware)\.[cm]?[jt]sx?$/.test(normalizedPath)
    || ((hasAuthPath || hasAuthImport || hasAuthSymbol) && (hasGuardPath || hasGuardSymbol))
  ) return "guard";

  if (/providers?\.[cm]?[jt]sx?$/.test(normalizedPath) && (hasAuthImport || hasAuthSymbol))
    return "provider";

  if (
    /(app-shell|layout)\.[cm]?[jt]sx?$/.test(normalizedPath)
    && /\b(signout|handlesignout|usesession|sessionprovider|useauth)\b/.test(text)
  ) return "consumer";

  if (hasAuthPath || hasAuthImport || hasAuthSymbol) return "consumer";

  return null;
}

// ---------------------------------------------------------------------------
// File priority helpers
// ---------------------------------------------------------------------------
function featureFilePriority(featureName: string, path: string): number {
  const normalized = path.toLowerCase();

  if (featureName === "Documentation") {
    if (normalized === "readme.md") return 0;
    if (normalized === "contributing.md") return 1;
    if (normalized === "changelog.md") return 2;
    if (/^packages\/[^/]+\/readme\.md$/.test(normalized)) return 10;
    if (/^docs\//.test(normalized)) return 20;
    return 30 + normalized.split("/").length;
  }

  const index = FEATURE_FILE_PRIORITIES[featureName]
    ?.findIndex((pattern) => pattern.test(normalized)) ?? -1;
  return index === -1 ? 100 : index;
}

export function orderAuthenticationFiles(files: string[]): string[] {
  return [...new Set(files)].sort((left, right) =>
    authenticationFilePriority(left) - authenticationFilePriority(right)
    || left.localeCompare(right)
  );
}

export function authenticationFilePriority(path: string): number {
  const normalized = path.toLowerCase();
  if (/(^|\/)(src\/)?(proxy|middleware)\.[cm]?[jt]sx?$/.test(normalized)) return 10;
  if (/(^|\/)(src\/)?auth\.[cm]?[jt]sx?$/.test(normalized)) return 20;
  if (/\/auth\/config\.[cm]?[jt]sx?$/.test(normalized)) return 25;
  if (/\/api\/auth\//.test(normalized)) return 30;
  if (/\/api\/.*\/(login|register|logout)\.[cm]?[jt]s$/.test(normalized)) return 35;
  if (/login.*(page|form)\.[cm]?[jt]sx?$/.test(normalized)) return 40;
  if (/register.*(page|form)\.[cm]?[jt]sx?$/.test(normalized)) return 45;
  if (/providers?\.[cm]?[jt]sx?$/.test(normalized)) return 50;
  if (/(dashboard|app-shell|layout)\.[cm]?[jt]sx?$/.test(normalized)) return 60;
  return 80;
}

// ---------------------------------------------------------------------------
// Fallback helpers (used when ts-morph analysis unavailable)
// ---------------------------------------------------------------------------
function extractImportsFallback(content: string): string[] {
  const imports: string[] = [];
  const pattern = /(?:import\s+(?:[^'"]+\s+from\s+)?|require\()\s*['"]([^'"]+)['"]/g;
  let match = pattern.exec(content);
  while (match) {
    imports.push(match[1].toLowerCase());
    match = pattern.exec(content);
  }
  return imports;
}

function extractSymbolsFallback(content: string): string[] {
  const symbols = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /(?:function|const)\s+([A-Za-z_$][A-Za-z0-9_$]*(?:Auth|Session|Login|Register|SignOut|Provider|Guard)[A-Za-z0-9_$]*)/g
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      symbols.add(match[1]);
      match = pattern.exec(content);
    }
  }
  return [...symbols];
}

function hasSymbol(symbols: string[], name: string): boolean {
  return symbols.some((s) => s.toLowerCase() === name);
}
