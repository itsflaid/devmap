// Test and fixture folders are never production code, at any depth.
const NON_PRODUCTION_SEGMENTS = new Set([
  "__fixtures__",
  "__mocks__",
  "__tests__",
  "__e2e__",
  "coverage",
  "cypress",
  "e2e",
  "fixtures",
  "test",
  "tests"
]);

// Sample material is only recognised where a repo keeps it (the root or a
// workspace member's root). A product feature that happens to live in
// src/features/demo or src/docs is real code.
const SAMPLE_SEGMENTS = new Set(["demo", "docs", "example", "examples", "samples"]);
const WORKSPACE_PARENTS = new Set(["apps", "packages", "libs", "services", "projects"]);

const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_test\.(?:py|go)$|(?:^|\/)conftest\.py$/;

/** Test, spec, fixture and mock files, including a root-level test/ folder. */
export function isTestPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return normalized.split("/").some((segment) => NON_PRODUCTION_SEGMENTS.has(segment))
    || TEST_FILE_PATTERN.test(normalized);
}

export function isArchitectureSource(path: string): boolean {
  const normalized = path.toLowerCase();
  const segments = normalized.split("/");

  if (isTestPath(normalized)) {
    return false;
  }

  if (SAMPLE_SEGMENTS.has(segments[0]) && segments.length > 1) {
    return false;
  }
  if (
    segments.length > 3
    && WORKSPACE_PARENTS.has(segments[0])
    && SAMPLE_SEGMENTS.has(segments[2])
  ) {
    return false;
  }

  return true;
}
