import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Analytics",
    category: "feature",
    minimumDistinctFiles: 2,
    purpose: "Handles user analytics, event tracking, and product metrics.",
    genericTerms: [
      "posthog", "mixpanel", "@mixpanel", "amplitude",
      "google-analytics", "gtag", "plausible",
      "segment", "@segment",
      "analytics", "tracking", "event",
    ],
  },
];