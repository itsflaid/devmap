import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProjectMap } from "../analyzers/projectMap.js";
import { isSnapshotStale, readSnapshotOrThrow } from "../cache/snapshot.js";
import { output, withJsonOutput } from "../utils/output.js";
import { createPrompt, type Prompt } from "../utils/prompt.js";

export type OnboardingLanguage = "en" | "id";

export type OnboardingOptions = {
  json?: boolean;
  language?: string;
  projectRoot?: string;
  prompt?: Prompt;
  target?: string;
  write?: boolean;
};

export type OnboardingGuide = {
  status: "ok";
  language: OnboardingLanguage;
  project: ProjectMap["project"];
  overview: string | null;
  snapshot: {
    generatedAt: string;
    stale: boolean;
  };
  agentInstructions: ProjectMap["agentInstructions"];
  entryPoints: string[];
  criticalFiles: ProjectMap["criticalFiles"];
  externalServices: string[];
  recommendedPath: string[];
  features: Array<{
    name: string;
    entryPoint: string | null;
    businessFlow: string[];
  }>;
  flows: Array<{
    name: string;
    type: ProjectMap["flows"][number]["type"];
    entryPoint: string | null;
    steps: string[];
  }>;
  changeImpact: ProjectMap["changeImpact"];
  markdown: string;
  writtenPath: string | null;
};

export async function onboardingCommand(options: OnboardingOptions = {}): Promise<void> {
  if (options.json) {
    await withJsonOutput(async () => {
      output.json(await runOnboarding(options));
    });
    return;
  }

  const guide = await runOnboarding(options);
  output.section("DevMap Onboarding");
  if (guide.snapshot.stale) {
    output.warning("Snapshot is stale: this guide may use outdated project structure.");
    output.note("Run devmap analyze --fresh, then repeat devmap onboarding.");
  }
  output.markdown(guide.markdown);

  if (guide.writtenPath) {
    output.success(`Wrote ${guide.writtenPath}`);
  }
}

async function runOnboarding(options: OnboardingOptions): Promise<OnboardingGuide> {
  const projectRoot = resolve(options.projectRoot ?? options.target ?? ".");
  const snapshot = await readSnapshotOrThrow(projectRoot);
  const stale = await isSnapshotStale(projectRoot, snapshot);
  const language = await resolveOnboardingLanguage(options);
  const markdown = buildOnboardingMarkdown(snapshot, { stale, language });
  const writtenPath = options.write ? "ONBOARDING.md" : null;

  if (writtenPath) {
    await writeFile(join(projectRoot, writtenPath), `${markdown}\n`, "utf8");
  }

  return {
    status: "ok",
    language,
    project: snapshot.project,
    overview: snapshot.ai?.architecture ?? null,
    snapshot: {
      generatedAt: snapshot.generatedAt,
      stale
    },
    agentInstructions: snapshot.agentInstructions,
    entryPoints: snapshot.entryPoints,
    criticalFiles: snapshot.criticalFiles,
    externalServices: snapshot.externalServices,
    recommendedPath: snapshot.onboarding.recommendedPath,
    features: snapshot.features.map((feature) => ({
      name: feature.name,
      entryPoint: feature.entryPoint ?? null,
      businessFlow: feature.businessFlow
    })),
    flows: snapshot.flows.map((flow) => ({
      name: flow.name,
      type: flow.type,
      entryPoint: flow.entryPoint ?? null,
      steps: flow.steps.map((step) => step.file ?? step.label)
    })),
    changeImpact: snapshot.changeImpact,
    markdown,
    writtenPath
  };
}

