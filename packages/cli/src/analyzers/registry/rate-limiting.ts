import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Rate Limiting",
    category: "feature",
    purpose: "Handles API rate limiting and request throttling.",
    genericTerms: [
      "@upstash/ratelimit", "express-rate-limit",
      "rate-limiter-flexible", "bottleneck",
      "ratelimit", "rate-limit", "throttle",
    ],
  },
];