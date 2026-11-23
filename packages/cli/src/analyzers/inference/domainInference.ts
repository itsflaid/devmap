import type { EntityGraph } from "../analysis/index.js";
import type { CapabilityInfo, CapabilityKind } from "../detectors/index.js";
import type { FeatureInfo } from "../features/index.js";
import { classifyOwnershipTopology, type OwnershipPattern } from "./ownershipTopology.js";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export type DomainInferenceResult = {
  /** e.g. "Code Snippet Manager", "E-Commerce Platform", "LMS" */
  domain: string;
  /** Human-readable summary of what the project does */
  summary: string;
  /** Domain-specific features the model inferred; not drawn from a fixed list. */
  domainFeatures: DomainFeature[];
  confidence: number; // 0.0 - 1.0
  model: string;
  /** Total tokens used, for cost monitoring. */
  tokensUsed: number;
};

export type DomainFeature = {
  name: string;
  purpose: string;
  relatedEntities: string[];
};

export type DomainInferenceInput = {
  entityNames: string[];
  relations: Array<{ from: string; to: string; kind: string }>;
  capabilities: string[];        // capability kinds only, to save tokens
  technicalFeatures: string[];   // feature names only
  routeCount: number;
  framework: string;
  ownershipPattern: OwnershipPattern;
  crossUserFields: string[];
  absentCapabilities: string[];
};

// Results are cached in .devmap/domain-cache.json keyed by a hash of the input, so
// `devmap analyze` returns the same feature names on every run until the input changes.
type DomainInferenceCache = {
  inputHash: string;
  result: DomainInferenceResult;
  cachedAt: string;
};

