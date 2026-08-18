const NON_PRODUCTION_SEGMENTS = new Set([
  "__fixtures__",
  "__mocks__",
  "__tests__",
  "coverage",
  "demo",
  "docs",
  "example",
  "examples",
  "fixtures",
  "samples",
  "test",
  "tests"
]);

export function isArchitectureSource(path: string): boolean {
  const normalized = path.toLowerCase();
  const segments = normalized.split("/");

  if (segments.some((segment) => NON_PRODUCTION_SEGMENTS.has(segment))) {
    return false;
  }

  return !(
    normalized.endsWith(".test.ts")
    || normalized.endsWith(".test.tsx")
    || normalized.endsWith(".test.js")
    || normalized.endsWith(".test.jsx")
    || normalized.endsWith(".spec.ts")
    || normalized.endsWith(".spec.tsx")
    || normalized.endsWith(".spec.js")
    || normalized.endsWith(".spec.jsx")
  );
}