export function buildOnboardingMarkdown(
  snapshot: ProjectMap,
  options: { language?: OnboardingLanguage; stale?: boolean } = {}
): string {
  const labels = getLabels(options.language ?? "en");
  const sections = [
    `# ${labels.title}`,
    "",
    `## ${labels.projectOverview}`,
    "",
    `- ${labels.name}: ${snapshot.project.name}`,
    `- ${labels.framework}: ${snapshot.project.framework}`,
    `- ${labels.language}: ${snapshot.project.language}`,
    `- ${labels.packageManager}: ${snapshot.project.packageManager}`,
    `- ${labels.filesIndexed}: ${snapshot.stats.relevantFiles}`,
    `- ${labels.snapshotGenerated}: ${snapshot.generatedAt}`,
    `- ${labels.snapshotStatus}: ${options.stale ? labels.staleSnapshot : labels.freshSnapshot}`,
    "",
    ...renderProjectNarrative(snapshot, options.language ?? "en"),
    "",
    `## ${labels.entryPoints}`,
    "",
    ...renderList(snapshot.entryPoints),
    "",
    `## ${labels.externalServices}`,
    "",
    ...renderExternalServices(snapshot, labels),
    "",
    `## ${labels.criticalFiles}`,
    "",
    ...renderCriticalFiles(snapshot, labels),
    "",
    `## ${labels.recommendedReadingPath}`,
    "",
    ...renderList(snapshot.onboarding.recommendedPath, labels.noRecommendedPath),
    "",
    `## ${labels.featureMap}`,
    "",
    ...renderFeatureMap(snapshot, labels),
    "",
    `## ${labels.importantFlows}`,
    "",
    ...renderFlows(snapshot, labels),
    "",
    `## ${labels.changeImpactNotes}`,
    "",
    ...renderChangeImpact(snapshot, labels),
    "",
    `## ${labels.agentWorkflow}`,
    "",
    ...renderAgentWorkflow(snapshot, labels),
    "",
    labels.generatedBy
  ];

  return sections.join("\n").replace(/\n{3,}/g, "\n\n");
}

async function resolveOnboardingLanguage(options: OnboardingOptions): Promise<OnboardingLanguage> {
  const explicitLanguage = normalizeOnboardingLanguage(options.language);
  if (explicitLanguage) {
    return explicitLanguage;
  }

  if (!options.write || options.json || (!options.prompt && !process.stdin.isTTY)) {
    return "en";
  }

  const prompt = options.prompt ?? createPrompt();

  try {
    const answer = await prompt.ask(
      "Onboarding language? [en/id] (default: en): "
    );
    return normalizeOnboardingLanguage(answer) ?? "en";
  } finally {
    prompt.close();
  }
}

function normalizeOnboardingLanguage(value: string | undefined): OnboardingLanguage | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["id", "indo", "indonesia", "bahasa indonesia"].includes(normalized)) {
    return "id";
  }
  if (["en", "eng", "english", "inggris"].includes(normalized)) {
    return "en";
  }

  return null;
}

function renderAgentWorkflow(snapshot: ProjectMap, labels: OnboardingLabels): string[] {
  const instructions = snapshot.agentInstructions;
  return [
    `- ${labels.navigationPolicy}: ${instructions.navigationPolicy}`,
    `- ${labels.defaultMode}: ${instructions.defaultMode}`,
    `- ${labels.maxInitialFiles}: ${instructions.maxInitialFiles}`,
    `- ${labels.missingSnapshotAction}: ${instructions.missingSnapshotAction}`,
    `- ${labels.staleSnapshotAction}: ${instructions.staleSnapshotAction}`,
    `- ${labels.fallbackRule}: ${instructions.fallbackRule}`,
    "",
    labels.recommendedSequence,
    ...labels.agentSteps.map((step, index) => `${index + 1}. ${step}`)
  ];
}

function renderFeatureMap(snapshot: ProjectMap, labels: OnboardingLabels): string[] {
  if (snapshot.features.length === 0) {
    return [labels.noFeatures];
  }

  return snapshot.features.flatMap((feature) => [
    `### ${feature.name}`,
    "",
    `- ${labels.purpose}: ${feature.purpose}`,
    ...renderOptionalPath(labels.entryPoint, feature.entryPoint),
    `- ${labels.confidence}: ${feature.confidence}`,
    "",
    ...renderBusinessFlow(feature.businessFlow, labels),
    ""
  ]);
}

function renderBusinessFlow(steps: string[], labels: OnboardingLabels): string[] {
  if (steps.length === 0) {
    return [`- ${labels.businessFlow}: ${labels.notAvailable}`];
  }

  return [
    `- ${labels.businessFlow}:`,
    ...steps.map((step, index) => `  ${index + 1}. ${step}`)
  ];
}

function renderFlows(snapshot: ProjectMap, labels: OnboardingLabels): string[] {
  const flows = snapshot.flows.slice(0, 6);
  if (flows.length === 0) {
    return [labels.noFlows];
  }

  return flows.flatMap((flow) => [
    `### ${flow.name}`,
    "",
    `- ${labels.type}: ${flow.type}`,
    ...renderOptionalPath(labels.entryPoint, flow.entryPoint),
    "",
    ...flow.steps.map((step, index) =>
      `${index + 1}. ${step.file ?? step.label}${step.purpose ? ` - ${step.purpose}` : ""}`
    ),
    ""
  ]);
}

