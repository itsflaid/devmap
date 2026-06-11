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
import { output } from "../utils/output.js";

const DEVMAP_VERSION = "0.1.0";
const MINIMUM_NODE_MAJOR = 18;

export type DoctorDependencies = {
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
  } else {
    try {
      const provider = await inspectProvider(config.apiKey, selectedModel);
      output.keyValue("API key", provider.reachable ? "valid" : "unreachable");
      output.keyValue(
        "Model",
        provider.modelAvailable ? selectedModel : `unavailable: ${selectedModel}`
      );

      if (!provider.modelAvailable) {
        issues.push("Run devmap init or choose an available Groq model.");
      }
    } catch (error) {
      const message = error instanceof DevmapError
        ? error.message
        : "Provider diagnostics failed.";
      output.keyValue("API key", "invalid or unreachable");
      output.keyValue("Model", selectedModel);
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
    return;
  }

  output.section("Issues");
  for (const issue of issues) {
    output.warning(issue);
  }
}

function readNodeMajor(version: string): number {
  const match = version.match(/^v?(\d+)/);
  return match ? Number(match[1]) : 0;
}
