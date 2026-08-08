import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createProjectFingerprint,
  SNAPSHOT_SCHEMA_VERSION,
  type ProjectMap
} from "../analyzers/pipeline/index.js";
import { scanFiles } from "../analyzers/analysis/index.js";
import {
  BACKEND_FRAMEWORKS,
  FRONTEND_FRAMEWORKS,
} from "../analyzers/pipeline/projectMetadata.js";
import { DevmapError } from "../utils/errors.js";

export type SnapshotStatus =
  | { status: "missing" }
  | { status: "valid"; snapshot: ProjectMap }
  | { status: "corrupt"; error: string }
  | { status: "unsupported"; version: string };

export function getSnapshotPath(projectRoot: string): string {
  return join(projectRoot, ".devmap", "snapshot.json");
}

export async function saveSnapshot(projectRoot: string, snapshot: ProjectMap): Promise<void> {
  const path = getSnapshotPath(projectRoot);
  await mkdir(join(projectRoot, ".devmap"), { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export async function isSnapshotStale(
  projectRoot: string,
  snapshot: ProjectMap
): Promise<boolean> {
  const files = await scanFiles(projectRoot);
  return createProjectFingerprint(files) !== snapshot.fingerprint;
}

export async function readSnapshot(projectRoot: string): Promise<ProjectMap | null> {
  const result = await inspectSnapshot(projectRoot);
  return result.status === "valid" ? result.snapshot : null;
}

export async function readSnapshotOrThrow(projectRoot: string): Promise<ProjectMap> {
  const result = await inspectSnapshot(projectRoot);

  if (result.status === "valid") {
    return result.snapshot;
  }

  if (result.status === "unsupported") {
    throw new DevmapError(
      `Snapshot schema ${result.version} is not supported by this DevMap version.`,
      "Run devmap analyze --fresh to regenerate the snapshot."
    );
  }

  if (result.status === "corrupt") {
    throw new DevmapError(
      "The DevMap snapshot is corrupt or incomplete.",
      "Run devmap analyze --fresh to regenerate .devmap/snapshot.json."
    );
  }

  throw new DevmapError(
    "No DevMap snapshot was found.",
    "Run devmap analyze first."
  );
}

export async function inspectSnapshot(projectRoot: string): Promise<SnapshotStatus> {
  try {
    const raw = await readFile(getSnapshotPath(projectRoot), "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!isRecord(parsed)) {
      return { status: "corrupt", error: "Snapshot root must be an object." };
    }

    if (typeof parsed.version !== "string") {
      return { status: "corrupt", error: "Snapshot version is missing." };
    }

    if (parsed.version !== SNAPSHOT_SCHEMA_VERSION) {
      return { status: "unsupported", version: parsed.version };
    }

    if (
      typeof parsed.generatedAt !== "string"
      || typeof parsed.fingerprint !== "string"
      || !isRecord(parsed.project)
      || !isRecord(parsed.fileIndex)
      || !Array.isArray(parsed.entryPoints)
      || !Array.isArray(parsed.criticalFiles)
      || !Array.isArray(parsed.routes)
      || !Array.isArray(parsed.apiRoutes)
      || !Array.isArray(parsed.features)
    ) {
      return { status: "corrupt", error: "Snapshot is missing required fields." };
    }

    if (!Object.values(parsed.fileIndex).every(isFileIndexEntry)) {
      return { status: "corrupt", error: "fileIndex contains invalid entries." };
    }

    normalizeSnapshotDefaults(parsed);

    return { status: "valid", snapshot: parsed as ProjectMap };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { status: "missing" };
    }

    return {
      status: "corrupt",
      error: error instanceof Error ? error.message : "Unknown snapshot error."
    };
  }
}

function normalizeSnapshotDefaults(snapshot: Record<string, unknown>): void {
  if (!isRecord(snapshot.agentInstructions)) {
    snapshot.agentInstructions = {
      navigationPolicy: "index-first",
      defaultMode: "feature-map-first",
      maxInitialFiles: 3,
      missingSnapshotAction: "run-devmap-analyze",
      staleSnapshotAction: "run-devmap-analyze-fresh",
      fallbackRule: "Read snapshot.json only when index.json and feature maps are insufficient; inspect extra source only when exact implementation is required."
    };
  } else if (snapshot.agentInstructions.navigationPolicy === "snapshot-first") {
    snapshot.agentInstructions.navigationPolicy = "index-first";
    snapshot.agentInstructions.defaultMode = "feature-map-first";
    snapshot.agentInstructions.fallbackRule = "Read snapshot.json only when index.json and feature maps are insufficient; inspect extra source only when exact implementation is required.";
  }

  if (!Array.isArray(snapshot.flows)) {
    snapshot.flows = [];
  }
  if (!isRecord(snapshot.onboarding)) {
    snapshot.onboarding = { recommendedPath: [] };
  }
  if (!isRecord(snapshot.changeImpact)) {
    snapshot.changeImpact = {};
  }

  if (isRecord(snapshot.project)) {
    if (typeof snapshot.project.projectType !== "string") {
      const framework = String(snapshot.project.framework);
      snapshot.project.projectType = FRONTEND_FRAMEWORKS.has(framework as never)
        ? "web-app"
        : BACKEND_FRAMEWORKS.has(framework as never)
        ? "api-service"
        : "unknown";
    }
    if (typeof snapshot.project.workspaceType !== "string") {
      snapshot.project.workspaceType = "single-package";
    }
    if (!Array.isArray(snapshot.project.frameworks)) {
      snapshot.project.frameworks = snapshot.project.framework === "unknown"
        ? []
        : [snapshot.project.framework];
    }
  }

  const fileIndex = snapshot.fileIndex as Record<string, Record<string, unknown>>;
  for (const entry of Object.values(fileIndex)) {
    if (typeof entry.analyzer !== "string") entry.analyzer = "heuristic";
    if (!["high", "medium", "low"].includes(String(entry.analysisConfidence))) {
      entry.analysisConfidence = "medium";
    }
    if (!Array.isArray(entry.symbols)) entry.symbols = [];
    if (typeof entry.scope !== "string") entry.scope = "unknown";
    if (!Array.isArray(entry.featureRefs)) entry.featureRefs = [];
    if (!Array.isArray(entry.searchTerms)) entry.searchTerms = [];
    if (!Array.isArray(entry.topFunctions)) entry.topFunctions = [];
    if (typeof entry.importance !== "number") entry.importance = 0;
  }

  for (const feature of snapshot.features as unknown[]) {
    if (!isRecord(feature)) {
      continue;
    }

    if (typeof feature.purpose !== "string") {
      feature.purpose = typeof feature.name === "string"
        ? `Identifies ${feature.name.toLowerCase()} capability in the project.`
        : "Identifies a project capability.";
    }
    if (!Array.isArray(feature.files)) feature.files = Array.isArray(feature.evidence) ? feature.evidence : [];
    if (!Array.isArray(feature.entryPoints)) feature.entryPoints = [];
    if (typeof feature.entryPoint !== "string") delete feature.entryPoint;
    if (!Array.isArray(feature.businessFlow)) feature.businessFlow = [];
    if (!Array.isArray(feature.searchTerms)) feature.searchTerms = [];
    if (!["high", "medium", "low"].includes(String(feature.confidence))) {
      feature.confidence = "medium";
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileIndexEntry(value: unknown): boolean {
  return (
    isRecord(value)
    && typeof value.hash === "string"
    && Array.isArray(value.imports)
    && Array.isArray(value.exportedSymbols)
    && typeof value.lines === "number"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
