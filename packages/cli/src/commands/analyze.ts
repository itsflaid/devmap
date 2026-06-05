import { resolve } from "node:path";
import { createProjectMap } from "../analyzers/projectMap.js";
import { saveSnapshot } from "../cache/snapshot.js";
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
  await saveSnapshot(projectRoot, snapshot);

  output.keyValue("Project", projectRoot.split(/[\\/]/).at(-1) ?? projectRoot);
  output.keyValue("Framework", snapshot.framework);
  output.keyValue("Files", snapshot.stats.relevantFiles);
  output.keyValue("Lines", snapshot.stats.totalLines);

  printList("Entry Points", snapshot.entryPoints);
  printList(
    "Critical Files",
    snapshot.criticalFiles.map((file) => `${file.path} (${file.referencedBy} refs)`)
  );
  printList("External Services", snapshot.externalServices);

  if (options.deep) {
    output.section("Module Breakdown");
    for (const file of snapshot.criticalFiles.slice(0, 5)) {
      console.log(`${file.path}: referenced by ${file.referencedBy} files`);
    }
  }

  output.success("Snapshot saved to .devmap/snapshot.json");
  if (options.fresh) {
    output.success("Fresh analysis completed");
  }
}

function printList(title: string, values: string[]): void {
  output.section(title);
  if (values.length === 0) {
    console.log("None detected yet");
    return;
  }

  for (const value of values) {
    console.log(`- ${value}`);
  }
}
