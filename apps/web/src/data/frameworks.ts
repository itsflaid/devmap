/**
 * Frameworks whose routes DevMap maps. `icon` is a file name in
 * src/assets/frameworks; a missing file falls back to a letter mark.
 */
export const FRAMEWORKS = [
  { name: "Next.js", icon: "nextdotjs", kind: "Full-stack" },
  { name: "Astro", icon: "astro", kind: "Content" },
  { name: "Nuxt", icon: "nuxt", kind: "Full-stack" },
  { name: "SvelteKit", icon: "svelte", kind: "Full-stack" },
  { name: "Remix", icon: "remix", kind: "Full-stack" },
  { name: "React Router", icon: "reactrouter", kind: "Routing" },
  { name: "TanStack", icon: "tanstack", kind: "Routing" },
  { name: "Expo Router", icon: "expo", kind: "Mobile" },
  { name: "SolidStart", icon: "solid", kind: "Full-stack" },
  { name: "Qwik City", icon: "qwik", kind: "Full-stack" },
  { name: "Angular", icon: "angular", kind: "Frontend" },
  { name: "Express", icon: "express", kind: "Backend" },
  { name: "Fastify", icon: "fastify", kind: "Backend" },
  { name: "Hono", icon: "hono", kind: "Backend" },
  { name: "Elysia", icon: undefined, kind: "Backend" },
  { name: "Koa", icon: "koa", kind: "Backend" },
  { name: "AdonisJS", icon: "adonisjs", kind: "Backend" },
  { name: "NestJS", icon: "nestjs", kind: "Backend" }
] as const;

/** How each language family is read. */
export const LANGUAGE_TIERS = [
  {
    title: "Full syntax trees",
    note: "Exports, symbols and imports read with ts-morph.",
    items: ["TypeScript", "JavaScript", "Vue", "Svelte", "Astro"]
  },
  {
    title: "Pattern matching",
    note: "Imports, exports and declarations.",
    items: ["Python", "PHP", "Go", "Ruby", "C#", "Java"]
  }
] as const;
