import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Background Jobs",
    category: "feature",
    purpose: "Handles background processing, job queues, and scheduled tasks.",
    genericTerms: [
      "bullmq", "bull", "bee-queue", "agenda", "node-cron",
      "inngest", "@inngest", "trigger.dev", "@trigger.dev",
      "quirrel", "@upstash/qstash", "qstash",
      "queue", "worker", "job", "cron", "scheduler",
    ],
  },
];