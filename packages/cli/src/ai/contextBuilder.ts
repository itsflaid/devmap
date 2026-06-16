import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ProjectMap } from "../analyzers/projectMap.js";

const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_LINES_PER_FILE = 200;
const NAVIGATION_MAX_FILES = 2;
const NAVIGATION_MAX_LINES_PER_FILE = 60;
const FOCUSED_MAX_FILES = 2;
const FOCUSED_MAX_LINES_PER_FILE = 60;
const MIN_RELEVANCE_SCORE = 25;
const HIGH_CONFIDENCE_SCORE = 70;
const MEDIUM_CONFIDENCE_SCORE = MIN_RELEVANCE_SCORE;

const STOP_WORDS = new Set([
  "about",
  "adalah",
  "a",
  "an",
  "apa",
  "bagaimana",
  "bekerja",
  "code",
  "dalam",
  "do",
  "does",
  "find",
  "feature",
  "file",
  "have",
  "dimana",
  "dengan",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "mana",
  "me",
  "my",
  "need",
  "project",
  "started",
  "the",
  "this",
  "to",
  "untuk",
  "where",
  "which",
  "want",
  "you",
  "youll",
  "yang"
]);

const INTENT_TERMS = {
  add_feature: new Set(["add", "build", "create", "implement", "make", "support"]),
  change: new Set(["change", "modify", "refactor", "update"]),
  debug: new Set(["bug", "debug", "error", "fail", "fails", "fix", "issue", "wrong"]),
  explain: new Set(["explain", "how", "what", "why"]),
  navigate: new Set(["find", "start", "where"])
} as const;

const ACTION_WORDS = new Set(
  Object.values(INTENT_TERMS).flatMap((terms) => [...terms])
);

const TEST_QUERY_TERMS = new Set([
  "coverage",
  "fixture",
  "fixtures",
  "spec",
  "specs",
  "test",
  "testing",
  "tests"
]);

const ENTRY_POINT_QUERY_TERMS = new Set([
  "entry",
  "entrypoint",
  "main",
  "start",
  "startup"
]);

const SCOPE_QUERY_TERMS = {
  cli: new Set(["cli", "command", "commands", "terminal"]),
  docs: new Set(["documentation", "docs", "readme"]),
  web: new Set(["component", "frontend", "page", "ui", "web"])
} as const;

const CONCEPT_ALIASES: Record<string, string[]> = {
  auth: [
    "auth",
    "authentication",
    "autentikasi",
    "login",
    "session",
    "sesi",
    "nextauth"
  ],
  database: ["database", "db", "data", "prisma", "drizzle", "mongoose", "supabase"],
  payment: ["payment", "payments", "pembayaran", "stripe", "midtrans", "checkout"],
  route: ["route", "routes", "routing", "api", "endpoint"],
  upload: ["upload", "unggah", "file", "multer", "cloudinary"],
  email: ["email", "mail", "resend", "nodemailer"],
  ai: ["ai", "openai", "groq", "gemini", "model", "prompt"],
  framework: ["framework", "frameworks", "detect", "detection", "detector"],
  config: ["config", "configuration", "settings", "setup"]
};

export type ContextBuilderOptions = {
  maxFiles?: number;
  maxLinesPerFile?: number;
};

export type ContextFile = {
  path: string;
  score: number;
  reasons: string[];
  exports: string[];
  topFunctions: Array<Record<string, unknown>>;
  purpose?: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
  content: string;
};

export type QuestionContext = {
  question: string;
  intent: QueryIntent;
  keywords: string[];
  confidence: RelevanceConfidence;
  topScore: number;
  relevantFiles: ContextFile[];
  files: ContextFile[];
};

export type QueryIntent = keyof typeof INTENT_TERMS | "general";
export type RelevanceConfidence = "high" | "medium" | "low";

type RankedFile = {
  path: string;
  score: number;
  reasons: string[];
  direct: boolean;
};

type QueryProfile = {
  intent: QueryIntent;
  includeTests: boolean;
  includeRelatedFiles: boolean;
  isNavigation: boolean;
  scopes: Set<keyof typeof SCOPE_QUERY_TERMS>;
};

