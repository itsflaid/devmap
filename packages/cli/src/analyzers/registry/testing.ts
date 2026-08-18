import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Testing",
    category: "feature",
    purpose: "Contains test suites, mocks, and testing infrastructure.",
    genericTerms: [
      "vitest", "jest", "@testing-library", "playwright",
      "cypress", "supertest", "msw",
      "test", "spec", "mock", "fixture",
    ],
  },
];