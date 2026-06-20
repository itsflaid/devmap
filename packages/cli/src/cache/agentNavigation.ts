import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FeatureInfo } from "../analyzers/featureDetector.js";
import type { ProjectMap } from "../analyzers/projectMap.js";

export type AgentNavigationWriteResult = {
  indexPath: string;
  featurePaths: string[];
};

type AgentFeatureIndex = {
  id: string;
  name: string;
  summary: string;
  keywords: string[];
  criticalFiles: string[];
  map: string;
};

export async function writeAgentNavigationFiles(
  projectRoot: string,
  snapshot: ProjectMap
): Promise<AgentNavigationWriteResult> {
  const devmapDirectory = join(projectRoot, ".devmap");
  const featureDirectory = join(devmapDirectory, "features");
  await mkdir(featureDirectory, { recursive: true });
  await removeStaleFeatureMaps(featureDirectory);

  const featureIndexes = snapshot.features.map((feature) =>
    createFeatureIndex(feature, snapshot)
  );
  const featurePaths: string[] = [];

  for (const feature of snapshot.features) {
    const id = featureId(feature.name);
    const path = join(featureDirectory, `${id}.json`);
    await writeJson(path, createFeatureMap(id, feature, snapshot));
    featurePaths.push(path);
  }

  const indexPath = join(devmapDirectory, "index.json");
  await writeJson(indexPath, {
    project: {
      name: snapshot.project.name,
      framework: snapshot.project.framework,
      language: snapshot.project.language,
      packageManager: snapshot.project.packageManager,
      summary: createProjectSummary(snapshot)
    },
    generatedAt: snapshot.generatedAt,
    entryPoints: snapshot.entryPoints.slice(0, 8),
    criticalFiles: selectIndexCriticalFiles(snapshot),
    features: featureIndexes,
    snapshot: {
      path: ".devmap/snapshot.json",
      usage: "last_resort_or_web_ai_copy_context"
    },
    agentInstructions: "Read this file first. Pick the relevant feature by keywords, open its feature map, then inspect only source files listed in sourcePriority. Do not read snapshot.json unless index.json and feature maps are insufficient."
  });

  return { indexPath, featurePaths };
}

function createFeatureIndex(feature: FeatureInfo, snapshot: ProjectMap): AgentFeatureIndex {
  const id = featureId(feature.name);
  return {
    id,
    name: feature.name,
    summary: feature.purpose,
    keywords: feature.searchTerms.slice(0, 8),
    criticalFiles: selectCriticalFiles(feature, snapshot),
    map: `.devmap/features/${id}.json`
  };
}

function createFeatureMap(id: string, feature: FeatureInfo, snapshot: ProjectMap) {
  const entryPoints = [...new Set([
    ...(feature.entryPoint ? [feature.entryPoint] : []),
    ...feature.entryPoints
  ])];
  const relatedFiles = feature.files
    .filter((path) => snapshot.fileIndex[path])
    .map((path) => ({
      path,
      role: snapshot.fileIndex[path]?.purpose ?? `Supports ${feature.name}.`
    }));
  const featureOrder = new Map(feature.files.map((path, index) => [path, index]));
  const sourcePriority = [...relatedFiles]
    .sort((left, right) => {
      const leftEntry = Number(entryPoints.includes(left.path));
      const rightEntry = Number(entryPoints.includes(right.path));
      return rightEntry - leftEntry
        || (featureOrder.get(left.path) ?? Number.MAX_SAFE_INTEGER)
          - (featureOrder.get(right.path) ?? Number.MAX_SAFE_INTEGER)
        || (snapshot.fileIndex[right.path]?.importance ?? 0)
          - (snapshot.fileIndex[left.path]?.importance ?? 0)
        || left.path.localeCompare(right.path);
    })
    .map((file) => file.path)
    .slice(0, 8);
  const flow = feature.businessFlow.filter((step) =>
    !/^Identify files related to /i.test(step)
  );

  return {
    id,
    name: feature.name,
    summary: feature.purpose,
    entryPoints,
    criticalFiles: selectCriticalFiles(feature, snapshot),
    relatedFiles,
    ...(flow.length > 1 ? { flow } : {}),
    keywords: feature.searchTerms.slice(0, 12),
    sourcePriority,
    confidence: feature.confidence
  };
}

function selectIndexCriticalFiles(snapshot: ProjectMap): string[] {
  const selected = new Set<string>();

  for (const path of snapshot.entryPoints) {
    selected.add(path);
  }

  for (const feature of snapshot.features) {
    if (feature.name === "Documentation") continue;
    if (feature.entryPoint) selected.add(feature.entryPoint);

    const supportingFile = feature.files.find((path) => {
      if (path === feature.entryPoint) return false;
      const metadata = snapshot.fileIndex[path];
      return metadata
        && metadata.scope !== "docs"
        && metadata.scope !== "test"
        && (metadata.topFunctions.length > 0 || ["api", "cli", "ui"].includes(metadata.scope));
    });
    if (supportingFile) selected.add(supportingFile);
  }

  for (const critical of snapshot.criticalFiles) {
    const metadata = snapshot.fileIndex[critical.path];
    if (!metadata || metadata.scope === "docs" || metadata.scope === "test") continue;
    if (metadata.topFunctions.length === 0 && metadata.scope !== "api" && metadata.scope !== "cli") {
      continue;
    }
    selected.add(critical.path);
  }

  return [...selected].slice(0, 8);
}

function selectCriticalFiles(feature: FeatureInfo, snapshot: ProjectMap): string[] {
  const featureFiles = new Set(feature.files);
  const critical = snapshot.criticalFiles
    .filter((file) => featureFiles.has(file.path))
    .map((file) => file.path);

  if (critical.length > 0) {
    return critical.slice(0, 5);
  }

  return [...feature.files]
    .filter((path) => snapshot.fileIndex[path])
    .sort((left, right) =>
      (snapshot.fileIndex[right]?.importance ?? 0)
      - (snapshot.fileIndex[left]?.importance ?? 0)
      || left.localeCompare(right)
    )
    .slice(0, 5);
}

function createProjectSummary(snapshot: ProjectMap): string {
  const stack = snapshot.project.framework === "unknown"
    ? snapshot.project.language
    : `${snapshot.project.framework} ${snapshot.project.language}`;
  const featureNames = snapshot.features
    .filter((feature) => feature.confidence !== "low")
    .map((feature) => feature.name)
    .slice(0, 4);
  const featureText = featureNames.length > 0
    ? ` Main concerns: ${featureNames.join(", ")}.`
    : "";

  return `${snapshot.project.name} is a ${stack} project with ${snapshot.stats.relevantFiles} analyzed files.${featureText}`;
}

function featureId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "feature";
}

async function removeStaleFeatureMaps(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => unlink(join(directory, entry.name))));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
