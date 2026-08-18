import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Notifications",
    category: "feature",
    minimumDistinctFiles: 2,
    purpose: "Handles push notifications, real-time events, and user alerts.",
    genericTerms: [
      "web-push", "pusher", "ably", "soketi", "firebase-messaging",
      "@firebase/messaging", "onesignal", "novu", "@novu",
      "notification", "push", "realtime", "websocket",
    ],
  },
];