export async function buildQuestionContext(
  projectRoot: string,
  snapshot: ProjectMap,
  question: string,
  options: ContextBuilderOptions = {}
): Promise<QuestionContext> {
  const keywords = extractContextKeywords(question);
  const profile = classifyQuery(question);
  const defaultMaxFiles = usesFocusedContext(profile.intent)
    ? FOCUSED_MAX_FILES
    : profile.isNavigation
    ? NAVIGATION_MAX_FILES
    : DEFAULT_MAX_FILES;
  const defaultMaxLines = usesFocusedContext(profile.intent)
    ? FOCUSED_MAX_LINES_PER_FILE
    : profile.isNavigation
    ? NAVIGATION_MAX_LINES_PER_FILE
    : DEFAULT_MAX_LINES_PER_FILE;
  const maxFiles = normalizeLimit(options.maxFiles, defaultMaxFiles);
  const maxLinesPerFile = normalizeLimit(
    options.maxLinesPerFile,
    defaultMaxLines
  );
  const rankedFiles = rankContextFiles(snapshot, keywords, profile);
  const topScore = rankedFiles[0]?.score ?? 0;
  const confidence = getRelevanceConfidence(topScore);
  const files: ContextFile[] = [];

  for (const rankedFile of rankedFiles) {
    if (files.length >= maxFiles) {
      break;
    }

    if (rankedFile.score < MIN_RELEVANCE_SCORE) {
      continue;
    }

    const selectedFile = await readContextFile(
      projectRoot,
      snapshot,
      rankedFile,
      keywords,
      maxLinesPerFile
    );

    if (selectedFile) {
      files.push(selectedFile);
    }
  }

  return {
    question,
    intent: profile.intent,
    keywords,
    confidence: files.length === 0 ? "low" : confidence,
    topScore,
    relevantFiles: files,
    files
  };
}

export function extractContextKeywords(question: string): string[] {
  const baseWords = tokenizeQuestion(question)
    .filter((word) =>
      word.length > 1
      && !STOP_WORDS.has(word)
      && !ACTION_WORDS.has(word)
    );
  const keywords = new Set(baseWords);

  for (const aliases of Object.values(CONCEPT_ALIASES)) {
    if (aliases.some((alias) => keywords.has(alias))) {
      aliases.forEach((alias) => keywords.add(alias));
    }
  }

  return [...keywords];
}

function rankContextFiles(
  snapshot: ProjectMap,
  keywords: string[],
  profile: QueryProfile
): RankedFile[] {
  const ranked = new Map<string, RankedFile>();

  for (const [path, metadata] of Object.entries(snapshot.fileIndex)) {
    if (!profile.includeTests && isTestPath(path)) {
      continue;
    }

    const reasons: string[] = [];
    const normalizedPath = path.toLowerCase();
    const pathTerms = splitSearchTerms(path);
    const symbols = metadata.exportedSymbols.join(" ").toLowerCase();
    const symbolTerms = splitSearchTerms(metadata.exportedSymbols.join(" "));
    const imports = metadata.imports.join(" ").toLowerCase();
    let score = 0;

    for (const keyword of keywords) {
      if (pathTerms.has(keyword)) {
        score += 30;
        reasons.push(`path term matches "${keyword}"`);
      } else if (normalizedPath.includes(keyword)) {
        score += 6;
        reasons.push(`path contains "${keyword}"`);
      }

      if (symbolTerms.has(keyword)) {
        score += 26;
        reasons.push(`export term matches "${keyword}"`);
      } else if (symbols.includes(keyword)) {
        score += 8;
        reasons.push(`export contains "${keyword}"`);
      }

      if (imports.includes(keyword)) {
        score += 3;
        reasons.push(`dependency matches "${keyword}"`);
      }
    }

    const featureScore = scoreFeatureEvidence(snapshot, path, keywords);
    score += featureScore.score;
    reasons.push(...featureScore.reasons);

    const routeScore = scoreRouteEvidence(snapshot, path, keywords);
    score += routeScore.score;
    reasons.push(...routeScore.reasons);

    const entryPointScore = scoreEntryPointEvidence(snapshot, path, keywords);
    score += entryPointScore.score;
    reasons.push(...entryPointScore.reasons);

    const scopeScore = scoreScopeEvidence(path, profile.scopes);
    score += scopeScore.score;
    reasons.push(...scopeScore.reasons);

    const criticalFile = snapshot.criticalFiles.find((file) => file.path === path);
    if (criticalFile && score > 0) {
      score += Math.min(criticalFile.score, 5);
      reasons.push("critical project file");
    }

    if (score > 0) {
      ranked.set(path, {
        path,
        score,
        reasons: unique(reasons),
        direct: true
      });
    }
  }

  if (profile.includeRelatedFiles) {
    expandGraphNeighbors(snapshot, ranked, profile);
  }

  return [...ranked.values()]
    .sort((left, right) =>
      right.score - left.score
      || Number(right.direct) - Number(left.direct)
      || left.path.localeCompare(right.path)
    );
}

