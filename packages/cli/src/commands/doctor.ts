import { arch, platform } from "node:os";
import { resolve } from "node:path";
import {
  inspectAiProvider,
  resolveAiRouting,
  type ProviderInspection
} from "../ai/provider.js";
import { scanFiles } from "../analyzers/analysis/index.js";
import { summarizeFrameworks } from "../analyzers/detectors/index.js";
import { allFrameworks, createProjectFingerprint, detectProjectMetadata } from "../analyzers/pipeline/index.js";
import { inspectSnapshot } from "../cache/snapshot.js";
import type { McpHealth } from "../mcp/health.js";
import {
  readConfig,
  readLocalConfig,
  type DevmapConfig,
  type LocalDevmapConfig
} from "../utils/config.js";
import { DevmapError } from "../utils/errors.js";
import { detectMcpRegistrations } from "../utils/mcpConfig.js";
import { output, withJsonOutput } from "../utils/output.js";
import { DEVMAP_VERSION } from "../utils/packageMetadata.js";

const MINIMUM_NODE_MAJOR = 18;

export type DoctorDependencies = {
  json?: boolean;
  projectRoot?: string;
  loadConfig?: () => Promise<DevmapConfig | null>;
  loadLocalConfig?: (projectRoot: string) => Promise<LocalDevmapConfig | null>;
  inspectProvider?: (
    config: DevmapConfig,
    model: string
  ) => Promise<ProviderInspection>;
  checkMcp?: (projectRoot: string) => Promise<McpHealth>;
};

export async function doctorCommand(
  dependencies: DoctorDependencies = {}
): Promise<void> {
  if (dependencies.json) {
    await withJsonOutput(async () => {
      output.json(await runDoctor(dependencies));
    });
    return;
  }

  await runDoctor(dependencies);
}

