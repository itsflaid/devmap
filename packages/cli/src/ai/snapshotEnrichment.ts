import type { ProjectMap } from "../analyzers/projectMap.js";
import type { AiClient, AiMessage } from "./types.js";

const FILE_BATCH_SIZE = 20;
const MAX_SEARCH_TERMS = 8;

export async function enrichSnapshotWithAi(
  snapshot: ProjectMap,
  client: AiClient,
  model: string,
  fallbackModel: string
): Promise<ProjectMap> {
  let enriched = snapshot;

  for (const batch of chunk(selectEligibleFiles(enriched), FILE_BATCH_SIZE)) {
    const updates = await completeJsonArray<FilePurposeResult>(
      client,
      buildFilePurposeMessages(batch),
      model,
      fallbackModel
    );

    if (updates.length === 0) {
      continue;
    }

    enriched = applyFilePurposeUpdates(enriched, updates);
  }

  if (enriched.features.length > 0) {
    const featureUpdates = await completeJsonArray<FeatureTermsResult>(
      client,
      buildFeatureTermsMessages(enriched),
      model,
      fallbackModel
    );

    if (featureUpdates.length > 0) {
      enriched = applyFeatureUpdates(enriched, featureUpdates);
    }
  }

  return enriched;
}

type FilePurposeInput = {
  path: string;
  scope: string;
  exports: string[];
  imports: string[];
  featureRefs: string[];
  importance: number;
};

type FilePurposeResult = {
  path?: unknown;
  purpose?: unknown;
  searchTerms?: unknown;
};

type FeatureTermsResult = {
  name?: unknown;
  purpose?: unknown;
  searchTerms?: unknown;
};

function selectEligibleFiles(snapshot: ProjectMap): FilePurposeInput[] {
  const criticalPaths = new Set(snapshot.criticalFiles.map((file) => file.path));

  return Object.entries(snapshot.fileIndex)
    .filter(([path, file]) =>
      file.scope !== "test"
      && file.scope !== "docs"
      && (criticalPaths.has(path) || file.importance >= 20)
    )
    .map(([path, file]) => ({
      path,
      scope: file.scope,
      exports: file.exportedSymbols.slice(0, 8),
      imports: file.imports.slice(0, 8),
      featureRefs: file.featureRefs.slice(0, 5),
      importance: file.importance
    }));
}

function buildFilePurposeMessages(files: FilePurposeInput[]): AiMessage[] {
  return [
    {
      role: "system",
      content: [
        "You summarize codebase files for a compact DevMap snapshot.",
        "Return a JSON array only.",
        "Each item must have path, purpose, and searchTerms.",
        "purpose must be one sentence maximum and describe what the file does.",
        "searchTerms must be max 8 concrete retrieval terms.",
        "Avoid vague terms: data, logic, handler, service, feature, app, page.",
        "Do not invent files, frameworks, or behavior not supported by the input."
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify(files, null, 2)
    }
  ];
}

function buildFeatureTermsMessages(snapshot: ProjectMap): AiMessage[] {
  const features = snapshot.features.map((feature) => ({
    name: feature.name,
    files: feature.files,
    entryPoints: feature.entryPoints,
    currentSearchTerms: feature.searchTerms
  }));

  return [
    {
      role: "system",
      content: [
        "You improve feature metadata for a compact repository snapshot.",
        "Return a JSON array only.",
        "Each item must have name, purpose, and searchTerms.",
        "purpose must be one sentence maximum.",
        "searchTerms must be max 8 concrete retrieval terms.",
        "Avoid vague terms: data, logic, handler, service, feature, app, page.",
        "Do not invent files or project-specific paths."
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify(features, null, 2)
    }
  ];
}

async function completeJsonArray<T>(
  client: AiClient,
  messages: AiMessage[],
  model: string,
  fallbackModel: string
): Promise<T[]> {
  try {
    const response = await client.complete({
      messages,
      model,
      fallbackModel,
      maxCompletionTokens: 900,
      temperature: 0
    });
    const parsed = JSON.parse(response.content) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function applyFilePurposeUpdates(
  snapshot: ProjectMap,
  updates: FilePurposeResult[]
): ProjectMap {
  const fileIndex = { ...snapshot.fileIndex };

  for (const update of updates) {
    if (typeof update.path !== "string" || !fileIndex[update.path]) {
      continue;
    }

    const purpose = normalizePurpose(update.purpose);
    const searchTerms = normalizeSearchTerms(update.searchTerms);
    fileIndex[update.path] = {
      ...fileIndex[update.path],
      ...(purpose ? { purpose } : {}),
      searchTerms: mergeTerms(fileIndex[update.path].searchTerms, searchTerms)
    };
  }

  return { ...snapshot, fileIndex };
}

function applyFeatureUpdates(
  snapshot: ProjectMap,
  updates: FeatureTermsResult[]
): ProjectMap {
  return {
    ...snapshot,
    features: snapshot.features.map((feature) => {
      const update = updates.find((item) => item.name === feature.name);
      if (!update) {
        return feature;
      }

      const purpose = normalizePurpose(update.purpose);
      const searchTerms = normalizeSearchTerms(update.searchTerms);
      return {
        ...feature,
        ...(purpose ? { purpose } : {}),
        searchTerms: mergeTerms(feature.searchTerms, searchTerms)
      };
    })
  };
}

function normalizePurpose(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.split(/(?<=[.!?])\s+/)[0]?.slice(0, 180) ?? null;
}

function normalizeSearchTerms(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 1 && item.split(/\s+/).length <= 3 && !isVagueTerm(item))
    .slice(0, MAX_SEARCH_TERMS);
}

function mergeTerms(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])].slice(0, 12);
}

function isVagueTerm(term: string): boolean {
  return new Set([
    "app",
    "data",
    "feature",
    "logic",
    "handler",
    "page",
    "service",
    "system"
  ]).has(term);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
