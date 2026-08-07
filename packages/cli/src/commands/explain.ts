import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildQuestionContext } from "../ai/contextBuilder.js";
import { completeWithOptionalStreaming } from "../ai/completion.js";
import {
  createAiClient as createDefaultAiClient,
  resolveAiRouting
} from "../ai/provider.js";
import { buildExplainMessages } from "../ai/prompts.js";
import type { AiClient } from "../ai/types.js";
import type { FileIndexEntry, ProjectMap } from "../analyzers/pipeline/index.js";
import { readSnapshotOrThrow } from "../cache/snapshot.js";
import { resolveEffectiveConfig, type DevmapConfig } from "../utils/config.js";
import { DevmapError } from "../utils/errors.js";
import { output, withJsonOutput } from "../utils/output.js";
import { slugifyMapName } from "../utils/slug.js";
import { resolveFileTarget } from "../utils/targetResolver.js";

export type ExplainOptions = {
  json?: boolean;
  write?: boolean;
  projectRoot?: string;
};

export type ExplainDependencies = {
  loadConfig?: () => Promise<DevmapConfig | null>;
  createAiClient?: (config: DevmapConfig) => AiClient;
};

export type ExplainResult = {
  status: "ok";
  mode: "file" | "feature" | "function";
  target: string;
  resolvedFile?: string;
  answer: string;
  model: string;
  contextFiles: string[];
  writtenPath?: string;
};

export type ResolvedExplainTarget =
  | { mode: "file"; value: string }
  | { mode: "feature"; value: string }
  | { mode: "function"; value: string; file: string; line: number };

export async function explainCommand(
  target: string,
  options: ExplainOptions = {},
  dependencies: ExplainDependencies = {}
): Promise<void> {
  if (options.json) {
    await withJsonOutput(async () => {
      output.json(await runExplain(target, options, dependencies));
    });
    return;
  }

  const result = await runExplain(target, options, dependencies);
  output.note(`Context files: ${result.contextFiles.join(", ")}`);
  if (result.writtenPath) {
    output.success(`Wrote ${result.writtenPath}`);
  }
}

async function runExplain(
  target: string,
  options: ExplainOptions,
  dependencies: ExplainDependencies
): Promise<ExplainResult> {
  const projectRoot = resolve(options.projectRoot ?? ".");
  const snapshot = await readSnapshotOrThrow(projectRoot);

  const loadConfig = dependencies.loadConfig
    ?? (() => resolveEffectiveConfig(projectRoot));
  const config = await loadConfig();
  if (!config?.apiKey) {
    throw new DevmapError(
      "devmap explain requires an AI provider, but none is configured.",
      "Run devmap init to set up Groq or OpenRouter, then try again."
    );
  }

  const createAiClient = dependencies.createAiClient
    ?? createDefaultAiClient;
  const client = createAiClient(config);
  const routing = resolveAiRouting(config, "explain");

  const resolved = resolveExplainTarget(snapshot, target);
  const targetLabel = resolved.mode === "function"
    ? `${resolved.value} in ${resolved.file}`
    : resolved.value;

  const context = await buildQuestionContext(projectRoot, snapshot, targetLabel);

  const execution = await completeWithOptionalStreaming(client, {
    messages: buildExplainMessages(targetLabel, context),
    model: routing.model,
    fallbackModels: routing.fallbackModels,
    maxCompletionTokens: 700,
    temperature: 0.2
  }, !options.json, () => output.section("Answer"));

  let writtenPath: string | undefined;
  if (options.write) {
    const slug = slugifyMapName(resolved.value);
    const explainDir = join(projectRoot, ".devmap", "explain");
    await mkdir(explainDir, { recursive: true });
    await writeFile(
      join(explainDir, `${slug}.md`),
      `# ${targetLabel}\n\n${execution.result.content}\n`,
      "utf8"
    );
    writtenPath = `.devmap/explain/${slug}.md`;
  }

  return {
    status: "ok",
    mode: resolved.mode,
    target: resolved.value,
    ...(resolved.mode === "function" ? { resolvedFile: resolved.file } : {}),
    answer: execution.result.content,
    model: execution.result.model,
    contextFiles: context.files.map((file) => file.path),
    ...(writtenPath ? { writtenPath } : {})
  };
}

export function resolveExplainTarget(
  snapshot: ProjectMap,
  target: string
): ResolvedExplainTarget {
  const feature = snapshot.features.find(
    (candidate) => candidate.name.toLowerCase() === target.toLowerCase()
  );
  if (feature) {
    return { mode: "feature", value: feature.name };
  }

  const fileTarget = resolveFileTarget(snapshot, target);
  if (fileTarget) {
    return fileTarget;
  }

  const matches: Array<{
    file: string;
    fn: FileIndexEntry["topFunctions"][number];
  }> = [];
  for (const [file, entry] of Object.entries(snapshot.fileIndex)) {
    for (const fn of entry.topFunctions) {
      if (fn.name.toLowerCase() === target.toLowerCase()) {
        matches.push({ file, fn });
      }
    }
  }

  if (matches.length === 1) {
    return {
      mode: "function",
      value: matches[0].fn.name,
      file: matches[0].file,
      line: matches[0].fn.line
    };
  }
  if (matches.length > 1) {
    throw new DevmapError(
      `"${target}" matches multiple functions.`,
      `Be more specific — found in: ${matches.map((match) => `${match.file}:${match.fn.line}`).slice(0, 5).join(", ")}`
    );
  }

  const featureNames = snapshot.features.map((f) => f.name).join(", ") || "(none detected)";
  throw new DevmapError(
    `"${target}" isn't a known file, feature, or function.`,
    `Known features: ${featureNames}. For a file, use its path relative to the project root, or use a top-level function name.`
  );
}