function renderProjectNarrative(snapshot: ProjectMap, language: OnboardingLanguage): string[] {
  const featureNames = snapshot.features.map((feature) => feature.name);
  const services = snapshot.externalServices;
  const entryPoints = snapshot.entryPoints;
  const summary = language === "id"
    ? [
      `${snapshot.project.name} adalah project ${snapshot.project.language}`,
      `yang memakai ${snapshot.project.packageManager}`,
      snapshot.project.framework !== "unknown" ? `dengan ${snapshot.project.framework}` : null,
      entryPoints.length > 0 ? `dan mulai dari ${entryPoints[0]}` : null,
      featureNames.length > 0 ? `dengan area fitur terdeteksi seperti ${formatInlineList(featureNames, "id")}` : null,
      services.length > 0 ? `serta external service seperti ${formatInlineList(services, "id")}` : null
    ].filter(Boolean).join(" ")
    : [
      `${snapshot.project.name} is a ${snapshot.project.language} project`,
      `using ${snapshot.project.packageManager}`,
      snapshot.project.framework !== "unknown" ? `with ${snapshot.project.framework}` : null,
      entryPoints.length > 0 ? `starting from ${entryPoints[0]}` : null,
      featureNames.length > 0 ? `with detected feature areas such as ${formatInlineList(featureNames, "en")}` : null,
      services.length > 0 ? `and external services such as ${formatInlineList(services, "en")}` : null
    ].filter(Boolean).join(" ");

  const lines = [`${summary}.`];
  const architectureExcerpt = extractArchitectureExcerpt(snapshot.ai?.architecture);
  if (architectureExcerpt) {
    lines.push("", language === "id"
      ? `Catatan arsitektur: ${architectureExcerpt}`
      : `Architecture note: ${architectureExcerpt}`);
  }

  return lines;
}

function renderExternalServices(snapshot: ProjectMap, labels: OnboardingLabels): string[] {
  if (snapshot.externalServices.length === 0) {
    return [labels.noExternalServices];
  }

  return snapshot.externalServices.map((service) => `- ${service}`);
}

function renderCriticalFiles(snapshot: ProjectMap, labels: OnboardingLabels): string[] {
  const files = snapshot.criticalFiles.slice(0, 10);
  if (files.length === 0) {
    return [labels.noCriticalFiles];
  }

  return files.map((file, index) =>
    `${index + 1}. ${file.path} - ${labels.score} ${file.score}; ${file.reasons.join(", ")}`
  );
}

function renderOptionalPath(label: string, value: string | undefined): string[] {
  return value ? [`- ${label}: ${value}`] : [];
}

function extractArchitectureExcerpt(architecture: string | undefined): string | null {
  if (!architecture) {
    return null;
  }

  const text = architecture
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line
      && !line.startsWith("#")
      && !line.startsWith("|")
      && !line.startsWith("---")
      && !/^[-*]\s/.test(line)
    )
    .join(" ")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < 80) {
    return null;
  }

  return text.length > 500 ? `${text.slice(0, 497).trim()}...` : text;
}

function formatInlineList(values: string[], language: OnboardingLanguage): string {
  const uniqueValues = [...new Set(values)].slice(0, 4);
  if (uniqueValues.length <= 1) {
    return uniqueValues[0] ?? "none";
  }

  const conjunction = language === "id" ? "dan" : "and";
  return `${uniqueValues.slice(0, -1).join(", ")} ${conjunction} ${uniqueValues.at(-1)}`;
}

function renderChangeImpact(snapshot: ProjectMap, labels: OnboardingLabels): string[] {
  const entries = Object.entries(snapshot.changeImpact)
    .filter(([, impact]) => impact.impacts.length > 0)
    .slice(0, 8);

  if (entries.length === 0) {
    return [labels.noChangeImpact];
  }

  return entries.map(([file, impact]) =>
    `- ${file}: impacts ${impact.impacts.join(", ")}`
  );
}

function renderList(values: string[], emptyMessage = "No recommended path detected yet."): string[] {
  if (values.length === 0) {
    return [emptyMessage];
  }

  return values.map((value, index) => `${index + 1}. ${value}`);
}

type OnboardingLabels = ReturnType<typeof getLabels>;

