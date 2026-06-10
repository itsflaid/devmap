import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createProjectFingerprint,
  SNAPSHOT_SCHEMA_VERSION,
  type ProjectMap
} from "../analyzers/projectMap.js";
import { scanFiles } from "../analyzers/fileScanner.js";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
