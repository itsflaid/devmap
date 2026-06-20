export type FileRole =
  | "documentation"
  | "landing-ui"
  | "ai-integration"
  | "analysis-engine"
  | "snapshot-engine"
  | "cli-command"
  | "test"
  | "application-source";

export function classifyFileRole(path: string): FileRole {
  const normalized = path.toLowerCase();
  const name = normalized.split("/").at(-1) ?? normalized;

  if (isTestPath(normalized)) return "test";
  if (name.endsWith(".md") || normalized.startsWith("docs/")) return "documentation";
  if (
    /(^|\/)(landing|marketing)(\/|$)/.test(normalized)
    || /(^|\/)src\/pages\/index\.astro$/.test(normalized)
    || /(^|\/)(hero|pricing|testimonials?|features?section)[^/]*\.(astro|tsx?|jsx?|vue|svelte)$/.test(normalized)
  ) {
    return "landing-ui";
  }
  if (/(^|\/)src\/ai\//.test(normalized) || /(^|\/)ai\//.test(normalized)) {
    return "ai-integration";
  }
  if (
    /(^|\/)src\/cache\//.test(normalized)
    || /(^|\/)(cache|snapshot)(\/|$)/.test(normalized)
    || /(^|\/)snapshot\.[cm]?[jt]sx?$/.test(normalized)
  ) {
    return "snapshot-engine";
  }
  if (
    /(^|\/)src\/analyzers?\//.test(normalized)
    || /(^|\/)(analyzers?|detectors?|scanner)(\/|$)/.test(normalized)
  ) {
    return "analysis-engine";
  }
  if (
    /(^|\/)src\/commands?\//.test(normalized)
    || /(^|\/)(commands?|bin)(\/|$)/.test(normalized)
  ) {
    return "cli-command";
  }

  return "application-source";
}

export function isTechnicalFeatureSource(path: string): boolean {
  const role = classifyFileRole(path);
  return role !== "documentation" && role !== "landing-ui" && role !== "test";
}

function isTestPath(path: string): boolean {
  return (
    /(^|\/)(__tests__|fixtures?|tests?)(\/|$)/.test(path)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
  );
}
