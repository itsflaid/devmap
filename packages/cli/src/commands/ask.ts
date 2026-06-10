import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

  const keywords = extractKeywords(question);
  const ranked = Object.entries(snapshot.fileIndex)
    .map(([path, metadata]) => ({
      path,
      score: scoreFile(path, metadata.exportedSymbols, keywords)
    }))
    .filter((file) => file.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  output.section("Relevant Files");
  if (ranked.length === 0) {
    output.warning("No strong file matches found. Try running devmap analyze --fresh after more code exists.");
    return;
  }

  for (const file of ranked) {
    output.item(file.path);
  }

  output.section("Static Answer");
  output.note("AI answering is planned for Phase 2. For now, DevMap found the files most likely related to your question.");

  for (const file of ranked.slice(0, 3)) {
    const content = await readFile(join(projectRoot, file.path), "utf8").catch(() => "");
    const preview = content.split(/\r?\n/).slice(0, 12).join("\n");
    output.section(file.path);
    output.codeBlock(preview);
  }
}

function extractKeywords(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

function scoreFile(path: string, symbols: string[], keywords: string[]): number {
  const normalizedPath = path.toLowerCase();
  const normalizedSymbols = symbols.join(" ").toLowerCase();

  return keywords.reduce((score, keyword) => {
    const pathScore = normalizedPath.includes(keyword) ? 5 : 0;
    const symbolScore = normalizedSymbols.includes(keyword) ? 3 : 0;
    return score + pathScore + symbolScore;
  }, 0);
}
