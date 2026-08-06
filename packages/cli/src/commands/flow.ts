import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { completeWithOptionalStreaming } from "../ai/completion.js";
import {
  createAiClient as createDefaultAiClient,
  resolveAiRouting
} from "../ai/provider.js";
import { buildFlowNarrationMessages } from "../ai/prompts.js";
import type { AiClient } from "../ai/types.js";
import {
  generateFeatureFlows,
  generateRequestFlows,
  renderMermaidFlow,
  type FlowInfo,
  type ProjectMap
} from "../analyzers/pipeline/index.js";
import { isSnapshotStale, readSnapshotOrThrow } from "../cache/snapshot.js";
import { resolveEffectiveConfig, type DevmapConfig } from "../utils/config.js";
import { DevmapError } from "../utils/errors.js";
import { buildMapMarkdown } from "../utils/mapRenderer.js";
import { output, withJsonOutput } from "../utils/output.js";
import { slugifyMapName } from "../utils/slug.js";

export type FlowOptions = {
  json?: boolean;
  projectRoot?: string;
  all?: boolean;
};

export type FlowDependencies = {
  loadConfig?: () => Promise<DevmapConfig | null>;
  createAiClient?: (config: DevmapConfig) => AiClient;
};

export type FlowResult = {
  status: "ok";
  flows: Array<{
    name: string;
    purpose: string;
    type: FlowInfo["type"];
    markdown: string;
    mermaid: string;
    narrated: boolean;
  }>;
  writtenPaths: Array<{ name: string; markdown: string; mermaid: string }>;
  snapshot: { generatedAt: string; stale: boolean };
};

export async function flowCommand(
  target: string | undefined,
  options: FlowOptions = {},
  dependencies: FlowDependencies = {}
): Promise<void> {
  if (options.json) {
    await withJsonOutput(async () => {
      output.json(await runFlow(target, options, dependencies));
    });
    return;
  }

  const result = await runFlow(target, options, dependencies);
  output.section("DevMap — flows");
  if (result.snapshot.stale) {
    output.warning("Snapshot is stale: these flows may not reflect the latest code.");
    output.note("Run devmap analyze --fresh, then repeat devmap flow.");
  }
  if (!target && result.flows.length > 1) {
    output.section("Flows written");
    for (const flow of result.flows) {
      output.item(`${flow.name} — ${flow.purpose}`);
    }
  }
  for (const path of result.writtenPaths) {
    output.success(`Wrote ${path.markdown}`);
    output.success(`Wrote ${path.mermaid}`);
  }
}

async function runFlow(
  target: string | undefined,
  options: FlowOptions,
  dependencies: FlowDependencies
): Promise<FlowResult> {
  const projectRoot = resolve(options.projectRoot ?? ".");
  const snapshot = await readSnapshotOrThrow(projectRoot);
  const stale = await isSnapshotStale(projectRoot, snapshot);

  const flows = options.all
    ? buildAllFlows(snapshot)
    : snapshot.flows;
  const resolved = resolveFlowTarget(flows, target);

  const loadConfig = dependencies.loadConfig
    ?? (() => resolveEffectiveConfig(projectRoot));
  const config = await loadConfig();
  let client: AiClient | undefined;
  let routing: { model: string; fallbackModels: readonly string[] } | undefined;

  if (!config?.apiKey) {
    output.note("AI flow narration is not configured. Run devmap init to enable it.");
  } else {
    const createAiClient = dependencies.createAiClient ?? createDefaultAiClient;
    client = createAiClient(config);
    routing = resolveAiRouting(config, "flowNarration");
  }

  const flowsDir = join(projectRoot, ".devmap", "flows");
  await mkdir(flowsDir, { recursive: true });

  const built: Array<{
    name: string;
    purpose: string;
    type: FlowInfo["type"];
    markdown: string;
    mermaid: string;
    narrated: boolean;
    slug: string;
  }> = [];

  for (const flow of resolved) {
    const narration = client && routing
      ? await narrateFlow(client, routing.model, routing.fallbackModels, flow, options.json ?? false)
      : undefined;

    const markdown = buildMapMarkdown({
      title: flow.name,
      sections: [
        { heading: "Purpose", body: flow.purpose },
        ...(narration ? [{ heading: "How it works", body: narration }] : []),
        {
          heading: "Steps",
          body: flow.steps.map((step, index) => `${index + 1}. ${step.label}${step.file ? ` (\`${step.file}\`)` : ""}`).join("\n")
        }
      ],
      mermaid: flow.mermaid ?? renderMermaidFlow(flow.steps)
    });
    const mermaid = flow.mermaid ?? renderMermaidFlow(flow.steps);
    const slug = slugifyMapName(flow.name);

    await writeFile(join(flowsDir, `${slug}.md`), markdown, "utf8");
    await writeFile(join(flowsDir, `${slug}.mermaid`), `${mermaid}\n`, "utf8");

    built.push({
      name: flow.name,
      purpose: flow.purpose,
      type: flow.type,
      markdown,
      mermaid,
      narrated: Boolean(narration),
      slug
    });
  }

  return {
    status: "ok",
    flows: built.map(({ slug: _slug, ...rest }) => rest),
    writtenPaths: built.map(({ name, slug }) => ({
      name,
      markdown: `.devmap/flows/${slug}.md`,
      mermaid: `.devmap/flows/${slug}.mermaid`
    })),
    snapshot: { generatedAt: snapshot.generatedAt, stale }
  };
}

function buildAllFlows(snapshot: ProjectMap): FlowInfo[] {
  return [
    ...generateFeatureFlows(snapshot.features, snapshot.fileIndex, {
      limit: Infinity,
      minConfidence: "medium"
    }),
    ...generateRequestFlows(snapshot.routes, snapshot.fileIndex, snapshot.fileGraph, {
      limit: Infinity,
      includeAllRouteKinds: true
    })
  ];
}

function resolveFlowTarget(
  flows: FlowInfo[],
  target: string | undefined
): FlowInfo[] {
  if (!target || target.trim() === "") return flows;

  const exact = flows.filter(f => f.name.toLowerCase() === target.toLowerCase());
  if (exact.length > 0) return exact;

  const partial = flows.filter(f => f.name.toLowerCase().includes(target.toLowerCase()));
  if (partial.length === 1) return partial;
  if (partial.length > 1) {
    throw new DevmapError(
      `"${target}" matches multiple flows.`,
      `Be more specific — options: ${partial.map(f => f.name).join(", ")}`
    );
  }

  const names = flows.map(f => f.name).join(", ") || "(none detected)";
  throw new DevmapError(
    `"${target}" isn't a known flow.`,
    `Known flows: ${names}. Run devmap flow --all to see the full list.`
  );
}

async function narrateFlow(
  client: AiClient,
  model: string,
  fallbackModels: readonly string[],
  flow: FlowInfo,
  json: boolean
): Promise<string | undefined> {
  try {
    const execution = await completeWithOptionalStreaming(client, {
      messages: buildFlowNarrationMessages(flow),
      model,
      fallbackModels,
      maxCompletionTokens: 400,
      temperature: 0.2
    }, !json, () => output.section("How it works"));
    return execution.result.content;
  } catch (error) {
    if (!(error instanceof DevmapError)) {
      throw error;
    }

    output.warning(error.message);
    if (error.hint) {
      output.note(`Tip: ${error.hint}`);
    }
    return undefined;
  }
}
