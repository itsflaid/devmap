import type { EntityGraph } from "./extractors/types.js";
import type { CapabilityInfo } from "./capabilityDetector.js";
import type { FeatureInfo } from "./featureDetector.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DomainInferenceResult = {
  /** e.g. "Code Snippet Manager", "E-Commerce Platform", "LMS" */
  domain: string;
  /** Human-readable summary of what the project does */
  summary: string;
  /** Domain-specific features AI inferred — tidak hardcode, truly dynamic */
  domainFeatures: DomainFeature[];
  confidence: number; // 0.0 - 1.0
  model: string;
  /** Total tokens used — buat monitoring cost */
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
  capabilities: string[];        // capability kinds only — hemat token
  technicalFeatures: string[];   // feature names only
  routeCount: number;
  framework: string;
};

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * inferDomain — kirim structured metadata ke AI, dapat domain understanding.
 *
 * INTENTIONALLY tidak kirim raw source code — hanya metadata terstruktur.
 * Ini menjaga token usage minimal (~300-500 token per call) dan
 * memastikan AI focus pada domain inference, bukan code analysis.
 *
 * Dipanggil SETELAH static analysis selesai (Step 1-4) — sebagai enhancement,
 * bukan replacement. Kalau AI unavailable, static features tetap ada.
 *
 * @param input   - Structured metadata dari static analysis
 * @param callAI  - Injected AI caller — decoupled dari provider specifics
 */
export async function inferDomain(
  input: DomainInferenceInput,
  callAI: (prompt: string) => Promise<string>
): Promise<DomainInferenceResult | null> {
  // Skip kalau data terlalu sedikit — AI inference gak akan meaningful
  if (input.entityNames.length === 0 && input.capabilities.length === 0) {
    return null;
  }

  const prompt = buildDomainInferencePrompt(input);

  try {
    const raw = await callAI(prompt);
    return parseDomainInferenceResponse(raw, input);
  } catch {
    // AI inference adalah enhancement, bukan blocker
    // Kalau gagal, return null — caller tetap punya static features
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * buildDomainInferencePrompt — build minimal, structured prompt.
 *
 * Design principles:
 * - Compact: hanya kirim yang AI butuhkan
 * - Structured: JSON input biar AI gak perlu parse prose
 * - Focused: satu task, satu output format
 * - Bounded: max_tokens 600 cukup buat domain inference
 */
function buildDomainInferencePrompt(input: DomainInferenceInput): string {
  const metadata = JSON.stringify({
    framework: input.framework,
    entities: input.entityNames,
    relations: input.relations.map((r) => `${r.from} ${r.kind} ${r.to}`),
    capabilities: input.capabilities,
    technicalFeatures: input.technicalFeatures,
    routeCount: input.routeCount
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
- domainFeatures: 3-6 features specific to this domain, not generic technical features
- Do not include Authentication, Database, or other infrastructure as domainFeatures
- Base everything on the metadata provided, not assumptions`;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

function parseDomainInferenceResponse(
  raw: string,
  input: DomainInferenceInput
): DomainInferenceResult | null {
  try {
    // Strip markdown fences kalau ada
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as {
      domain?: string;
      summary?: string;
      confidence?: number;
      domainFeatures?: Array<{
        name?: string;
        purpose?: string;
        relatedEntities?: string[];
      }>;
    };

    if (!parsed.domain || !parsed.summary) return null;

    const domainFeatures: DomainFeature[] = (parsed.domainFeatures ?? [])
      .filter((f) => f.name && f.purpose)
      .map((f) => ({
        name: f.name!,
        purpose: f.purpose!,
        relatedEntities: f.relatedEntities ?? []
      }))
      .slice(0, 6);

    return {
      domain: parsed.domain,
      summary: parsed.summary,
      domainFeatures,
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.7)),
      model: "unknown", // diisi caller
      tokensUsed: 0     // diisi caller
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helper — convert DomainFeature ke FeatureInfo buat merge ke snapshot
// ---------------------------------------------------------------------------

export function domainFeaturesToFeatureInfo(
  domainFeatures: DomainFeature[]
): FeatureInfo[] {
  return domainFeatures.map((df) => ({
    name: df.name,
    purpose: df.purpose,
    files: [],
    entryPoints: [],
    businessFlow: [],
    searchTerms: [
      ...df.relatedEntities.map((e) => e.toLowerCase()),
      ...df.name.toLowerCase().split(" ")
    ].slice(0, 8),
    confidence: "medium" as const, // AI-inferred = medium, bukan high
    evidence: []
  }));
}

// ---------------------------------------------------------------------------
// Helper — build DomainInferenceInput dari projectMap data
// ---------------------------------------------------------------------------

export function buildDomainInferenceInput(
  entityGraph: EntityGraph,
  capabilities: CapabilityInfo[],
  features: FeatureInfo[],
  framework: string,
  routeCount: number
): DomainInferenceInput {
  return {
    entityNames: entityGraph.entityNames.slice(0, 15), // cap buat hemat token
    relations: entityGraph.relations.slice(0, 10),
    capabilities: [...new Set(capabilities.map((c) => c.kind))],
    technicalFeatures: features
      .filter((f) => f.confidence === "high")
      .map((f) => f.name)
      .slice(0, 10),
    framework,
    routeCount
  };
}
