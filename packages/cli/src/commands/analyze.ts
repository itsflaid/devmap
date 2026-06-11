import { resolve } from "node:path";
import { DEFAULT_AI_MODELS, GroqClient } from "../ai/groq.js";
import { buildAnalyzeMessages } from "../ai/prompts.js";
import type { AiClient } from "../ai/types.js";
import { createProjectMap } from "../analyzers/projectMap.js";
import { inspectSnapshot, saveSnapshot } from "../cache/snapshot.js";
import { readConfig, type DevmapConfig } from "../utils/config.js";
import { DevmapError } from "../utils/errors.js";
import { output } from "../utils/output.js";

export type AnalyzeOptions = {
  deep?: boolean;
  fresh?: boolean;
};

export type AnalyzeDependencies = {
  loadConfig?: () => Promise<DevmapConfig | null>;
  createAiClient?: (config: DevmapConfig) => AiClient;
};

export async function analyzeCommand(
  target = ".",
  options: AnalyzeOptions = {},
  dependencies: AnalyzeDependencies = {}
): Promise<void> {
  const projectRoot = resolve(target);

  output.section("DevMap Analyze");
  output.step(`Scanning ${projectRoot}`);

  const snapshot = await createProjectMap(projectRoot);
  const previous = options.fresh ? { status: "missing" as const } : await inspectSnapshot(projectRoot);

  if (previous.status === "valid" && previous.snapshot.fingerprint === snapshot.fingerprint) {
    printSnapshot(previous.snapshot, options.deep);
    output.success("Project is unchanged. Reused existing snapshot.");
    await printOrGenerateInterpretation(
      projectRoot,
      previous.snapshot,
      options,
      dependencies
    );
    return;
  }

  await saveSnapshot(projectRoot, snapshot);
  printSnapshot(snapshot, options.deep);

  output.success("Snapshot saved to .devmap/snapshot.json");
  if (options.fresh) {
    output.success("Fresh analysis completed");
  }

  await printOrGenerateInterpretation(projectRoot, snapshot, options, dependencies);
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

async function printOrGenerateInterpretation(
  projectRoot: string,
  snapshot: Awaited<ReturnType<typeof createProjectMap>>,
  options: AnalyzeOptions,
  dependencies: AnalyzeDependencies
): Promise<void> {
  if (snapshot.ai && !options.fresh) {
    output.section("Architecture");
    output.codeBlock(snapshot.ai.architecture);
    output.note(formatAiMetadata(snapshot.ai.model, snapshot.ai.usage, true));
    return;
  }

  const loadConfig = dependencies.loadConfig ?? readConfig;
  const config = await loadConfig();
  if (!config?.apiKey) {
    output.note("AI architecture interpretation is not configured. Run devmap init to enable it.");
    return;
  }

  const createAiClient = dependencies.createAiClient
    ?? ((currentConfig: DevmapConfig) => new GroqClient(currentConfig.apiKey ?? ""));
  const client = createAiClient(config);
  const defaultModel = options.deep
    ? DEFAULT_AI_MODELS.deepAnalyze
    : DEFAULT_AI_MODELS.analyze;
  const model = config.model === "auto" ? defaultModel : config.model;

  output.step(`Interpreting architecture with ${model}`);

  try {
    const interpretation = await client.complete({
      messages: buildAnalyzeMessages(snapshot, options.deep),
      model,
      fallbackModel: DEFAULT_AI_MODELS.fallback,
      maxCompletionTokens: options.deep ? 1800 : 1000,
      temperature: 0.2
    });
    const updatedSnapshot = {
      ...snapshot,
      ai: {
        architecture: interpretation.content,
        model: interpretation.model,
        generatedAt: new Date().toISOString(),
        ...(interpretation.usage ? { usage: interpretation.usage } : {})
      }
    };

    await saveSnapshot(projectRoot, updatedSnapshot);
    output.section("Architecture");
    output.codeBlock(interpretation.content);
    output.note(formatAiMetadata(
      interpretation.model,
      interpretation.usage,
      false
    ));
  } catch (error) {
    if (!(error instanceof DevmapError)) {
      throw error;
    }

    output.warning(error.message);
    if (error.hint) {
      output.note(`Tip: ${error.hint}`);
    }
    output.note("Static analysis and snapshot were still completed successfully.");
  }
}

function formatAiMetadata(
  model: string,
  usage: NonNullable<Awaited<ReturnType<AiClient["complete"]>>["usage"]> | undefined,
  cached: boolean
): string {
  const values = [
    `Model: ${model}`,
    cached ? "Cached: yes" : "Cached: no"
  ];

  if (usage) {
    values.push(`Total tokens: ${usage.totalTokens}`);
  }

  return values.join(" | ");
}
