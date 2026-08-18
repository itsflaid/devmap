// Canonical AI provider vocabulary used by feature detection.
//
// AI Integration is import-only by default: "ai", "llm", "embedding", "model"
// appear in too many non-AI contexts. Only a recognized provider import is
// reliable evidence — WITH two narrow fallbacks for providers called via raw
// fetch() instead of an SDK package (DevMap's own ai/groq.ts and
// ai/openrouter.ts do exactly this): a literal provider hostname in file
// content, or the file living under the same src/ai/ convention already used
// for file-role classification. Neither reintroduces generic substring noise —
// both require a specific, low-noise signal, not a bare "ai" match anywhere.

export const AI_PROVIDER_IMPORTS = new Set([
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

export const AI_PROVIDER_PREFIXES = [
  "langchain",
  "@langchain/",
  "google-generative-ai",
  "@google/generative-ai",
  "@google/genai",
  "@vercel/ai",
  "ai/",
];

export function isAiProviderImport(specifier: string): boolean {
  const lower = specifier.toLowerCase();
  if (AI_PROVIDER_IMPORTS.has(lower)) return true;
  return AI_PROVIDER_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// Fallback for providers called via raw fetch() instead of an SDK package —
// e.g. `fetch("https://api.groq.com/openai/v1/chat/completions")` with no
// "groq" import anywhere. Only consulted when isAiProviderImport finds
// nothing, so it doesn't loosen the "no noisy path/term matching" rule above.
export const AI_PROVIDER_HOSTS = [
  "api.groq.com",
  "api.openai.com",
  "openrouter.ai/api",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.cohere.ai",
  "api.mistral.ai",
  "api.together.xyz",
  "api.replicate.com",
];

export function hasAiProviderUrl(content: string | undefined): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  return AI_PROVIDER_HOSTS.some((host) => lower.includes(host));
}