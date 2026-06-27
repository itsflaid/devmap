import type { FileAnalysis } from "./fileAnalysis.js";
import type { DatabaseInfo } from "./databaseDetector.js";
import type { ScannedFile } from "./fileScanner.js";
import type { RouteInfo } from "./routeDetector.js";
import type { EntityGraph } from "./extractors/types.js";
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
      "openai", "groq", "openrouter", "@anthropic-ai/sdk", "anthropic",
      "google-generative-ai", "@google/generative-ai", "cohere",
      "mistralai", "together", "replicate", "huggingface",
      "langchain", "@langchain", "llamaindex", "ai", "vercel/ai",
      "generative-ai", "llm", "embedding", "vectorstore",
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
// Documentation evidence filter
// ---------------------------------------------------------------------------

function isDocumentationEvidence(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  const filename = normalized.split("/").at(-1) ?? normalized;

  // Skip GitHub meta folder
  if (/(^|\/)\.github(\/|$)/.test(normalized)) return false;

  // Delegate to fileRole's meta-file list — single source of truth
  if (isDocumentationMeta(filename)) return false;

  // Must be in docs/ folder, wiki/, meaningful README, or API spec
  return (
    /(^|\/)docs?(\/|$)/.test(normalized)
    || /(^|\/)wiki(\/|$)/.test(normalized)
    || filename === "readme.md"
    || /\.(guide|tutorial|reference)\.(md|mdx)$/.test(filename)
    || /(openapi|swagger)\.(json|yaml|yml)$/.test(filename)
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
// Route handlers, service files score low (preferred as entry points).
// ---------------------------------------------------------------------------
const ENTRY_POINT_EXCLUDE_THRESHOLD = 90;

function scoreEntryPointRelevance(file: string, _context: string): number {
  const lower = file.toLowerCase();

  // Hard exclude — never good entry points
  if (/\/(utils?|helpers?|constants?|types?|shared)\.[cm]?[jt]sx?$/.test(lower)) return 100;
  if (/\/(index)\.[cm]?[jt]sx?$/.test(lower) && !/\/(api|routes?|commands?)\//.test(lower)) return 95;
  if (/\.(d\.ts)$/.test(lower)) return 100;

  // Route handlers — best entry points
  if (/\/(route|handler)\.[cm]?[jt]sx?$/.test(lower)) return 5;
  if (/\/api\//.test(lower)) return 10;

  // Service files — good secondary entry points
  if (/\.(service|usecase|action)\.[cm]?[jt]sx?$/.test(lower)) return 20;
  if (/\/services?\//.test(lower)) return 25;

  // CLI command handlers
  if (/\/(commands?|bin)\//.test(lower)) return 15;

  // UI pages — relevant for UI-facing features
  if (/\/(pages?|app)\/.+\/(page|layout)\.[cm]?[jt]sx?$/.test(lower)) return 30;
  if (/\/components?\//.test(lower)) return 50;

  // Lib files — okay but not ideal
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

  for (const definition of ROLE_FEATURES) {
    const evidence = scopedFiles
      .filter((file) =>
        classifyFileRole(file.path) === definition.role
        || (definition.name === "CLI Commands"
          && /(^|\/)src\/index\.[cm]?[jt]s$/.test(file.path.toLowerCase()))
      )
      // Documentation: filter out meta-files, only keep meaningful project docs
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

  const technicalFiles = scopedFiles.filter((file) => isTechnicalFeatureSource(file.path));

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
  // They are surfaced per-feature via capability detection and entity extraction.

  if (capabilities && capabilities.length > 0) {
    for (const feature of capabilitiesToFeatures(capabilities)) {
      mergeFeature(features, feature);
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
// ---------------------------------------------------------------------------
function capabilitiesToFeatures(capabilities: CapabilityInfo[]): FeatureInfo[] {
  return capabilities.map((cap) => {
    const terms = [cap.kind, ...cap.entities.map((e) => e.toLowerCase())];

    // Score evidence files — prefer route handlers over utils
    const scoredEvidence = cap.evidence
      .map((file) => ({ file, score: scoreEntryPointRelevance(file, cap.kind) }))
      .sort((a, b) => a.score - b.score);

    const entryPoints = scoredEvidence
      .filter((e) => e.score < ENTRY_POINT_EXCLUDE_THRESHOLD)
      .slice(0, 2)
      .map((e) => e.file);

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
    case "crud":          return `Handles create, read, update, and delete operations for ${entityList}.`;
    case "sharing":       return `Handles content sharing via public links and share tokens.`;
    case "collaboration": return `Handles team collaboration, workspaces, and member management.`;
    case "discovery":     return `Handles public content discovery and browsing.`;
    case "publishing":    return `Handles content publishing and visibility management.`;
    case "social":        return `Handles social interactions like likes, favorites, and reactions.`;
    case "file-management": return `Handles file uploads, storage, and media management.`;
    case "real-time":     return `Handles real-time events, websockets, and live updates.`;
    case "search":        return `Handles full-text search and content filtering.`;
    case "reporting":     return `Handles usage statistics, analytics, and reporting.`;
    default:              return `Handles ${cap.kind} operations for ${entityList}.`;
  }
}

// ---------------------------------------------------------------------------
// entityGraphToFeatures — entity-centric domain features dengan parent-child detection
// ---------------------------------------------------------------------------
function entityGraphToFeatures(entityGraph: EntityGraph): FeatureInfo[] {
  if (entityGraph.source === "empty") return [];

  // Build child entity set — entities owned by another via one-to-many / many-to-many.
  // Child entities are NOT standalone features — they're mentioned in parent's purpose.
  //
  // Example:
  //   Plan → PlanItem (one-to-many) → PlanItem is child, skip as standalone
  //   DailyLog → DailyLogItem (one-to-many) → DailyLogItem is child
  //   Snippet (no parent) → standalone feature ✅
  const childEntityNames = new Set<string>();

  for (const relation of entityGraph.relations) {
    if (relation.kind === "one-to-many" || relation.kind === "many-to-many") {
      childEntityNames.add(relation.to);
    }
  }

  const features: FeatureInfo[] = [];

  const meaningfulEntities = entityGraph.source === "prisma"
    ? entityGraph.entities.filter((e) =>
        entityGraph.relations.some((r) => r.from === e.name || r.to === e.name)
      )
    : entityGraph.entities;

  for (const entity of meaningfulEntities.slice(0, 8)) {
    // Skip child entities — mentioned in parent's purpose instead
    if (childEntityNames.has(entity.name)) continue;

    // Direct children of this entity
    const childNames = entityGraph.relations
      .filter((r) => r.from === entity.name &&
        (r.kind === "one-to-many" || r.kind === "many-to-many"))
      .map((r) => r.to);

    // Other related entities (non-child)
    const relatedNames = entityGraph.relations
      .filter((r) =>
        (r.from === entity.name || r.to === entity.name) &&
        !childNames.includes(r.from === entity.name ? r.to : r.from)
      )
      .map((r) => r.from === entity.name ? r.to : r.from)
      .filter((n) => !childEntityNames.has(n));

    let purpose: string;
    if (childNames.length > 0 && relatedNames.length > 0) {
      purpose = `Manages ${entity.name} (including ${childNames.join(", ")}) and its relationships with ${relatedNames.join(", ")}.`;
    } else if (childNames.length > 0) {
      purpose = `Manages ${entity.name} and its owned items: ${childNames.join(", ")}.`;
    } else if (relatedNames.length > 0) {
      purpose = `Manages ${entity.name} and its relationships with ${relatedNames.join(", ")}.`;
    } else {
      purpose = `Manages ${entity.name} data and operations.`;
    }

    features.push({
      name: `${entity.name} Management`,
      purpose,
      files: [],
      entryPoints: [],
      businessFlow: [],
      searchTerms: [
        entity.name.toLowerCase(),
        ...childNames.map((n) => n.toLowerCase()),
        ...relatedNames.map((n) => n.toLowerCase()),
        "management", "crud"
      ].slice(0, 8),
      confidence: entityGraph.source === "prisma" ? "high" : "medium",
      evidence: []
    });
  }

  return features;
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

  // Score entry points — avoid utils/helpers as entry points
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
// ---------------------------------------------------------------------------
function matchesSignal(
  file: ScannedFile,
  analysis: FileAnalysis | undefined,
  terms: string[],
  featureName?: string
): boolean {
  const path = file.path.toLowerCase();

  // AI Integration: ONLY import-based — path match too noisy.
  // "model", "ai", "llm", "embedding" appear in too many non-AI contexts.
  if (featureName === "AI Integration") {
    if (!analysis) return false;
    return terms.some((term) =>
      analysis.imports.some((specifier) => specifier.toLowerCase().includes(term))
    );
  }

  if (terms.some((term) => matchesPathTerm(path, term))) return true;

  if (analysis) {
    return terms.some((term) =>
      analysis.imports.some((specifier) => specifier.toLowerCase().includes(term))
    );
  }

  return false;
}

function matchesPathTerm(path: string, term: string): boolean {
  // Short terms (<=3 chars) — whole word only, prevent "ai" matching "detail"
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
      .filter((file) => !isAnalyzerImplementationFile(file.path))
      .filter((file) => classifyFileRole(file.path) !== "ai-integration")
      .filter((file) => {
        const analysis = analyses[file.path];
        const imports = analysis?.imports ?? extractImportsFallback(file.content);
        const symbols = analysis
          ? analysis.symbols.map((s) => s.name)
          : extractSymbolsFallback(file.content);

        return (
          detectAuthenticationSemanticRole(
            file.path,
            symbols,
            imports,
            file.content
          ) !== null
        );
      })
      .map((file) => file.path)
  );
}

function isAnalyzerImplementationFile(path: string): boolean {
  const normalized = path.toLowerCase();

  return (
    // Analyzer/Detector folders
    /(^|\/)(analyzers?|detectors?)\//.test(normalized)

    // Files ending with Analyzer / Detector
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
// Fallback helpers
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
