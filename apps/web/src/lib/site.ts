/** One place for the facts every page and every feed repeats. */
export const SITE_URL = (process.env.SITE_URL ?? "https://devmap-web.vercel.app").replace(/\/+$/, "");

export const SITE = {
  name: "DevMap",
  url: SITE_URL,
  title: "DevMap: analyze once, reuse context everywhere",
  description:
    "DevMap is a CLI that maps your codebase once: entry points, critical files, features and routes for developers and AI agents to start from.",
  ogImage: "/og.png",
  ogImageAlt: "DevMap: analyze once, reuse context everywhere",
  github: "https://github.com/itsflaid/devmap",
  npm: "https://www.npmjs.com/package/@flaid/devmap",
  author: "Muhammad Fadil",
  authorUrl: "https://www.flaid.my.id"
} as const;

/** Pages that exist, for the sitemap. Keep in step with `src/pages`. */
export const PAGES = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/docs", changefreq: "weekly", priority: "0.9" }
] as const;