function getLabels(language: OnboardingLanguage) {
  if (language === "id") {
    return {
      title: "Onboarding Project",
      projectOverview: "Gambaran Project",
      name: "Nama",
      framework: "Framework",
      language: "Bahasa",
      packageManager: "Package manager",
      filesIndexed: "File terindeks",
      snapshotGenerated: "Snapshot dibuat",
      snapshotStatus: "Status snapshot",
      staleSnapshot: "stale - jalankan devmap analyze --fresh",
      freshSnapshot: "fresh",
      entryPoints: "Entry Points",
      externalServices: "External Services",
      criticalFiles: "Critical Files",
      recommendedReadingPath: "Urutan Baca yang Disarankan",
      featureMap: "Peta Fitur",
      importantFlows: "Flow Penting",
      changeImpactNotes: "Catatan Dampak Perubahan",
      agentWorkflow: "Workflow Agent",
      noRecommendedPath: "Belum ada urutan baca yang terdeteksi.",
      noExternalServices: "Belum ada external service yang terdeteksi.",
      noCriticalFiles: "Belum ada critical file yang terdeteksi.",
      noFeatures: "Belum ada fitur yang terdeteksi.",
      noFlows: "Belum ada flow yang terdeteksi.",
      noChangeImpact: "Belum ada metadata dampak perubahan.",
      purpose: "Tujuan",
      entryPoint: "Entry point",
      confidence: "Confidence",
      businessFlow: "Business flow",
      type: "Tipe",
      score: "score",
      notAvailable: "belum tersedia",
      navigationPolicy: "Navigation policy",
      defaultMode: "Default mode",
      maxInitialFiles: "Maksimal file awal",
      missingSnapshotAction: "Aksi jika snapshot hilang",
      staleSnapshotAction: "Aksi jika snapshot stale",
      fallbackRule: "Fallback rule",
      recommendedSequence: "Urutan yang disarankan:",
      agentSteps: [
        "Baca `DEVMAP.md` terlebih dahulu.",
        "Baca `.devmap/snapshot.json` sebelum eksplorasi repo secara luas.",
        "Mulai dari urutan baca yang disarankan dan feature entry point.",
        "Buka source file sesedikit mungkin sesuai kebutuhan task.",
        "Refresh snapshot sebelum mengandalkan output onboarding yang stale."
      ],
      generatedBy: "Dibuat oleh DevMap dari `.devmap/snapshot.json`."
    };
  }

  return {
    title: "Project Onboarding",
    projectOverview: "Project Overview",
    name: "Name",
    framework: "Framework",
    language: "Language",
    packageManager: "Package manager",
    filesIndexed: "Files indexed",
    snapshotGenerated: "Snapshot generated",
    snapshotStatus: "Snapshot status",
    staleSnapshot: "stale - run devmap analyze --fresh",
    freshSnapshot: "fresh",
    entryPoints: "Entry Points",
    externalServices: "External Services",
    criticalFiles: "Critical Files",
    recommendedReadingPath: "Recommended Reading Path",
    featureMap: "Feature Map",
    importantFlows: "Important Flows",
    changeImpactNotes: "Change Impact Notes",
    agentWorkflow: "Agent Workflow",
    noRecommendedPath: "No recommended path detected yet.",
    noExternalServices: "No external services detected yet.",
    noCriticalFiles: "No critical files detected yet.",
    noFeatures: "No features detected yet.",
    noFlows: "No flows detected yet.",
    noChangeImpact: "No change impact metadata detected yet.",
    purpose: "Purpose",
    entryPoint: "Entry point",
    confidence: "Confidence",
    businessFlow: "Business flow",
    type: "Type",
    score: "score",
    notAvailable: "not available yet",
    navigationPolicy: "Navigation policy",
    defaultMode: "Default mode",
    maxInitialFiles: "Max initial files",
    missingSnapshotAction: "Missing snapshot action",
    staleSnapshotAction: "Stale snapshot action",
    fallbackRule: "Fallback rule",
    recommendedSequence: "Recommended sequence:",
    agentSteps: [
      "Read `DEVMAP.md` first.",
      "Read `.devmap/snapshot.json` before broad repository exploration.",
      "Start with the recommended reading path and feature entry points.",
      "Inspect only the smallest source-file set needed for the task.",
      "Refresh the snapshot before relying on stale onboarding output."
    ],
    generatedBy: "Generated by DevMap from `.devmap/snapshot.json`."
  };
}
