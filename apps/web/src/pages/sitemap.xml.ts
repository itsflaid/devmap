import type { APIRoute } from "astro";
import { PAGES, SITE_URL } from "../lib/site";

const lastmod = new Date().toISOString().slice(0, 10);

export const GET: APIRoute = ({ site }) => {
  const base = (site?.href ?? SITE_URL).replace(/\/+$/, "");
  const urls = PAGES.map((page) => [
    "  <url>",
    `    <loc>${base}${page.path === "/" ? "/" : page.path}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${page.changefreq}</changefreq>`,
    `    <priority>${page.priority}</priority>`,
    "  </url>"
  ].join("\n"));

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } }
  );
};
