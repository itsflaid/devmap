import { buildQuestionContext } from "../ai/contextBuilder.js";
import { completeWithOptionalStreaming } from "../ai/completion.js";
import {
  DEFAULT_AI_FALLBACKS,
  DEFAULT_AI_MODELS,
  GroqClient
} from "../ai/groq.js";
import { buildAskMessages, buildQueryExpansionMessages } from "../ai/prompts.js";
import type { AiClient } from "../ai/types.js";
import { inspectSnapshot, isSnapshotStale } from "../cache/snapshot.js";
import { readConfig, type DevmapConfig } from "../utils/config.js";
import { DevmapError } from "../utils/errors.js";
import { analyzeCommand } from "./analyze.js";
import { output, withJsonOutput } from "../utils/output.js";

const MEDIUM_RELEVANCE_SCORE = 40;

export type AskDependencies = {
  json?: boolean;
  projectRoot?: string;
  loadConfig?: () => Promise<DevmapConfig | null>;
  createAiClient?: (config: DevmapConfig) => AiClient;
};

export async function askCommand(
  questionParts: string[],
  dependencies: AskDependencies = {}
): Promise<void> {
  if (dependencies.json) {
    await withJsonOutput(async () => {
      output.json(await runAsk(questionParts, dependencies));
    });
    return;
  }

  await runAsk(questionParts, dependencies);
}

async function runAsk(
  questionParts: string[],
  dependencies: AskDependencies
): Promise<Record<string, unknown>> {
  const question = questionParts.join(" ").trim();
  if (!question) {
    output.error("Please include a question.");
    return { status: "error", error: "Please include a question." };
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
    return { status: "error", error: "Could not create snapshot." };
  }

  const snapshot = snapshotResult.snapshot;
  if (await isSnapshotStale(projectRoot, snapshot)) {
    output.warning("Snapshot is stale: this answer may use outdated project structure.");
    output.note("Run devmap analyze --fresh, then repeat devmap ask for the latest result.");
  }

  const loadConfig = dependencies.loadConfig ?? readConfig;
  const config = await loadConfig();
  const createAiClient = dependencies.createAiClient
    ?? ((currentConfig: DevmapConfig) => new GroqClient(currentConfig.apiKey ?? ""));
  const model = config?.model === "auto" || !config?.model
    ? DEFAULT_AI_MODELS.ask
    : config.model;
  const client = config?.apiKey ? createAiClient(config) : null;
  let context = await buildQuestionContext(
    projectRoot,
    snapshot,
    question
  );
  if (client && context.topScore < MEDIUM_RELEVANCE_SCORE) {
    const expandedTerms = await expandQuestionTerms(client, question, model);
    if (expandedTerms.length > 0) {
      context = await buildQuestionContext(
        projectRoot,
        snapshot,
        question,
        { expandedTerms }
      );
    }
  }

  output.section("Relevant Files");
  if (context.confidence === "low") {
    output.warning("No strong file matches found in the current snapshot.");
    for (const file of context.files) {
      output.item(`${file.path} (weak match)`);
    }
    printLowConfidenceAnswer(context);
    return {
      status: "low_confidence",
      question,
      intent: context.intent,
      keywords: context.keywords,
      expandedTerms: context.expandedTerms,
      confidence: context.confidence,
      topScore: context.topScore,
      relevantFiles: serializeContextFiles(context.files),
      answer: buildLowConfidenceAnswer(context),
      model: null,
      usage: null
    };
  } else {
    for (const file of context.files) {
      output.item(file.path);
    }
  }

  if (!config?.apiKey || !client) {
    output.warning("AI answering is not configured yet.");
    output.note("Run devmap init to configure a Groq API key.");
    printStaticContext(context.files);
    return {
      status: "static",
      question,
      intent: context.intent,
      keywords: context.keywords,
      expandedTerms: context.expandedTerms,
      confidence: context.confidence,
      topScore: context.topScore,
      relevantFiles: serializeContextFiles(context.files),
      answer: null,
      model: null,
      usage: null
    };
  }

  output.step(`Asking Groq with ${model}`);

  try {
    const execution = await completeWithOptionalStreaming(client, {
      messages: buildAskMessages(context, snapshot.project),
      model,
      fallbackModels: DEFAULT_AI_FALLBACKS.ask,
      maxCompletionTokens: 1200,
      temperature: 0.2
    }, !dependencies.json, () => output.section("Answer"));
    const answer = execution.result;

    if (!execution.streamed) {
      output.section("Answer");
      output.markdown(answer.content);
    }
    output.note(formatUsage(answer.model, answer.usage));
    return {
      status: "ok",
      question,
      intent: context.intent,
      keywords: context.keywords,
      expandedTerms: context.expandedTerms,
      confidence: context.confidence,
      topScore: context.topScore,
      relevantFiles: serializeContextFiles(context.files),
      answer: answer.content,
      model: answer.model,
      usage: answer.usage ?? null
    };
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
    return {
      status: "fallback",
      question,
      intent: context.intent,
      keywords: context.keywords,
      expandedTerms: context.expandedTerms,
      confidence: context.confidence,
      topScore: context.topScore,
      relevantFiles: serializeContextFiles(context.files),
      answer: null,
      model,
      usage: null,
      error: error.message,
      hint: error.hint ?? null
    };
  }
}

async function expandQuestionTerms(
  client: AiClient,
  question: string,
  model: string
): Promise<string[]> {
  try {
    const result = await client.complete({
      messages: buildQueryExpansionMessages(question),
      model,
      fallbackModels: DEFAULT_AI_FALLBACKS.ask,
      maxCompletionTokens: 180,
      temperature: 0
    });

    return parseExpandedTerms(result.content);
  } catch {
    return [];
  }
}

function parseExpandedTerms(content: string): string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((item): item is string => typeof item === "string")
    .slice(0, 10);
}

function printLowConfidenceAnswer(
  context: Awaited<ReturnType<typeof buildQuestionContext>>
): void {
  output.section("Answer");
  output.markdown(buildLowConfidenceAnswer(context));
}

function buildLowConfidenceAnswer(
  context: Awaited<ReturnType<typeof buildQuestionContext>>
): string {
  const target = context.keywords.length > 0
    ? context.keywords.slice(0, 4).join(", ")
    : context.question;

  return [
    `No strong matching files found for "${target}".`,
    "",
    "The current snapshot does not contain strong evidence for that concept, so DevMap will not guess an existing implementation.",
    "The behavior may not exist yet, or the snapshot may be stale.",
    "Next investigation paths:",
    "- Run `devmap analyze --fresh` if the project changed.",
    "- Try a more specific code term, route name, package name, or folder name.",
    "- If this is a new feature, start from the closest existing entry point, route, command, or UI area after confirming it exists in the project."
  ].join("\n");
}

function serializeContextFiles(
  files: Awaited<ReturnType<typeof buildQuestionContext>>["files"]
): Array<Record<string, unknown>> {
  return files.map((file) => ({
    path: file.path,
    score: file.score,
    reasons: file.reasons,
    exports: file.exports,
    topFunctions: file.topFunctions,
    purpose: file.purpose ?? null,
    startLine: file.startLine,
    endLine: file.endLine,
    truncated: file.truncated
  }));
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
