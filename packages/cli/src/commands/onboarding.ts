import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProjectMap } from "../analyzers/projectMap.js";
import { isSnapshotStale, readSnapshotOrThrow } from "../cache/snapshot.js";
import { buildOnboardingModel } from "../onboarding/modelBuilder.js";
import type { OnboardingLanguage, OnboardingModel, ReadingItem, FlowBlock } from "../onboarding/model.js";
import { output, withJsonOutput } from "../utils/output.js";
import { createPrompt, type Prompt } from "../utils/prompt.js";

export type { OnboardingLanguage } from "../onboarding/model.js";

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
  } else {
    output.note("To write this guide to ONBOARDING.md, run devmap onboarding --write.");
  }
}

async function runOnboarding(options: OnboardingOptions): Promise<OnboardingGuide> {
  const projectRoot = resolve(options.projectRoot ?? options.target ?? ".");
  const snapshot = await readSnapshotOrThrow(projectRoot);
  const stale = await isSnapshotStale(projectRoot, snapshot);
  const language = await resolveOnboardingLanguage(options);
  const model = buildOnboardingModel(snapshot, language);
  const markdown = buildOnboardingMarkdown(model, { stale, language });
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
  model: OnboardingModel,
  options: { stale?: boolean; language?: OnboardingLanguage } = {}
): string {
  const language = options.language ?? model.language;
  const labels = getLabels(language);
  const guide = getGuideLabels(language);
  const sections = [
    "# Onboarding Project",
    "",
    ...(options.stale ? [
      guide.staleNote,
      ""
    ] : []),
    `## ${guide.whatProjectDoes}`,
    "",
    model.overview,
    "",
    "## Mental Model",
    "",
    ...model.mentalModel,
    "",
    `## ${guide.mainConcepts}`,
    "",
    ...model.mainConcepts,
    "",
    `## ${guide.importantAreas}`,
    "",
    ...renderReadingAreasFromModel(model.importantAreas, language),
    "",
    ...renderKeyFlowsFromModel(model.keyFlows, language),
    "",
    `## ${guide.whereToStart}`,
    "",
    ...model.whereToStart,
    "",
    model.generatedBy
  ];

  return sections.join("\n").replace(/\n{3,}/g, "\n\n");
}

// ── Thin adapters – convert model data to markdown lines ─────────────────────

function renderReadingAreasFromModel(items: ReadingItem[], language: OnboardingLanguage): string[] {
  const grouped: Record<number, ReadingItem[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const item of items) {
    grouped[item.priority]?.push(item);
  }

  const labels: Record<number, string> = {
    1: "Priority 1 - Core architecture",
    2: "Priority 2 - Core execution flow",
    3: "Priority 3 - Supporting infrastructure",
    4: "Priority 4 - Utilities and helpers"
  };

  const lines: string[] = [];

  for (const priority of [1, 2, 3, 4]) {
    const group = grouped[priority];
    if (!group || group.length === 0) continue;

    lines.push(`### ${labels[priority]}`, "");
    for (const item of group.slice(0, 5)) {
      lines.push(
        `- ${item.path}`,
        `  Purpose: ${item.purpose}`,
        `  Why read this: ${item.why}`,
        ""
      );
    }
  }

  return lines.length > 0 ? lines : [language === "id"
    ? "Belum ada reading area yang cukup kuat dari snapshot."
    : "No strong reading areas were detected from the snapshot."];
}

function renderKeyFlowsFromModel(flows: FlowBlock[], language: OnboardingLanguage): string[] {
  if (flows.length === 0) return [];

  return [
    `## ${language === "id" ? "Flow Penting" : "Key Flows"}`,
    "",
    ...flows.flatMap((flow) => [
      `### ${flow.name}`,
      "",
      ...flow.steps.map((step, index) =>
        `${index + 1}. ${step.purpose ?? step.label}`
      ),
      ""
    ])
  ];
}

// ── Language resolution ───────────────────────────────────────────────────────

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

// ── Language labels ──────────────────────────────────────────────────────────

