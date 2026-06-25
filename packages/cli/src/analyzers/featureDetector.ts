import type { FileAnalysis } from "./fileAnalysis.js";
import type { DatabaseInfo } from "./databaseDetector.js";
import type { ScannedFile } from "./fileScanner.js";
import type { RouteInfo } from "./routeDetector.js";
import type { EntityGraph } from "./extractors/types.js";
import type { CapabilityInfo } from "./capabilityDetector.js";
import { classifyFileRole, isTechnicalFeatureSource, type FileRole } from "./fileRole.js";
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

// ---------------------------------------------------------------------------
// FEATURE_SIGNALS — deteksi fitur berdasarkan import specifiers dan path terms.
// Generic: berlaku untuk semua project yang di-analyze, bukan cuma DevMap.
// Tambahkan terms baru seiring ekosistem berkembang (library baru, dll).
// ---------------------------------------------------------------------------
const FEATURE_SIGNALS: Array<{
  name: string;
  terms: string[];
  purpose: string;
}> = [
  {
    name: "Authentication",
    terms: [
      // Libraries
      "next-auth", "auth0", "clerk", "lucia", "better-auth", "passport",
      "firebase/auth", "@supabase/auth", "kinde",
      // Generic terms
      "auth", "login", "session", "jwt", "oauth", "openid",
    ],
    purpose: "Handles authentication, identity, sessions, login, and access control."
  },
  {
    name: "Payments",
    terms: [
      // Libraries / providers
      "stripe", "midtrans", "xendit", "@xendit", "paypal", "braintree",
      "razorpay", "paddle", "lemonsqueezy", "lemon-squeezy",
      // Generic terms
      "payment", "checkout", "billing", "subscription", "invoice",
    ],
    purpose: "Handles payment providers, billing, and transaction workflows."
  },
  {
    name: "File Upload",
    terms: [
      // Libraries / providers
      "multer", "formidable", "busboy", "cloudinary", "uploadthing",
      "aws-sdk/s3", "@aws-sdk/client-s3", "minio", "backblaze",
      "firebase/storage", "@supabase/storage",
      // Generic terms
      "upload", "storage", "bucket", "blob",
    ],
    purpose: "Handles file ingestion, cloud storage, and upload providers."
  },
  {
    name: "Email",
    terms: [
      // Libraries / providers
      "resend", "nodemailer", "@sendgrid/mail", "sendgrid", "mailgun",
      "postmark", "@postmark", "aws-sdk/ses", "@aws-sdk/client-ses",
      "react-email", "@react-email",
      // Generic terms
      "email", "mailer", "smtp",
    ],
    purpose: "Handles transactional email delivery and templates."
  },
  {
    name: "AI Integration",
    terms: [
      // Libraries / providers
      "openai", "groq", "openrouter", "@anthropic-ai/sdk", "anthropic",
      "google-generative-ai", "@google/generative-ai", "cohere",
      "mistralai", "together", "replicate", "huggingface",
      "langchain", "@langchain", "llamaindex", "ai", "vercel/ai",
      // Generic terms
      "generative-ai", "llm", "embedding", "vectorstore",
    ],
    purpose: "Handles AI providers, LLM calls, prompts, and model context."
  },
  {
    name: "Notifications",
    terms: [
      // Libraries / providers
      "web-push", "pusher", "ably", "soketi", "firebase-messaging",
      "@firebase/messaging", "onesignal", "novu", "@novu",
      // Generic terms
      "notification", "push", "realtime", "websocket",
    ],
    purpose: "Handles push notifications, real-time events, and user alerts."
  },
  {
    name: "Caching",
    terms: [
      // Libraries / providers
      "ioredis", "redis", "@upstash/redis", "upstash", "keyv",
      "lru-cache", "node-cache", "memcached",
      // Generic terms
      "cache", "ttl", "invalidate",
    ],
    purpose: "Handles in-memory and distributed caching strategies."
  },
  {
    name: "Search",
    terms: [
      // Libraries / providers
      "meilisearch", "typesense", "algolia", "@algolia",
      "elasticsearch", "@elastic/elasticsearch",
      "orama", "@orama",
      // Generic terms
      "search", "fulltext", "index", "facet",
    ],
    purpose: "Handles full-text search, indexing, and faceted filtering."
  },
  {
    name: "Background Jobs",
    terms: [
      // Libraries / providers
      "bullmq", "bull", "bee-queue", "agenda", "node-cron",
      "inngest", "@inngest", "trigger.dev", "@trigger.dev",
      "quirrel",
      // Generic terms
      "queue", "worker", "job", "cron", "scheduler",
    ],
    purpose: "Handles background processing, job queues, and scheduled tasks."
  },
  {
    name: "Logging & Monitoring",
    terms: [
      // Libraries / providers
      "pino", "winston", "bunyan", "morgan",
      "@sentry/node", "@sentry/nextjs", "sentry",
      "datadog", "dd-trace", "opentelemetry", "@opentelemetry",
      "posthog", "@posthog",
      // Generic terms
      "logger", "telemetry", "tracing",
    ],
    purpose: "Handles application logging, error tracking, and observability."
  },
  {
    name: "Testing",
    terms: [
      // Libraries
      "vitest", "jest", "@testing-library", "playwright",
      "cypress", "supertest", "msw",
      // Generic terms
      "test", "spec", "mock", "fixture",
    ],
    purpose: "Contains test suites, mocks, and testing infrastructure."
  },
  {
    name: "Internationalization",
    terms: [
      // Libraries
      "next-intl", "next-i18next", "i18next", "react-i18next",
      "lingui", "@lingui", "formatjs", "react-intl",
      // Generic terms
      "i18n", "l10n", "locale", "translation",
    ],
    purpose: "Handles multi-language support, locale routing, and translations."
  },
  {
    name: "Analytics",
    terms: [
      // Libraries / providers
      "posthog", "mixpanel", "@mixpanel", "amplitude",
      "google-analytics", "gtag", "plausible",
      "segment", "@segment",
      // Generic terms
      "analytics", "tracking", "event",
    ],
    purpose: "Handles user analytics, event tracking, and product metrics."
  },
  {
    name: "Rate Limiting",
    terms: [
      // Libraries / providers
      "@upstash/ratelimit", "express-rate-limit",
      "rate-limiter-flexible", "bottleneck",
      // Generic terms
      "ratelimit", "rate-limit", "throttle",
    ],
    purpose: "Handles API rate limiting and request throttling."
  },
  {
    name: "CMS & Content",
    terms: [
      // Libraries / providers
      "contentlayer", "@contentlayer", "sanity", "@sanity",
      "contentful", "strapi", "payload", "keystatic",
      "notion", "@notionhq",
      // Generic terms
      "cms", "content", "mdx",
    ],
    purpose: "Handles CMS integrations and structured content management."
  },
];