async function runDoctor(
  dependencies: DoctorDependencies
): Promise<Record<string, unknown>> {
  const projectRoot = resolve(dependencies.projectRoot ?? process.cwd());
  const loadConfig = dependencies.loadConfig ?? readConfig;
  const loadLocalConfig = dependencies.loadLocalConfig ?? readLocalConfig;
  const inspectProvider = dependencies.inspectProvider
    ?? ((config: DevmapConfig, model: string) => inspectAiProvider(config, model));
  const [config, localConfig, snapshotResult, files] = await Promise.all([
    loadConfig(),
    loadLocalConfig(projectRoot),
    inspectSnapshot(projectRoot),
    scanFiles(projectRoot)
  ]);
  const { frameworks, detectedFrameworks } = summarizeFrameworks(files);
  const framework = frameworks[0] ?? "unknown";
  const project = detectProjectMetadata(projectRoot, framework, files, frameworks, detectedFrameworks);
  const modelSource = config && localConfig?.model
    ? "project override"
    : "global";
  const effectiveConfig = config && localConfig?.model
    ? { ...config, model: localConfig.model }
    : config;
  const selectedModel = effectiveConfig
    ? resolveAiRouting(effectiveConfig, "analyze").model
    : undefined;
  const issues: string[] = [];
  const notes: string[] = [];
  const nodeSupported = readNodeMajor(process.version) >= MINIMUM_NODE_MAJOR;
  let apiKeyStatus = "not configured";
  let modelStatus = selectedModel ?? "not configured";

  output.section("DevMap Doctor");
  output.keyValue("DevMap", DEVMAP_VERSION);
  output.keyValue("Node.js", `${process.version} (${nodeSupported ? "supported" : "unsupported"})`);
  output.keyValue("OS", `${platform()}/${arch()}`);
  output.keyValue("Project", project.name);
  output.keyValue("Framework", project.framework);
  output.keyValue("Workspace Frameworks", allFrameworks(project).join(", ") || "none detected");
  output.keyValue("Package Manager", project.packageManager);
  output.keyValue("Provider", config?.provider ?? "not configured");
  output.keyValue("Config", config ? "exists" : "missing");
  output.keyValue("Snapshot", snapshotResult.status);

  const snapshotStale = snapshotResult.status === "valid"
    ? createProjectFingerprint(files) !== snapshotResult.snapshot.fingerprint
    : null;
  if (snapshotStale !== null) {
    output.keyValue("Snapshot age", snapshotStale ? "stale" : "up to date");
  }
  if (snapshotResult.status === "missing") {
    notes.push("No snapshot yet. Run devmap analyze, or let your agent call devmap_analyze.");
  } else if (snapshotStale) {
    notes.push("The code changed since the last analysis. Run devmap analyze, or let your agent call devmap_analyze.");
  }

  const checkMcp = dependencies.checkMcp
    ?? (async (root: string) => (await import("../mcp/health.js")).checkMcpServer(root));
  const [mcpHealth, mcpClients] = await Promise.all([
    checkMcp(projectRoot),
    detectMcpRegistrations(projectRoot)
  ]);
  output.keyValue(
    "MCP server",
    mcpHealth.ok ? `ready (${mcpHealth.tools} tools)` : "failed"
  );
  output.keyValue(
    "MCP clients",
    mcpClients.length > 0 ? mcpClients.join(", ") : "none registered"
  );
  if (!mcpHealth.ok) {
    issues.push(`The MCP server failed its self-check: ${mcpHealth.error ?? "unknown error"}.`);
  }
  if (mcpClients.length === 0) {
    notes.push("No agent is registered for the MCP server. Run: devmap init --mcp opencode|claude|cursor");
  }

  if (!config) {
    notes.push("AI is optional and not configured. Add a provider key with: devmap config key");
    output.keyValue("API key", "not configured");
    output.keyValue("Model", "not configured");
  } else if (!config.apiKey || !selectedModel) {
    notes.push("AI is optional and no API key is set. Add one with: devmap config key");
    output.keyValue("API key", "missing");
    modelStatus = selectedModel
      ? describeModel(selectedModel, modelSource)
      : "not configured";
    output.keyValue("Model", modelStatus);
    apiKeyStatus = "missing";
  } else {
    try {
      const provider = await inspectProvider(config, selectedModel);
      apiKeyStatus = provider.reachable ? "valid" : "unreachable";
      modelStatus = provider.modelAvailable
        ? describeModel(selectedModel, modelSource)
        : describeModel(`unavailable: ${selectedModel}`, modelSource);
      output.keyValue("API key", apiKeyStatus);
      output.keyValue("Model", modelStatus);

      if (!provider.modelAvailable) {
        issues.push("Run devmap config model <model-id> to choose an available provider model.");
      }
    } catch (error) {
      const message = error instanceof DevmapError
        ? error.message
        : "Provider diagnostics failed.";
      output.keyValue("API key", "invalid or unreachable");
      modelStatus = describeModel(selectedModel, modelSource);
      output.keyValue("Model", modelStatus);
      apiKeyStatus = "invalid or unreachable";
      issues.push(message);
    }
  }

  if (!nodeSupported) {
    issues.push(`Install Node.js ${MINIMUM_NODE_MAJOR} or newer.`);
  }

  if (snapshotResult.status === "corrupt" || snapshotResult.status === "unsupported") {
    issues.push("Run devmap analyze --fresh to regenerate the snapshot.");
  }

  if (snapshotResult.status === "valid" && snapshotResult.snapshot.featureDiagnostics) {
    const risky = snapshotResult.snapshot.featureDiagnostics.mergeDecisions.filter((d) => {
      if (d.outcome !== "merged" || d.anchors.length !== 1 || d.anchors[0].type !== "file") return false;
      const [sourceA] = d.candidateIds[0].split(":");
      const [sourceB] = d.candidateIds[1].split(":");
      return sourceA !== sourceB;
    });
    if (risky.length > 0) {
      output.section("Feature merges (review disarankan)");
      for (const d of risky) {
        output.warning(`${d.candidateIds[0]} <-> ${d.candidateIds[1]} via 1 file: ${d.anchors[0].value}`);
      }
    }
  }

  if (notes.length > 0) {
    output.section("Notes");
    for (const note of notes) {
      output.note(note);
    }
  }

  if (issues.length === 0) {
    output.success("No issues found");
  } else {
    output.section("Issues");
    for (const issue of issues) {
      output.warning(issue);
    }
  }

  return {
    status: issues.length === 0 ? "ok" : "issues",
    devmapVersion: DEVMAP_VERSION,
    node: {
      version: process.version,
      supported: nodeSupported
    },
    os: {
      platform: platform(),
      arch: arch()
    },
    project,
    provider: config?.provider ?? null,
    config: config ? "exists" : "missing",
    snapshot: snapshotResult.status,
    apiKey: apiKeyStatus,
    model: modelStatus,
    snapshotStale,
    mcp: {
      server: mcpHealth,
      registeredClients: mcpClients
    },
    notes,
    issues
  };
}

function readNodeMajor(version: string): number {
  const match = version.match(/^v?(\d+)/);
  return match ? Number(match[1]) : 0;
}

function describeModel(model: string, source: string): string {
  return `${model} (${source})`;
}