function scoreFeatureEvidence(
  snapshot: ProjectMap,
  path: string,
  keywords: string[]
): Pick<RankedFile, "score" | "reasons"> {
  let score = 0;
  const reasons: string[] = [];

  for (const feature of snapshot.features) {
    const featureTerms = extractContextKeywords(feature.name);
    if (
      feature.evidence.includes(path)
      && featureTerms.some((term) => keywords.includes(term))
    ) {
      score += 10;
      reasons.push(`evidence for ${feature.name}`);
    }
  }

  return { score, reasons };
}

function scoreRouteEvidence(
  snapshot: ProjectMap,
  path: string,
  keywords: string[]
): Pick<RankedFile, "score" | "reasons"> {
  let score = 0;
  const reasons: string[] = [];

  for (const route of snapshot.routes.filter((item) => item.file === path)) {
    const routeText = `${route.path} ${(route.methods ?? []).join(" ")}`.toLowerCase();
    if (keywords.some((keyword) => routeText.includes(keyword))) {
      score += 30;
      reasons.push(`handles route ${route.path}`);
    }
  }

  return { score, reasons };
}

function scoreEntryPointEvidence(
  snapshot: ProjectMap,
  path: string,
  keywords: string[]
): Pick<RankedFile, "score" | "reasons"> {
  if (
    snapshot.entryPoints.includes(path)
    && keywords.some((keyword) => ENTRY_POINT_QUERY_TERMS.has(keyword))
  ) {
    return {
      score: 30,
      reasons: ["project entry point"]
    };
  }

  return { score: 0, reasons: [] };
}

function expandGraphNeighbors(
  snapshot: ProjectMap,
  ranked: Map<string, RankedFile>,
  profile: QueryProfile
): void {
  const directMatches = [...ranked.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, DEFAULT_MAX_FILES);

  for (const match of directMatches) {
    const imports = snapshot.fileIndex[match.path]?.imports ?? [];
    for (const importedPath of imports) {
      if (!profile.includeTests && isTestPath(importedPath)) {
        continue;
      }

      addRelatedFile(
        ranked,
        importedPath,
        Math.max(MIN_RELEVANCE_SCORE, Math.floor(match.score / 4)),
        `imported by relevant file ${match.path}`
      );
    }

    for (const [candidatePath, metadata] of Object.entries(snapshot.fileIndex)) {
      if (!profile.includeTests && isTestPath(candidatePath)) {
        continue;
      }

      if (metadata.imports.includes(match.path)) {
        addRelatedFile(
          ranked,
          candidatePath,
          Math.max(MIN_RELEVANCE_SCORE, Math.floor(match.score / 5)),
          `imports relevant file ${match.path}`
        );
      }
    }
  }
}

function classifyQuery(question: string): QueryProfile {
  const terms = new Set(tokenizeQuestion(question));
  const scopes = new Set<keyof typeof SCOPE_QUERY_TERMS>();
  const intent = detectIntent(terms);

  for (const [scope, scopeTerms] of Object.entries(SCOPE_QUERY_TERMS) as Array<
    [keyof typeof SCOPE_QUERY_TERMS, Set<string>]
  >) {
    if ([...scopeTerms].some((term) => terms.has(term))) {
      scopes.add(scope);
    }
  }

  return {
    intent,
    includeTests: [...TEST_QUERY_TERMS].some((term) => terms.has(term)),
    includeRelatedFiles: !usesFocusedContext(intent),
    isNavigation: intent === "navigate",
    scopes
  };
}

function usesFocusedContext(intent: QueryIntent): boolean {
  return intent === "add_feature" || intent === "change" || intent === "navigate";
}

function detectIntent(terms: Set<string>): QueryIntent {
  for (const [intent, intentTerms] of Object.entries(INTENT_TERMS) as Array<
    [QueryIntent, Set<string>]
  >) {
    if ([...intentTerms].some((term) => terms.has(term))) {
      return intent;
    }
  }

  return "general";
}

