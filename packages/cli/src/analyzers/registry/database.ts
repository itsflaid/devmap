import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Prisma",
    category: "provider",
    importNames: ["@prisma/client", "prisma"],
  },
  {
    name: "Supabase",
    category: "provider",
    importNames: ["@supabase/supabase-js", "supabase"],
  },
];