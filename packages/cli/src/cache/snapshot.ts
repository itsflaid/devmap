import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectMap } from "../analyzers/projectMap.js";

export function getSnapshotPath(projectRoot: string): string {
  return join(projectRoot, ".devmap", "snapshot.json");
}

export async function saveSnapshot(projectRoot: string, snapshot: ProjectMap): Promise<void> {
  const path = getSnapshotPath(projectRoot);
  await mkdir(join(projectRoot, ".devmap"), { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export async function readSnapshot(projectRoot: string): Promise<ProjectMap | null> {
  try {
    const raw = await readFile(getSnapshotPath(projectRoot), "utf8");
    return JSON.parse(raw) as ProjectMap;
  } catch {
    return null;
  }
}
