import { buildQuestionContext } from "../ai/contextBuilder.js";
import { DEFAULT_AI_MODELS, GroqClient } from "../ai/groq.js";
import { buildAskMessages } from "../ai/prompts.js";
import type { AiClient } from "../ai/types.js";
import { inspectSnapshot, isSnapshotStale } from "../cache/snapshot.js";
import { readConfig, type DevmapConfig } from "../utils/config.js";
import { DevmapError } from "../utils/errors.js";
import { analyzeCommand } from "./analyze.js";
import { output } from "../utils/output.js";

export type AskDependencies = {
  projectRoot?: string;
  loadConfig?: () => Promise<DevmapConfig | null>;
  createAiClient?: (config: DevmapConfig) => AiClient;
};

export async function askCommand(
  questionParts: string[],
  dependencies: AskDependencies = {}
): Promise<void> {
  const question = questionParts.join(" ").trim();
  if (!question) {
    output.error("Please include a question.");
    return;
  }

  const projectRoot = dependencies.projectRoot ?? process.cwd();
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

  const loadConfig = dependencies.loadConfig ?? readConfig;
  const config = await loadConfig();

  if (!config?.apiKey) {
    output.warning("AI answering is not configured yet.");
    output.note("Run devmap init to configure a Groq API key.");
    printStaticContext(context.files);
    return;
  }

  const createAiClient = dependencies.createAiClient
    ?? ((currentConfig: DevmapConfig) => new GroqClient(currentConfig.apiKey ?? ""));
  const client = createAiClient(config);
  const model = config.model === "auto" ? DEFAULT_AI_MODELS.ask : config.model;

  output.step(`Asking Groq with ${model}`);

  try {
    const answer = await client.complete({
      messages: buildAskMessages(context, snapshot.project),
      model,
      fallbackModel: DEFAULT_AI_MODELS.fallback,
      maxCompletionTokens: 1200,
      temperature: 0.2
    });

    output.section("Answer");
    output.markdown(answer.content);
    output.note(formatUsage(answer.model, answer.usage));
  } catch (error) {
    if (!(error instanceof DevmapError)) {
      throw error;
    }

    output.warning(error.message);
    if (error.hint) {
      output.note(`Tip: ${error.hint}`);
    }
    output.note("Showing selected source context instead.");
    printStaticContext(context.files);
  }
}

function printStaticContext(
  files: Awaited<ReturnType<typeof buildQuestionContext>>["files"]
): void {
  output.section("Static Context");

  for (const file of files.slice(0, 3)) {
    const previewLines = file.content.split(/\r?\n/).slice(0, 24);
    const previewEndLine = file.startLine + previewLines.length - 1;
    const lineRange = file.startLine === previewEndLine
      ? `line ${file.startLine}`
      : `lines ${file.startLine}-${previewEndLine}`;
    output.section(`${file.path} (${lineRange})`);
    output.codeBlock(previewLines.join("\n"));
  }
}

function formatUsage(
  model: string,
  usage: Awaited<ReturnType<AiClient["complete"]>>["usage"]
): string {
  if (!usage) {
    return `Model: ${model}`;
  }

  return [
    `Model: ${model}`,
    `Prompt tokens: ${usage.promptTokens}`,
    `Completion tokens: ${usage.completionTokens}`,
    `Total tokens: ${usage.totalTokens}`
  ].join(" | ");
}
