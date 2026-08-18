import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "CMS & Content",
    category: "feature",
    minimumDistinctFiles: 2,
    purpose: "Handles CMS integrations and structured content management.",
    genericTerms: [
      "contentlayer", "@contentlayer", "sanity", "@sanity",
      "contentful", "strapi", "payload", "keystatic",
      "notion", "@notionhq",
      "cms", "content", "mdx",
    ],
  },
];