type OnboardingLabels = ReturnType<typeof getLabels>;

function getGuideLabels(language: OnboardingLanguage) {
  if (language === "id") {
    return {
      staleNote: "> Snapshot ini stale. Jalankan `devmap analyze --fresh` sebelum memakai guide ini untuk keputusan penting.",
      whatProjectDoes: "Apa yang Dilakukan Project Ini",
      mainConcepts: "Konsep Utama",
      importantAreas: "Area Penting untuk Dipahami",
      whereToStart: "Mulai dari Mana"
    };
  }

  return {
    staleNote: "> This snapshot is stale. Run `devmap analyze --fresh` before using this guide for important decisions.",
    whatProjectDoes: "What This Project Does",
    mainConcepts: "Main Concepts",
    importantAreas: "Important Areas to Understand",
    whereToStart: "Where to Start"
  };
}

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
      learningPath: "Jalur Belajar Step-by-Step",
      featureMap: "Peta Fitur",
      importantFlows: "Flow Penting",
      changeImpactNotes: "Catatan Dampak Perubahan",
      agentWorkflow: "Workflow Agent",
      noRecommendedPath: "Belum ada urutan baca yang terdeteksi.",
      noLearningPath: "Belum ada jalur belajar yang bisa dibuat dari snapshot.",
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
      learnWhy: "Kenapa dipelajari",
      focusOn: "Fokus saat membaca",
      nextStep: "Lanjut ke",
      exports: "exports",
      functions: "fungsi",
      relatedFeatures: "fitur terkait",
      scope: "scope",
      learnReadme: "Mulai dari README untuk memahami tujuan project, cara instalasi, dan perintah utama sebelum masuk ke source code.",
      learnAgents: "Baca AGENTS.md untuk memahami aturan kerja AI agent, workflow kontribusi, dan kebiasaan repository ini.",
      learnPackageJson: "Pelajari package.json untuk melihat package manager, script, dependency, entry CLI, dan metadata release.",
      learnEntryPoint: "Ini adalah entry point runtime; baca untuk memahami command yang tersedia dan alur eksekusi awal.",
      learnCriticalPrefix: "File ini penting karena",
      learnGeneric: "File ini masuk recommended path dari snapshot dan membantu membangun konteks project.",
      focusGeneric: "Perhatikan responsibility file, import, export, dan hubungannya dengan file setelahnya.",
      nextStepTemplate: "Setelah {current}, lanjut baca {next} untuk memperluas konteks.",
      nextStepFinal: "Setelah tahap ini, lanjut eksplor feature map atau flow sesuai task yang sedang dikerjakan.",
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
      learningPath: "Step-by-Step Learning Path",
      featureMap: "Feature Map",
    importantFlows: "Important Flows",
    changeImpactNotes: "Change Impact Notes",
    agentWorkflow: "Agent Workflow",
      noRecommendedPath: "No recommended path detected yet.",
      noLearningPath: "No learning path can be built from the snapshot yet.",
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
      learnWhy: "Why learn this",
      focusOn: "What to focus on",
      nextStep: "Next step",
      exports: "exports",
      functions: "functions",
      relatedFeatures: "related features",
      scope: "scope",
      learnReadme: "Start with the README to understand the project purpose, installation path, and main commands before reading source code.",
      learnAgents: "Read AGENTS.md to understand AI-agent rules, contribution workflow, and repository-specific working habits.",
      learnPackageJson: "Study package.json to understand the package manager, scripts, dependencies, CLI entry, and release metadata.",
      learnEntryPoint: "This is a runtime entry point; read it to understand available commands and the initial execution flow.",
      learnCriticalPrefix: "This file is important because",
      learnGeneric: "This file is part of the snapshot-recommended path and helps build project context.",
      focusGeneric: "Pay attention to file responsibility, imports, exports, and how it connects to the next file.",
      nextStepTemplate: "After {current}, read {next} to expand the context.",
      nextStepFinal: "After this step, continue through the feature map or flow that matches your task.",
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
