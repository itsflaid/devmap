import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Search",
    category: "feature",
    minimumDistinctFiles: 2,
    purpose: "Handles full-text search, indexing, and faceted filtering.",
    genericTerms: [
      "meilisearch", "typesense", "algolia", "@algolia",
      "elasticsearch", "@elastic/elasticsearch",
      "orama", "@orama",
      "search", "fulltext", "index", "facet",
    ],
  },
];