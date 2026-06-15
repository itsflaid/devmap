import { createRequire } from "node:module";
import { arch, platform } from "node:os";
import { resolve } from "node:path";
import {
  DEFAULT_AI_MODELS,
  inspectGroqProvider,
  type GroqProviderInspection
} from "../ai/groq.js";
import { scanFiles } from "../analyzers/fileScanner.js";
import { detectFramework } from "../analyzers/frameworkDetector.js";
import { detectProjectMetadata } from "../analyzers/projectMetadata.js";
import { inspectSnapshot } from "../cache/snapshot.js";
import { readConfig, type DevmapConfig } from "../utils/config.js";
import { DevmapError } from "../utils/errors.js";
import { output, withJsonOutput } from "../utils/output.js";

const require = createRequire(import.meta.url);
const { version: DEVMAP_VERSION } = require("../../package.json") as {
  version: string;
};
const MINIMUM_NODE_MAJOR = 18;

export type DoctorDependencies = {
  json?: boolean;
  projectRoot?: string;
  loadConfig?: () => Promise<DevmapConfig | null>;
  inspectProvider?: (
    apiKey: string,
    model: string
  ) => Promise<GroqProviderInspection>;
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
  const inspectProvider = dependencies.inspectProvider ?? inspectGroqProvider;
  const [config, snapshotResult, files] = await Promise.all([
    loadConfig(),
    inspectSnapshot(projectRoot),
    scanFiles(projectRoot)
  ]);
  const framework = detectFramework(files);
  const project = detectProjectMetadata(projectRoot, framework, files);
  const selectedModel = config?.model === "auto"
    ? DEFAULT_AI_MODELS.ask
    : config?.model;
  const issues: string[] = [];
  const nodeSupported = readNodeMajor(process.version) >= MINIMUM_NODE_MAJOR;
  let apiKeyStatus = "not configured";
  let modelStatus = selectedModel ?? "not configured";

  output.section("DevMap Doctor");
  output.keyValue("DevMap", DEVMAP_VERSION);
  output.keyValue("Node.js", `${process.version} (${nodeSupported ? "supported" : "unsupported"})`);
  output.keyValue("OS", `${platform()}/${arch()}`);
  output.keyValue("Project", project.name);
  output.keyValue("Framework", framework);
  output.keyValue("Package Manager", project.packageManager);
  output.keyValue("Provider", config?.provider ?? "not configured");
  output.keyValue("Config", config ? "exists" : "missing");
  output.keyValue("Snapshot", snapshotResult.status);

  if (!config) {
    issues.push("Run devmap init to create ~/.devmap/config.json.");
    output.keyValue("API key", "not configured");
    output.keyValue("Model", "not configured");
  } else if (!config.apiKey || !selectedModel) {
    issues.push("Run devmap init again to configure Groq.");
    output.keyValue("API key", "missing");
    output.keyValue("Model", selectedModel ?? "not configured");
    apiKeyStatus = "missing";
  } else {
    try {
      const provider = await inspectProvider(config.apiKey, selectedModel);
      apiKeyStatus = provider.reachable ? "valid" : "unreachable";
      modelStatus = provider.modelAvailable
        ? selectedModel
        : `unavailable: ${selectedModel}`;
      output.keyValue("API key", apiKeyStatus);
      output.keyValue("Model", modelStatus);

      if (!provider.modelAvailable) {
        issues.push("Run devmap init or choose an available Groq model.");
      }
    } catch (error) {
      const message = error instanceof DevmapError
        ? error.message
        : "Provider diagnostics failed.";
      output.keyValue("API key", "invalid or unreachable");
      output.keyValue("Model", selectedModel);
      apiKeyStatus = "invalid or unreachable";
      modelStatus = selectedModel;
      issues.push(message);
    }
  }

  if (!nodeSupported) {
    issues.push(`Install Node.js ${MINIMUM_NODE_MAJOR} or newer.`);
  }

  if (snapshotResult.status === "corrupt" || snapshotResult.status === "unsupported") {
    issues.push("Run devmap analyze --fresh to regenerate the snapshot.");
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
    issues
  };
}

function readNodeMajor(version: string): number {
  const match = version.match(/^v?(\d+)/);
  return match ? Number(match[1]) : 0;
}
