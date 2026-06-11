import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ProjectMap } from "../analyzers/projectMap.js";

const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_LINES_PER_FILE = 200;

const STOP_WORDS = new Set([
  "about",
  "adalah",
  "apa",
  "bagaimana",
  "bekerja",
  "dalam",
  "does",
  "dimana",
  "dengan",
  "from",
  "how",
  "mana",
  "project",
  "the",
  "this",
  "untuk",
  "where",
  "which",
  "yang"
]);

const CONCEPT_ALIASES: Record<string, string[]> = {
  auth: ["auth", "authentication", "autentikasi", "login", "session", "sesi", "token", "jwt", "middleware"],
  database: ["database", "db", "data", "prisma", "drizzle", "mongoose", "supabase"],
  payment: ["payment", "payments", "pembayaran", "stripe", "midtrans", "checkout"],
  route: ["route", "routes", "routing", "api", "endpoint"],
  upload: ["upload", "unggah", "file", "multer", "cloudinary"],
  email: ["email", "mail", "resend", "nodemailer"],
  ai: ["ai", "openai", "groq", "gemini", "model", "prompt"]
};

export type ContextBuilderOptions = {
  maxFiles?: number;
  maxLinesPerFile?: number;
};

export type ContextFile = {
  path: string;
  score: number;
  reasons: string[];
  startLine: number;
  endLine: number;
  truncated: boolean;
  content: string;
};

export type QuestionContext = {
  question: string;
  keywords: string[];
  files: ContextFile[];
};

type RankedFile = {
  path: string;
  score: number;
  reasons: string[];
};

export async function buildQuestionContext(
  projectRoot: string,
  snapshot: ProjectMap,
  question: string,
  options: ContextBuilderOptions = {}
): Promise<QuestionContext> {
  const keywords = extractContextKeywords(question);
  const maxFiles = normalizeLimit(options.maxFiles, DEFAULT_MAX_FILES);
  const maxLinesPerFile = normalizeLimit(
    options.maxLinesPerFile,
    DEFAULT_MAX_LINES_PER_FILE
  );
  const rankedFiles = rankContextFiles(snapshot, keywords);
  const files: ContextFile[] = [];

  for (const rankedFile of rankedFiles) {
    if (files.length >= maxFiles) {
      break;
    }

    const selectedFile = await readContextFile(
      projectRoot,
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
    keywords,
    files
  };
}

export function extractContextKeywords(question: string): string[] {
  const baseWords = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  const keywords = new Set(baseWords);

  for (const aliases of Object.values(CONCEPT_ALIASES)) {
    if (aliases.some((alias) => keywords.has(alias))) {
      aliases.forEach((alias) => keywords.add(alias));
    }
  }

  return [...keywords];
}

function rankContextFiles(snapshot: ProjectMap, keywords: string[]): RankedFile[] {
  const ranked = new Map<string, RankedFile>();

  for (const [path, metadata] of Object.entries(snapshot.fileIndex)) {
    const reasons: string[] = [];
    const normalizedPath = path.toLowerCase();
    const symbols = metadata.exportedSymbols.join(" ").toLowerCase();
    const imports = metadata.imports.join(" ").toLowerCase();
    let score = 0;

    for (const keyword of keywords) {
      if (normalizedPath.includes(keyword)) {
        score += 8;
        reasons.push(`path matches "${keyword}"`);
      }

      if (symbols.includes(keyword)) {
        score += 6;
        reasons.push(`export matches "${keyword}"`);
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

    const criticalFile = snapshot.criticalFiles.find((file) => file.path === path);
    if (criticalFile && score > 0) {
      score += Math.min(criticalFile.score, 5);
      reasons.push("critical project file");
    }

    if (score > 0) {
      ranked.set(path, {
        path,
        score,
        reasons: unique(reasons)
      });
    }
  }

  expandGraphNeighbors(snapshot, ranked);

  if (ranked.size === 0) {
    addFallbackFiles(snapshot, ranked);
  }

  return [...ranked.values()]
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
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
      score += 8;
      reasons.push(`handles route ${route.path}`);
    }
  }

  return { score, reasons };
}

function expandGraphNeighbors(
  snapshot: ProjectMap,
  ranked: Map<string, RankedFile>
): void {
  const directMatches = [...ranked.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, DEFAULT_MAX_FILES);

  for (const match of directMatches) {
    const imports = snapshot.fileIndex[match.path]?.imports ?? [];
    for (const importedPath of imports) {
      addRelatedFile(
        ranked,
        importedPath,
        Math.max(4, Math.floor(match.score / 4)),
        `imported by relevant file ${match.path}`
      );
    }

    for (const [candidatePath, metadata] of Object.entries(snapshot.fileIndex)) {
      if (metadata.imports.includes(match.path)) {
        addRelatedFile(
          ranked,
          candidatePath,
          Math.max(3, Math.floor(match.score / 5)),
          `imports relevant file ${match.path}`
        );
      }
    }
  }
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
      score: existing.score + score,
      reasons: unique([...existing.reasons, reason])
    });
    return;
  }

  ranked.set(path, {
    path,
    score,
    reasons: [reason]
  });
}

function addFallbackFiles(
  snapshot: ProjectMap,
  ranked: Map<string, RankedFile>
): void {
  for (const criticalFile of snapshot.criticalFiles.slice(0, DEFAULT_MAX_FILES)) {
    ranked.set(criticalFile.path, {
      path: criticalFile.path,
      score: criticalFile.score,
      reasons: ["high-value project context"]
    });
  }
}

async function readContextFile(
  projectRoot: string,
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
