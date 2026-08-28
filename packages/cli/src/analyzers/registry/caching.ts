import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Caching",
    category: "feature",
    purpose: "Handles in-memory and distributed caching strategies.",
    genericTerms: [
      "ioredis", "redis", "@upstash/redis", "keyv",
      "lru-cache", "node-cache", "memcached",
      "cache", "ttl", "invalidate",
    ],
  },
];