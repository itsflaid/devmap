import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FeatureInfo } from "../analyzers/features/featureDetector.js";
import type { ProjectMap } from "../analyzers/pipeline/projectMap.js";

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

  // Dedup by id — safety net for features that generate the same id,
  // e.g. "Checklist Item Management" and "checklist-item Management"
  // both resolve to "checklist-item-management". First-seen wins.
  const seenIds = new Set<string>();
  const dedupedFeatures = snapshot.features.filter((feature) => {
    const id = featureId(feature.name);
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });

  const featureIndexes = dedupedFeatures.map((feature) =>
    createFeatureIndex(feature, snapshot)
  );
  const featurePaths: string[] = [];

  for (const feature of dedupedFeatures) {
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
      frameworks: snapshot.project.frameworks,
      language: snapshot.project.language,
      packageManager: snapshot.project.packageManager,
      projectType: snapshot.project.projectType,
      workspaceType: snapshot.project.workspaceType,
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
  const candidates = new Set<string>();

  for (const path of snapshot.entryPoints) {
    candidates.add(path);
  }

  for (const feature of snapshot.features) {
    if (feature.name === "Documentation") continue;
    if (feature.entryPoint) candidates.add(feature.entryPoint);
    feature.entryPoints.forEach((path) => candidates.add(path));
    feature.files.forEach((path) => candidates.add(path));
  }

  for (const flow of snapshot.flows) {
    if (flow.entryPoint) candidates.add(flow.entryPoint);
    flow.steps.forEach((step) => {
      if (step.file) candidates.add(step.file);
    });
  }

  for (const critical of snapshot.criticalFiles) {
    candidates.add(critical.path);
  }

  return [...candidates]
    .filter((path) => {
      const metadata = snapshot.fileIndex[path];
      return metadata && metadata.scope !== "docs" && metadata.scope !== "test";
    })
    .sort((left, right) =>
      calculateStartHereScore(right, snapshot) - calculateStartHereScore(left, snapshot)
      || left.localeCompare(right)
    )
    .slice(0, 8);
}

function calculateStartHereScore(path: string, snapshot: ProjectMap): number {
  const metadata = snapshot.fileIndex[path];
  const entryIndex = snapshot.entryPoints.indexOf(path);
  const flowOwnership = snapshot.flows.filter((flow) =>
    flow.entryPoint === path || flow.steps.some((step) => step.file === path)
  ).length;
  const featureOwnership = snapshot.features.filter((feature) =>
    feature.entryPoint === path || feature.entryPoints.includes(path)
  ).length;
  const commandBonus = metadata?.scope === "cli" ? 500 : 0;
  const commandPathBonus = /(^|\/)commands?\//.test(path) ? 300 : 0;

  return (entryIndex >= 0 ? 1_000_000 - entryIndex * 10_000 : 0)
    + commandBonus
    + commandPathBonus
    + flowOwnership * 120
    + featureOwnership * 100
    + (metadata?.featureRefs.length ?? 0) * 40
    + (metadata?.importance ?? 0);
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
  const language = formatLabel(snapshot.project.language);
  const projectKind = describeProjectKind(snapshot);
  const featureNames = snapshot.features
    .filter((feature) => feature.confidence !== "low")
    .map((feature) => feature.name)
    .slice(0, 4);
  const featureText = featureNames.length > 0
    ? ` Main capabilities: ${featureNames.join(", ")}.`
    : "";
  const description = snapshot.project.description?.trim();
  const descriptionText = description
    ? ` ${description.replace(/[.!?]+$/, "")}.`
    : "";

  return `${snapshot.project.name} is a ${language} ${projectKind}.${descriptionText}${featureText}`;
}

function describeProjectKind(snapshot: ProjectMap): string {
  const workspace = snapshot.project.workspaceType === "monorepo" ? "monorepo" : "project";
  if (snapshot.project.projectType === "node-cli") return `${workspace} centered on a Node.js CLI`;
  if (snapshot.project.projectType === "web-app") return `${workspace} containing a web application`;
  if (snapshot.project.projectType === "api-service") return `${workspace} containing an API service`;
  if (snapshot.project.projectType === "library") return `${workspace} containing a reusable library`;
  return workspace;
}

function formatLabel(value: string): string {
  if (value === "typescript") return "TypeScript";
  if (value === "javascript") return "JavaScript";
  return value.charAt(0).toUpperCase() + value.slice(1);
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
