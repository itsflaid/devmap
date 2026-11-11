import type { DomainInferenceResult } from "./domainInference.js";

export type DomainEvidence = {
  projectName: string;
  entityNames: string[];
  featureNames: string[];
  routePaths: string[];
  capabilityKinds: string[];
};

export type DomainGrounding = {
  grounded: boolean;
  matched: string[];
  unsupported: string[];
};

// Words that fit almost any project; a claim made only of these says nothing checkable.
const FILLER = new Set([
  "a", "an", "and", "the", "for", "of", "to", "in", "on", "with", "by", "from", "or", "at", "as",
  "is", "are", "be", "it", "its", "this", "that", "these", "those", "into", "over", "via", "per",
  "their", "your", "our", "can", "will", "also", "both", "any", "all", "each", "more",
  "system", "platform", "application", "app", "service", "manager", "management", "tool", "portal",
  "web", "website", "site", "online", "digital", "based", "solution", "software", "project",
  "suite", "hub", "engine", "framework", "starter", "template", "boilerplate", "clone",
  "manage", "handle", "allow", "let", "enable", "provide", "help", "create", "store", "view",
  "track", "build", "use", "support", "include", "offer", "built",
  "user", "account", "session", "token", "verification", "role", "permission", "admin",
  "profile", "setting", "dashboard", "login", "register", "signup", "sign", "auth",
  "authentication", "data", "content", "item", "page", "feature", "file", "api", "next",
  "react", "vue", "svelte", "nextjs", "typescript", "javascript", "node", "full", "stack",
  "people", "person", "customer", "team", "company", "business", "organization", "everyone", "anyone"
]);

// Fewer claimed words than this cannot be judged against the project.
const MIN_CLAIMED_WORDS = 2;

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 3)
    .map(stem);
}

function claimTokens(text: string): string[] {
  const filler = new Set([...FILLER].map(stem));
  return [...new Set(tokenize(text).filter((word) => !filler.has(word)))];
}

/**
 * The model only sees entity names and capability kinds, so a domain that shares no
 * word with the entities, routes or features of the project is a guess, not an inference.
 */
export function groundDomain(result: DomainInferenceResult, evidence: DomainEvidence): DomainGrounding {
  const known = new Set(tokenize([
    evidence.projectName,
    ...evidence.entityNames,
    ...evidence.featureNames,
    ...evidence.routePaths,
    ...evidence.capabilityKinds
  ].join(" ")));

  const domainTokens = claimTokens(result.domain);
  const summaryTokens = claimTokens(result.summary).filter((word) => !domainTokens.includes(word));
  const matchedDomain = domainTokens.filter((word) => known.has(word));
  const matchedSummary = summaryTokens.filter((word) => known.has(word));
  const matched = [...matchedDomain, ...matchedSummary];
  const claimed = [...domainTokens, ...summaryTokens];

  const grounded = claimed.length < MIN_CLAIMED_WORDS
    || matchedDomain.length > 0
    || matchedSummary.length >= (domainTokens.length === 0 ? 1 : 2);

  return { grounded, matched, unsupported: claimed.filter((word) => !known.has(word)) };
}
