import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "AI Integration",
    category: "feature",
    importOnly: true,
    purpose: "Handles AI providers, LLM calls, prompts, and model context.",
    genericTerms: [
      "openai", "groq", "openrouter", "@anthropic-ai/sdk", "anthropic",
      "google-generative-ai", "@google/generative-ai", "@google/genai", "cohere",
      "mistralai", "together", "replicate", "huggingface",
      "langchain", "@langchain", "llamaindex", "@vercel/ai", "ai/react",
    ],
  },
  {
    name: "OpenAI",
    category: "ai-provider",
    importNames: ["openai"],
    contentSignals: ["api.openai.com", "openai api key", "openaiclient"],
    hosts: ["api.openai.com"],
  },
  {
    name: "Groq",
    category: "ai-provider",
    importNames: ["groq"],
    contentSignals: ["api.groq.com", "console.groq.com", "groq api key", "groqclient"],
    hosts: ["api.groq.com"],
  },
  {
    name: "OpenRouter",
    category: "ai-provider",
    importNames: ["openrouter"],
    contentSignals: ["openrouter.ai", "openrouter api key", "openrouterclient"],
    hosts: ["openrouter.ai/api"],
  },
  {
    name: "Anthropic",
    category: "ai-provider",
    importNames: ["anthropic", "@anthropic-ai/sdk"],
    hosts: ["api.anthropic.com"],
  },
  {
    name: "Cohere",
    category: "ai-provider",
    importNames: ["cohere"],
    hosts: ["api.cohere.ai"],
  },
  {
    name: "MistralAI",
    category: "ai-provider",
    importNames: ["mistralai"],
    hosts: ["api.mistral.ai"],
  },
  {
    name: "Together",
    category: "ai-provider",
    importNames: ["together"],
    hosts: ["api.together.xyz"],
  },
  {
    name: "Replicate",
    category: "ai-provider",
    importNames: ["replicate"],
    hosts: ["api.replicate.com"],
  },
  {
    name: "HuggingFace",
    category: "ai-provider",
    importNames: ["huggingface"],
  },
  {
    name: "LlamaIndex",
    category: "ai-provider",
    importNames: ["llamaindex"],
  },
  {
    name: "LangChain",
    category: "ai-provider",
    importNames: ["langchain"],
    importPrefixes: ["@langchain/"],
  },
  {
    name: "Google",
    category: "ai-provider",
    importNames: ["google-generative-ai"],
    importPrefixes: ["@google/generative-ai", "@google/genai"],
    hosts: ["generativelanguage.googleapis.com"],
  },
  {
    name: "VercelAI",
    category: "ai-provider",
    importPrefixes: ["@vercel/ai", "ai/"],
  },
];