function hashDomainInput(input: DomainInferenceInput): string {
  const stable = JSON.stringify({
    v: 3,
    entityNames: [...input.entityNames].sort(),
    relations: [...input.relations]
      .map((r) => `${r.from}:${r.kind}:${r.to}`)
      .sort(),
    capabilities: [...input.capabilities].sort(),
    technicalFeatures: [...input.technicalFeatures].sort(),
    routeCount: input.routeCount,
    framework: input.framework,
    ownershipPattern: input.ownershipPattern,
    crossUserFields: [...input.crossUserFields].sort(),
    absentCapabilities: [...input.absentCapabilities].sort(),
  });
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

async function readDomainCache(
  projectRoot: string,
  inputHash: string,
  input: DomainInferenceInput
): Promise<DomainInferenceResult | null> {
  try {
    const cachePath = join(projectRoot, ".devmap", "domain-cache.json");
    const raw = await readFile(cachePath, "utf-8");
    const cache = JSON.parse(raw) as Partial<DomainInferenceCache>;

    if (cache.inputHash !== inputHash) return null;
    // A cached result that no longer passes validation is a miss, not a crash.
    return sanitizeDomainResult(cache.result, input);
  } catch {
    return null; // missing or corrupt cache file is a miss
  }
}

async function writeDomainCache(
  projectRoot: string,
  inputHash: string,
  result: DomainInferenceResult
): Promise<void> {
  try {
    const devmapDir = join(projectRoot, ".devmap");
    await mkdir(devmapDir, { recursive: true });
    const cachePath = join(devmapDir, "domain-cache.json");
    const cache: DomainInferenceCache = {
      inputHash,
      result,
      cachedAt: new Date().toISOString(),
    };
    await writeFile(cachePath, JSON.stringify(cache, null, 2) + "\n", "utf-8");
  } catch {
    // A failed cache write only costs a repeat LLM call next run.
  }
}

/**
 * Infers the project domain from structured metadata only, never raw source, which
 * keeps a call to ~300-500 tokens. Returns null when the input is too thin, the
 * model fails or its answer does not validate; the static features stand on their own.
 *
 * With `projectRoot`, an unchanged input is answered from the cache without calling `callAI`.
 */
export async function inferDomain(
  input: DomainInferenceInput,
  callAI: (prompt: string) => Promise<string>,
  projectRoot?: string
): Promise<DomainInferenceResult | null> {
  // With neither entities nor capabilities the model has nothing to infer from.
  if (input.entityNames.length === 0 && input.capabilities.length === 0) {
    return null;
  }

  const inputHash = hashDomainInput(input);

  if (projectRoot) {
    const cached = await readDomainCache(projectRoot, inputHash, input);
    if (cached) return cached;
  }

  const prompt = buildDomainInferencePrompt(input);

  try {
    const raw = await callAI(prompt);
    const result = parseDomainInferenceResponse(raw, input);
    if (!result) return null;

    if (projectRoot) {
      await writeDomainCache(projectRoot, inputHash, result);
    }

    return result;
  } catch {
    // Any model or network failure is non-fatal.
    return null;
  }
}

// The caller caps the completion at 600 tokens (commands/analyze.ts), enough for this JSON shape.
function buildDomainInferencePrompt(input: DomainInferenceInput): string {
  const metadata = JSON.stringify({
    framework: input.framework,
    entities: input.entityNames,
    relations: input.relations.map((r) => `${r.from} ${r.kind} ${r.to}`),
    capabilities: input.capabilities,
    technicalFeatures: input.technicalFeatures,
    routeCount: input.routeCount,
    ownershipPattern: input.ownershipPattern,
    crossUserFields: input.crossUserFields,
    absentCapabilities: input.absentCapabilities,
  }, null, 2);

  return `You are analyzing a software project. Given this structural metadata, infer the project domain.

${metadata}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "domain": "short domain name, e.g. Code Snippet Manager",
  "summary": "1-2 sentences describing what this project does",
  "confidence": 0.0-1.0,
  "domainFeatures": [
    {
      "name": "Feature Name",
      "purpose": "What this feature does",
      "relatedEntities": ["Entity1", "Entity2"]
    }
  ]
}

Rules:
- domainFeatures: up to 6 features specific to this domain, not generic technical features. Use an empty array when the metadata does not support any
- Every relatedEntities value must be copied from the entities list above
- Do not include Authentication, Database, or other infrastructure as domainFeatures
- Base everything on the metadata provided, not assumptions
- Entity names alone (e.g. 'Message', 'Room', 'User') are NOT reliable signals of application domain. The same entity name can represent a chat message, an activity log, a personal note, or a comment — depending on ownership pattern, not naming. Use ownershipPattern and absentCapabilities as primary evidence: single_user_isolated strongly suggests a personal/private tool (notes, journal, tracker), not a multi-user communication platform. Only conclude 'chat' or 'messaging' domain if ownershipPattern is shared_access or direct_messaging, or detectedCapabilities includes collaboration/social/real-time.`;
}

const domainFeatureSchema = z.object({
  name: z.string().trim().min(1).max(80),
  purpose: z.string().trim().min(1).max(300),
  relatedEntities: z.union([
    z.array(z.string()),
    z.string().transform((value) => [value])
  ])
});

const domainResultSchema = z.object({
  domain: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(500),
  confidence: z.number().optional(),
  domainFeatures: z.array(z.unknown()).optional()
});

// Every app has these; a feature that only touches them is not specific to the domain.
const GENERIC_ENTITIES = new Set([
  "user", "users", "account", "accounts", "session", "sessions", "verificationtoken",
  "verification", "token", "role", "roles", "permission", "permissions", "profile"
]);

/**
 * Single gate for everything the model (or a stale cache file) hands back.
 * Wrong types are rejected instead of crashing later, and a domain feature only
 * survives with entities that really exist in the static analysis, because an
 * AI feature has no files of its own to be grounded in.
 */
function sanitizeDomainResult(
  value: unknown,
  input: DomainInferenceInput
): DomainInferenceResult | null {
  const parsed = domainResultSchema.safeParse(value);
  if (!parsed.success) return null;

  const knownEntities = new Map(input.entityNames.map((name) => [name.toLowerCase(), name]));
  const domainFeatures: DomainFeature[] = [];

  for (const candidate of parsed.data.domainFeatures ?? []) {
    const feature = domainFeatureSchema.safeParse(candidate);
    if (!feature.success) continue;

    const relatedEntities = [...new Set(
      feature.data.relatedEntities
        .map((name) => knownEntities.get(name.trim().toLowerCase()))
        .filter((name): name is string => name !== undefined)
    )];
    if (!relatedEntities.some((name) => !GENERIC_ENTITIES.has(name.toLowerCase()))) continue;

    domainFeatures.push({
      name: feature.data.name,
      purpose: feature.data.purpose,
      relatedEntities
    });
    if (domainFeatures.length === 6) break;
  }

  return {
    domain: parsed.data.domain,
    summary: parsed.data.summary,
    domainFeatures,
    confidence: Math.min(1, Math.max(0, parsed.data.confidence ?? 0)),
    model: "unknown",
    tokensUsed: 0
  };
}

function parseDomainInferenceResponse(
  raw: string,
  input: DomainInferenceInput
): DomainInferenceResult | null {
  try {
    // Models wrap JSON in markdown fences despite the prompt.
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    return sanitizeDomainResult(JSON.parse(cleaned), input);
  } catch {
    return null;
  }
}

export function domainFeaturesToFeatureInfo(
  domainFeatures: DomainFeature[]
): FeatureInfo[] {
  return domainFeatures.map((df) => ({
    name: df.name,
    purpose: df.purpose,
    files: [],
    entryPoints: [],
    businessFlow: [],
    // Entities go into searchTerms so the similarity engine can match an AI feature to a
    // static one: relatedEntities ["Plan", "Subscription"] overlaps the searchTerms of
    // "Plan Management" and merges instead of duplicating it.
    searchTerms: [
      ...df.relatedEntities.map((e) => e.toLowerCase()),
      ...df.name.toLowerCase().split(/\s+/).filter(Boolean)
    ].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 12),
    confidence: "medium" as const, // AI-inferred is never high
    evidence: []
  }));
}

const ALL_CAPABILITY_KINDS: CapabilityKind[] = [
  "crud", "sharing", "collaboration", "discovery", "publishing",
  "social", "file-management", "real-time", "search", "reporting",
];

export function buildDomainInferenceInput(
  entityGraph: EntityGraph,
  capabilities: CapabilityInfo[],
  features: FeatureInfo[],
  framework: string,
  routeCount: number
): DomainInferenceInput {
  const detectedKinds = new Set(capabilities.map((c) => c.kind));
  const absentCapabilities = ALL_CAPABILITY_KINDS.filter((k) => !detectedKinds.has(k));

  const ownershipResult = classifyOwnershipTopology(
    entityGraph,
    entityGraph.relations
  );

  return {
    entityNames: entityGraph.entityNames.slice(0, 15),
    relations: entityGraph.relations.slice(0, 10),
    capabilities: [...detectedKinds],
    technicalFeatures: features
      .filter((f) => f.confidence === "high" || f.confidence === "medium")
      .map((f) => f.name)
      .slice(0, 10),
    framework,
    routeCount,
    ownershipPattern: ownershipResult.pattern,
    crossUserFields: ownershipResult.crossUserFields.slice(0, 5),
    absentCapabilities: absentCapabilities.slice(0, 8),
  };
}
