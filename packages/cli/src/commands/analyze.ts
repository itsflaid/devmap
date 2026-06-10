import { resolve } from "node:path";
import { createProjectMap } from "../analyzers/projectMap.js";
import { inspectSnapshot, saveSnapshot } from "../cache/snapshot.js";
import { output } from "../utils/output.js";

export type AnalyzeOptions = {
  deep?: boolean;
  fresh?: boolean;
};

export async function analyzeCommand(target = ".", options: AnalyzeOptions = {}): Promise<void> {
  const projectRoot = resolve(target);

  output.section("DevMap Analyze");
  output.step(`Scanning ${projectRoot}`);

  const snapshot = await createProjectMap(projectRoot);
  const previous = options.fresh ? { status: "missing" as const } : await inspectSnapshot(projectRoot);

  if (previous.status === "valid" && previous.snapshot.fingerprint === snapshot.fingerprint) {
    printSnapshot(previous.snapshot, options.deep);
    output.success("Project is unchanged. Reused existing snapshot.");
    return;
  }

  await saveSnapshot(projectRoot, snapshot);
  printSnapshot(snapshot, options.deep);

  output.success("Snapshot saved to .devmap/snapshot.json");
  if (options.fresh) {
    output.success("Fresh analysis completed");
  }
}

function printSnapshot(
  snapshot: Awaited<ReturnType<typeof createProjectMap>>,
  deep = false
): void {
  output.keyValue("Project", snapshot.project.name);
  output.keyValue("Framework", snapshot.project.framework);
  output.keyValue("Language", snapshot.project.language);
  output.keyValue("Package Manager", snapshot.project.packageManager);
  output.keyValue("Files", snapshot.stats.relevantFiles);
  output.keyValue("Lines", snapshot.stats.totalLines);

  printList("Entry Points", snapshot.entryPoints);
  printList(
    "Critical Files",
    snapshot.criticalFiles.map((file) => `${file.path} (${file.reasons.join(", ")})`)
  );
  printList("Routes", snapshot.routes.map((route) => `${route.path} -> ${route.file}`));
  printList("External Services", snapshot.externalServices);
  printList("Features", snapshot.features.map((feature) => feature.name));

  if (snapshot.database) {
    output.section("Database");
    output.item(snapshot.database.provider);
  }

  if (deep) {
    output.section("Module Breakdown");
    for (const file of snapshot.criticalFiles.slice(0, 5)) {
      output.item(`${file.path}: ${file.reasons.join(", ")}`);
    }
  }
}

function printList(title: string, values: string[]): void {
  output.section(title);
  if (values.length === 0) {
    output.note("None detected yet");
    return;
  }

  for (const value of values) {
    output.item(value);
  }
}