// ---------------------------------------------------------------------------
// ROLE_FEATURES — deteksi fitur berdasarkan FileRole classification.
// Hanya include roles yang generic / berlaku di banyak project.
// DevMap-specific roles (snapshot-engine, analysis-engine) TIDAK di sini —
// mereka akan ke-skip otomatis di project lain karena evidence-nya kosong.
// ---------------------------------------------------------------------------
const ROLE_FEATURES: Array<{
  role: FileRole;
  name: string;
  purpose: string;
  terms: string[];
}> = [
  // --- Universal roles — berlaku semua project ---
  {
    role: "documentation",
    name: "Documentation",
    purpose: "Explains project behavior, setup, architecture, and contribution guidance.",
    terms: ["documentation", "docs", "readme", "guide", "contributing", "changelog"]
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
  {
    role: "api-handler",
    name: "API Layer",
    purpose: "Contains route handlers, controllers, and API endpoint definitions.",
    terms: ["api", "route", "handler", "controller", "endpoint", "rest"]
  },
  {
    role: "service",
    name: "Service Layer",
    purpose: "Contains business logic, use cases, and domain services.",
    terms: ["service", "usecase", "business-logic", "domain", "action"]
  },
  {
    role: "middleware",
    name: "Middleware",
    purpose: "Contains middleware, guards, interceptors, and request pipelines.",
    terms: ["middleware", "guard", "interceptor", "proxy", "pipeline"]
  },
  {
    role: "repository",
    name: "Data Access Layer",
    purpose: "Contains database access logic, repositories, and query builders.",
    terms: ["repository", "dao", "database", "prisma", "drizzle", "query"]
  },
  {
    role: "ui-component",
    name: "UI Components",
    purpose: "Contains reusable UI components, pages, and views.",
    terms: ["component", "ui", "view", "page", "layout", "screen"]
  },
  {
    role: "ai-integration",
    name: "AI Integration",
    purpose: "Handles AI providers, prompts, and model-facing context.",
    terms: ["ai", "llm", "prompt", "openai", "groq", "anthropic", "model"]
  },
];

// ---------------------------------------------------------------------------
// FEATURE_FILE_PRIORITIES — sort evidence files dalam tiap feature.
// Hanya berisi patterns yang GENERIC — berlaku di banyak project.
// Path DevMap-specific (\/analyzers\/tsmorphanalyzer, dll) dihapus.
// ---------------------------------------------------------------------------
const FEATURE_FILE_PRIORITIES: Record<string, RegExp[]> = {
  // Documentation: urutan universal — README selalu paling penting
  Documentation: [
    /(^|\/)readme\.md$/,
    /(^|\/)contributing\.md$/,
    /(^|\/)changelog\.md$/,
    /(^|\/)license(\.md)?$/,
    /(^|\/)docs\/index\.md$/,
    /(^|\/)docs\//,
  ],

  // Authentication: urutan berdasarkan architectural importance
  Authentication: [
    // Config / adapter (paling penting — defines provider)
    /(^|\/)src\/auth\.[cm]?[jt]sx?$/,
    /(^|\/)auth\.[cm]?[jt]sx?$/,
    /\/auth\/config\.[cm]?[jt]sx?$/,
    // Middleware / guard
    /(^|\/)middleware\.[cm]?[jt]sx?$/,
    /\/auth\/middleware\.[cm]?[jt]sx?$/,
    // API handlers
    /\/api\/auth\//,
    /\/api\/.*\/(login|register|logout)\.[cm]?[jt]sx?$/,
    // Providers / context
    /\/providers?\/auth[^/]*\.[cm]?[jt]sx?$/,
    /\/context\/auth[^/]*\.[cm]?[jt]sx?$/,
  ],

  // Payments: config / client dulu, baru handlers
  Payments: [
    /\/lib\/stripe\.[cm]?[jt]sx?$/,
    /\/lib\/payment[^/]*\.[cm]?[jt]sx?$/,
    /\/api\/.*webhook[^/]*\.[cm]?[jt]sx?$/,
    /\/api\/.*checkout[^/]*\.[cm]?[jt]sx?$/,
    /\/api\/.*payment[^/]*\.[cm]?[jt]sx?$/,
  ],

  // AI Integration: provider / client dulu, baru consumers
  "AI Integration": [
    /\/lib\/ai\.[cm]?[jt]sx?$/,
    /\/ai\/provider\.[cm]?[jt]sx?$/,
    /\/ai\/client\.[cm]?[jt]sx?$/,
    /\/lib\/openai\.[cm]?[jt]sx?$/,
    /\/lib\/groq\.[cm]?[jt]sx?$/,
    /\/ai\/prompts?\.[cm]?[jt]sx?$/,
    /\/ai\/completion\.[cm]?[jt]sx?$/,
  ],

  // Email: mailer config dulu, baru templates
  Email: [
    /\/lib\/email[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/mailer[^/]*\.[cm]?[jt]sx?$/,
    /\/emails?\//,
    /\/templates?\//,
  ],

  // File Upload: config / client dulu
  "File Upload": [
    /\/lib\/upload[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/storage[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/cloudinary[^/]*\.[cm]?[jt]sx?$/,
    /\/api\/.*upload[^/]*\.[cm]?[jt]sx?$/,
  ],

  // Background Jobs: queue config dulu
  "Background Jobs": [
    /\/lib\/queue[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/worker[^/]*\.[cm]?[jt]sx?$/,
    /\/workers?\//,
    /\/jobs?\//,
    /\/queues?\//,
  ],

  // Caching: client config dulu
  Caching: [
    /\/lib\/redis\.[cm]?[jt]sx?$/,
    /\/lib\/cache[^/]*\.[cm]?[jt]sx?$/,
    /\/cache\//,
  ],

  // CLI Commands: entry point dulu, baru subcommands
  "CLI Commands": [
    /\/src\/index\.[cm]?[jt]sx?$/,
    /\/bin\//,
    /\/commands?\/index\.[cm]?[jt]sx?$/,
    /\/commands?\//,
  ],

  // Web Landing: index / hero dulu
  "Web Landing": [
    /\/pages\/index\.(astro|tsx?|jsx?)$/,
    /\/app\/page\.(tsx?|jsx?)$/,
    /\/landing\//,
    /(hero|pricing|features?section)[^/]*\.(astro|tsx?|jsx?|vue|svelte)$/,
  ],

  // Testing: setup / config dulu
  Testing: [
    /\/(vitest|jest)\.config\.[cm]?[jt]sx?$/,
    /\/test-utils?\.[cm]?[jt]sx?$/,
    /\/setup\.(test|spec)\.[cm]?[jt]sx?$/,
  ],

  // Search: client / config dulu
  Search: [
    /\/lib\/search[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/meilisearch[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/algolia[^/]*\.[cm]?[jt]sx?$/,
  ],

  // Logging: config dulu
  "Logging & Monitoring": [
    /\/lib\/logger[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/sentry[^/]*\.[cm]?[jt]sx?$/,
    /\/instrumentation\.[cm]?[jt]sx?$/,
    /\/sentry\.(client|server|edge)\.[cm]?[jt]sx?$/,
  ],
};

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
        || (definition.name === "Snapshot Engine"
          && /(^|\/)projectmap\.[cm]?[jt]sx?$/.test(file.path.toLowerCase()))
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
      .filter((file) => matchesSignal(file, analyses[file.path], signal.terms))
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

  if (database) {
    const evidence = database.files.length > 0 ? database.files : [database.provider];
    features.push(createFeatureInfo("Database", evidence, [
      "database",
      "schema",
      "model",
      "repository",
      "migration",
      database.provider.toLowerCase()
    ], undefined, analyses));
  }

  const apiFiles = [...new Set(routes.filter((route) => route.kind === "api").map((route) => route.file))];
  if (apiFiles.length > 0) {
    features.push(createFeatureInfo("API Routes", apiFiles.slice(0, 5), [
      "api",
      "route",
      "endpoint",
      "request",
      "response",
      "handler",
    ], undefined, analyses));
  }

  // Domain features — derived from capabilities (Step 2) which are based on
  // route patterns + HTTP methods. More reliable than raw route segment mapping
  // because capabilities already understand CRUD vs sharing vs collaboration.
  if (capabilities && capabilities.length > 0) {
    for (const feature of capabilitiesToFeatures(capabilities)) {
      mergeFeature(features, feature);
    }
  }

  // Entity-based features — dari Prisma schema atau route hints (Step 1).
  // Hanya aktif kalau entityGraph tersedia dan punya data.
  if (entityGraph && entityGraph.entityNames.length > 0) {
    for (const feature of entityGraphToFeatures(entityGraph)) {
      mergeFeature(features, feature);
    }
  }

  return enrichAuthenticationFeature(features, scopedFiles, analyses)
    .sort((left, right) => left.name.localeCompare(right.name));
}

// ---------------------------------------------------------------------------
// capabilitiesToFeatures — convert CapabilityInfo[] ke FeatureInfo[].
//
// CapabilityInfo dari capabilityDetector sudah structured — tinggal map
// ke FeatureInfo format yang dipakai featureDetector dan snapshot.
//
// Capability "crud" pada entity "Snippet" → feature "Snippet Management"
// Capability "sharing" → feature "Content Sharing"
// ---------------------------------------------------------------------------
function capabilitiesToFeatures(capabilities: CapabilityInfo[]): FeatureInfo[] {
  return capabilities.map((cap) => {
    const name = cap.name;
    const terms = [
      cap.kind,
      ...cap.entities.map((e) => e.toLowerCase()),
    ];

    return {
      name,
      purpose: purposeFromCapability(cap),
      files: cap.evidence,
      entryPoints: cap.evidence.slice(0, 2),
      businessFlow: [],
      searchTerms: [...new Set(terms)].slice(0, 8),
      confidence: cap.confidence,
      evidence: cap.evidence
    };
  });
}

function purposeFromCapability(cap: CapabilityInfo): string {
  const entityList = cap.entities.length > 0
    ? cap.entities.join(", ")
    : "resources";

  switch (cap.kind) {
    case "crud":         return `Handles create, read, update, and delete operations for ${entityList}.`;
    case "sharing":      return `Handles content sharing via public links and share tokens.`;
    case "collaboration":return `Handles team collaboration, workspaces, and member management.`;
    case "discovery":    return `Handles public content discovery and browsing.`;
    case "publishing":   return `Handles content publishing and visibility management.`;
    case "social":       return `Handles social interactions like likes, favorites, and reactions.`;
    case "file-management": return `Handles file uploads, storage, and media management.`;
    case "real-time":    return `Handles real-time events, websockets, and live updates.`;
    case "search":       return `Handles full-text search and content filtering.`;
    case "reporting":    return `Handles usage statistics, analytics, and reporting.`;
    default:             return `Handles ${cap.kind} operations for ${entityList}.`;
  }
}

// ---------------------------------------------------------------------------
// entityGraphToFeatures — convert EntityGraph ke high-level domain features.
//
// Berbeda dari capabilitiesToFeatures yang focus ke behavior,
// ini focus ke *apa yang di-manage* project — entity-centric view.
//
// Hanya generate feature kalau entity punya relasi atau multiple routes —
// biar gak terlalu noisy buat project dengan banyak entity kecil.
// ---------------------------------------------------------------------------
function entityGraphToFeatures(entityGraph: EntityGraph): FeatureInfo[] {
  if (entityGraph.source === "empty") return [];

  const features: FeatureInfo[] = [];

  // Hanya include entity yang punya relasi ke entity lain (meaningful entity)
  // atau semua kalau source adalah route-hint (less strict karena data terbatas)
  const meaningfulEntities = entityGraph.source === "prisma"
    ? entityGraph.entities.filter((e) =>
        e.relations.length > 0 ||
        entityGraph.relations.some((r) => r.from === e.name || r.to === e.name)
      )
    : entityGraph.entities;

  for (const entity of meaningfulEntities.slice(0, 8)) {
    const relatedNames = entityGraph.relations
      .filter((r) => r.from === entity.name || r.to === entity.name)
      .map((r) => r.from === entity.name ? r.to : r.from);

    features.push({
      name: `${entity.name} Management`,
      purpose: relatedNames.length > 0
        ? `Manages ${entity.name} and its relationships with ${relatedNames.join(", ")}.`
        : `Manages ${entity.name} data and operations.`,
      files: [],
      entryPoints: [],
      businessFlow: [],
      searchTerms: [
        entity.name.toLowerCase(),
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
// calculateFeatureConfidence — weight by analyzer quality, not just count.
// ts-morph (confidence: "high") = semantically verified via AST.
// heuristic/fallback = regex-based, less certain.
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

  return {
    name,
    purpose,
    files,
    businessFlow: [],
    entryPoints: [],
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
  const files = [...new Set([...existing.files, ...addition.files])];
  const evidence = [...new Set([...existing.evidence, ...addition.evidence])];

  features[existingIndex] = {
    ...existing,
    files,
    evidence,
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
// matchesSignal — imports from ts-morph first, fallback to path check.
// Prevents false positives from README.md, comments, etc.
//
// PATH MATCHING RULES:
// - Long terms (>3 chars): substring match is fine. "stripe" won't appear in
//   unrelated paths by accident.
// - Short terms (<=3 chars): MUST be whole word/segment. "ai" as substring
//   matches "detail", "tailwind", "email" — all false positives.
//   e.g. "ai" should only match "src/ai/", "ai.ts", not "detail.tsx".
//
// IMPORT MATCHING:
// - Always substring — import specifiers are package names like "openai",
//   "@anthropic-ai/sdk". Substring is safe and necessary here.
// ---------------------------------------------------------------------------
function matchesSignal(
  file: ScannedFile,
  analysis: FileAnalysis | undefined,
  terms: string[]
): boolean {
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
  // Short terms (<=3 chars) — whole word only, surrounded by path separators.
  // Prevents "ai" matching "detail", "tailwind", "email", "rain", etc.
  if (term.length <= 3) {
    return new RegExp(`(?:^|[/._-])${escapeRegex(term)}(?:[/._-]|$)`).test(path);
  }
  return path.includes(term);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function enrichAuthenticationFeature(
  features: FeatureInfo[],
  files: ScannedFile[],
  analyses: Record<string, FileAnalysis>
): FeatureInfo[] {
  const authFiles = collectAuthenticationFeatureFiles(files, analyses);
  if (authFiles.length === 0) {
    return features;
  }

  const existingAuth = features.find((feature) => feature.name === "Authentication");
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
  return orderAuthenticationFiles(files
    .filter((file) => isArchitectureSource(file.path))
    .filter((file) => isTechnicalFeatureSource(file.path))
    .filter((file) => !isAnalyzerImplementationFile(file.path))
    .filter((file) => {
      const analysis = analyses[file.path];
      const imports = analysis?.imports ?? extractImportsFallback(file.content);
      const symbols = analysis
        ? analysis.symbols.map((s) => s.name)
        : extractSymbolsFallback(file.content);
      return detectAuthenticationSemanticRole(file.path, symbols, imports, file.content) !== null;
    })
    .map((file) => file.path));
}

function isAnalyzerImplementationFile(path: string): boolean {
  return /(^|\/)(analyzers?|detectors?)\//i.test(path);
}

export function detectAuthenticationSemanticRole(
  path: string,
  symbols: string[],
  imports: string[],
  content = ""
): AuthSemanticRole | null {
  const normalizedPath = path.toLowerCase();
  const text = `${normalizedPath} ${symbols.join(" ")} ${imports.join(" ")} ${content}`.toLowerCase();
  const normalizedImports = imports.map((specifier) => specifier.toLowerCase());

  const hasAuthImport = normalizedImports.some((specifier) =>
    /(^|[/@-])(auth|next-auth|auth0|clerk|lucia|better-auth|passport|kinde)([/.-]|$)/.test(specifier)
    || /supabase.*auth/.test(specifier)
    || /firebase\/auth/.test(specifier)
  );
  const hasAuthSymbol = symbols.some((symbol) =>
    /(auth|session|login|register|signin|signout|jwt|token|credential)/i.test(symbol)
  );
  const hasAuthPath = /(^|[/._-])(auth|session|login|register|signin|signout)([/._-]|$)/.test(normalizedPath);
  const hasGuardPath = /(^|[/._-])(guard|middleware|proxy|protected)([/._-]|$)/.test(normalizedPath);
  const hasGuardSymbol = symbols.some((symbol) =>
    /(guard|middleware|proxy|protected)/i.test(symbol)
  );

  if (
    /(^|\/)src\/auth\.[cm]?[jt]sx?$/.test(normalizedPath)
    || /(^|\/)auth\.[cm]?[jt]sx?$/.test(normalizedPath)
    || (hasSymbol(symbols, "auth") && hasSymbol(symbols, "handlers"))
    || (hasAuthImport && /\b(nextauth|getserversession|getsession|credentials|authconfig)\b/.test(text))
  ) {
    return "auth-config";
  }

  if (
    /(^|\/)(src\/)?(proxy|middleware)\.[cm]?[jt]sx?$/.test(normalizedPath)
    || ((hasAuthPath || hasAuthImport || hasAuthSymbol) && (hasGuardPath || hasGuardSymbol))
  ) {
    return "guard";
  }

  if (
    /providers?\.[cm]?[jt]sx?$/.test(normalizedPath)
    && (hasAuthImport || hasAuthSymbol)
  ) {
    return "provider";
  }

  if (
    /(app-shell|layout)\.[cm]?[jt]sx?$/.test(normalizedPath)
    && /\b(signout|handlesignout|usesession|sessionprovider|useauth)\b/.test(text)
  ) {
    return "consumer";
  }

  if (hasAuthPath || hasAuthImport || hasAuthSymbol) {
    return "consumer";
  }

  return null;
}

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
// Fallback helpers — only called when FileAnalysis is unavailable.
// Used for non-TS/JS files handled by HeuristicAnalyzer / FallbackAnalyzer.
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
  return symbols.some((symbol) => symbol.toLowerCase() === name);
}
