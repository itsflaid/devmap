import { defineConfig } from "astro/config";

// `site` makes Astro.site (canonical URLs, sitemap, Open Graph) absolute. The
// same default lives in src/lib/site.ts; set SITE_URL to publish elsewhere.
export default defineConfig({
  site: (process.env.SITE_URL ?? "https://devmap-web.vercel.app").replace(/\/+$/, "")
});