function scoreScopeEvidence(
  path: string,
  scopes: Set<keyof typeof SCOPE_QUERY_TERMS>
): Pick<RankedFile, "score" | "reasons"> {
  const normalizedPath = path.toLowerCase().replaceAll("\\", "/");
  let score = 0;
  const reasons: string[] = [];

  if (
    scopes.has("cli")
    && (
      normalizedPath.includes("/cli/")
      || normalizedPath.startsWith("cli/")
      || normalizedPath.includes("/commands/")
    )
  ) {
    score += 8;
    reasons.push("matches CLI scope");
  }

  if (
    scopes.has("web")
    && (
      normalizedPath.includes("/web/")
      || normalizedPath.includes("/components/")
      || normalizedPath.includes("/pages/")
      || normalizedPath.includes("/app/")
    )
  ) {
    score += 8;
    reasons.push("matches web scope");
  }

  if (
    scopes.has("docs")
    && (normalizedPath.startsWith("docs/") || normalizedPath.endsWith(".md"))
  ) {
    score += 8;
    reasons.push("matches documentation scope");
  }

  return { score, reasons };
}

function isTestPath(path: string): boolean {
  const normalizedPath = path.toLowerCase().replaceAll("\\", "/");
  return (
    normalizedPath.startsWith("test/")
    || normalizedPath.startsWith("tests/")
    || normalizedPath.includes("/test/")
    || normalizedPath.includes("/tests/")
    || normalizedPath.includes("/__tests__/")
    || normalizedPath.includes("/fixtures/")
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalizedPath)
  );
}

function addRelatedFile(
  ranked: Map<string, RankedFile>,
  path: string,
  score: number,
  reason: string
): void {
  const existing = ranked.get(path);
  if (existing) {
    ranked.set(path, {
      ...existing,
      score: Math.max(existing.score, score),
      direct: existing.direct,
      reasons: unique([...existing.reasons, reason])
    });
    return;
  }

  ranked.set(path, {
    path,
    score,
    direct: false,
    reasons: [reason]
  });
}

async function readContextFile(
  projectRoot: string,
  snapshot: ProjectMap,
  rankedFile: RankedFile,
  keywords: string[],
  maxLines: number
): Promise<ContextFile | null> {
  const safePath = await resolveSafeProjectFile(projectRoot, rankedFile.path);
  if (!safePath) {
    return null;
  }

  const content = await readFile(safePath, "utf8").catch(() => null);
  if (content === null) {
    return null;
  }

  const lines = content.split(/\r?\n/);
  const window = selectRelevantWindow(lines, keywords, maxLines);

  return {
    ...rankedFile,
    exports: snapshot.fileIndex[rankedFile.path]?.exportedSymbols ?? [],
    topFunctions: [],
    startLine: window.start + 1,
    endLine: window.end,
    truncated: lines.length > maxLines,
    content: lines.slice(window.start, window.end).join("\n")
  };
}

async function resolveSafeProjectFile(
  projectRoot: string,
  snapshotPath: string
): Promise<string | null> {
  const root = await realpath(projectRoot);
  const candidate = resolve(root, snapshotPath);
  const candidateRelativePath = relative(root, candidate);

  if (
    candidateRelativePath === ""
    || candidateRelativePath.startsWith("..")
    || isAbsolute(candidateRelativePath)
  ) {
    return null;
  }

  const resolvedCandidate = await realpath(candidate).catch(() => null);
  if (!resolvedCandidate) {
    return null;
  }

  const resolvedRelativePath = relative(root, resolvedCandidate);
  if (resolvedRelativePath.startsWith("..") || isAbsolute(resolvedRelativePath)) {
    return null;
  }

  return resolvedCandidate;
}

function selectRelevantWindow(
  lines: string[],
  keywords: string[],
  maxLines: number
): { start: number; end: number } {
  if (lines.length <= maxLines) {
    return { start: 0, end: lines.length };
  }

  const matchingLine = lines.findIndex((line) => {
    const normalizedLine = line.toLowerCase();
    return keywords.some((keyword) => normalizedLine.includes(keyword));
  });
  const center = matchingLine >= 0 ? matchingLine : 0;
  const start = Math.min(
    Math.max(center - Math.floor(maxLines / 2), 0),
    lines.length - maxLines
  );

  return {
    start,
    end: start + maxLines
  };
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    return fallback;
  }

  return value as number;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function getRelevanceConfidence(topScore: number): RelevanceConfidence {
  if (topScore >= HIGH_CONFIDENCE_SCORE) {
    return "high";
  }

  if (topScore >= MEDIUM_CONFIDENCE_SCORE) {
    return "medium";
  }

  return "low";
}

function tokenizeQuestion(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function splitSearchTerms(value: string): Set<string> {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

  return new Set(tokenizeQuestion(spaced));
}
