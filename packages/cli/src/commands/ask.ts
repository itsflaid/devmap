import { buildQuestionContext } from "../ai/contextBuilder.js";
import { inspectSnapshot, isSnapshotStale } from "../cache/snapshot.js";
import { analyzeCommand } from "./analyze.js";
import { output } from "../utils/output.js";

export async function askCommand(questionParts: string[]): Promise<void> {
  const question = questionParts.join(" ").trim();
  if (!question) {
    output.error("Please include a question.");
    return;
  }

  const projectRoot = process.cwd();
  let snapshotResult = await inspectSnapshot(projectRoot);

  if (snapshotResult.status === "corrupt" || snapshotResult.status === "unsupported") {
    output.warning("The existing snapshot cannot be used. Running quick analyze first.");
    await analyzeCommand(".");
    snapshotResult = await inspectSnapshot(projectRoot);
  } else if (snapshotResult.status === "missing") {
    output.warning("No snapshot found. Running quick analyze first.");
    await analyzeCommand(".");
    snapshotResult = await inspectSnapshot(projectRoot);
  }

  if (snapshotResult.status !== "valid") {
    output.error("Could not create snapshot.");
    return;
  }

  const snapshot = snapshotResult.snapshot;
  if (await isSnapshotStale(projectRoot, snapshot)) {
    output.warning("The project has changed since this snapshot was generated.");
    output.note("Run devmap analyze before relying on this answer.");
  }

  const context = await buildQuestionContext(projectRoot, snapshot, question);

  output.section("Relevant Files");
  if (context.files.length === 0) {
    output.warning("No strong file matches found. Try running devmap analyze --fresh after more code exists.");
    return;
  }

  for (const file of context.files) {
    output.item(`${file.path} (${file.reasons.join(", ")})`);
  }

  output.section("Static Answer");
  output.note("AI answering is planned for Phase 2. For now, DevMap found the files most likely related to your question.");

  for (const file of context.files.slice(0, 3)) {
    const previewLines = file.content.split(/\r?\n/).slice(0, 24);
    const previewEndLine = file.startLine + previewLines.length - 1;
    const lineRange = file.startLine === previewEndLine
      ? `line ${file.startLine}`
      : `lines ${file.startLine}-${previewEndLine}`;
    output.section(`${file.path} (${lineRange})`);
    output.codeBlock(previewLines.join("\n"));
  }
}
