import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Caching",
    category: "feature",
    // A single file importing redis is usually a rate limiter or a session store, not caching.
    minimumDistinctFiles: 2,
    purpose: "Handles in-memory and distributed caching strategies.",
    genericTerms: [
      "ioredis", "redis", "@upstash/redis", "keyv",
      "lru-cache", "node-cache", "memcached",
      "cache", "ttl", "invalidate",
    ],
  },
];