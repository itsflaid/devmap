import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Authentication",
    category: "feature",
    purpose: "Handles authentication, identity, sessions, login, and access control.",
    genericTerms: [
      "next-auth", "auth0", "clerk", "lucia", "better-auth", "passport",
      "firebase/auth", "@supabase/auth", "kinde",
      "auth", "login", "session", "jwt", "oauth", "openid",
    ],
  },
  {
    name: "NextAuth",
    category: "provider",
    importNames: ["next-auth", "authjs"],
  },
];