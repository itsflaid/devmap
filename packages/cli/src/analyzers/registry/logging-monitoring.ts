import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Logging & Monitoring",
    category: "feature",
    purpose: "Handles application logging, error tracking, and observability.",
    genericTerms: [
      "pino", "winston", "bunyan", "morgan",
      "@sentry/node", "@sentry/nextjs", "sentry",
      "datadog", "dd-trace", "opentelemetry", "@opentelemetry",
      "logger", "telemetry", "tracing",
    ],
  },
];