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
  } else {
    output.note("To write this guide to ONBOARDING.md, run devmap onboarding --write.");
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
  const language = options.language ?? "en";
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
    ...renderProjectIntroduction(snapshot, language),
    "",
    "## Mental Model",
    "",
    ...renderMentalModel(snapshot, language),
    "",
    `## ${guide.mainConcepts}`,
    "",
    ...renderMainConcepts(snapshot, language),
    "",
    `## ${guide.importantAreas}`,
    "",
    ...renderReadingAreas(snapshot, language),
    "",
    ...renderImportantFlows(snapshot, language),
    "",
    `## ${guide.whereToStart}`,
    "",
    ...renderWhereToStart(snapshot, language),
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

type ReadingPriority = 1 | 2 | 3 | 4;

type ReadingItem = {
  path: string;
  priority: ReadingPriority;
  purpose: string;
  why: string;
};

function renderProjectIntroduction(snapshot: ProjectMap, language: OnboardingLanguage): string[] {
  const name = snapshot.project.name || (language === "id" ? "Project ini" : "This project");
  const framework = describeProjectFrameworks(snapshot, language);
  const projectLanguage = snapshot.project.language !== "unknown"
    ? language === "id" ? `menggunakan ${snapshot.project.language}` : snapshot.project.language
    : null;
  const features = snapshot.features.map((feature) => feature.name);
  const services = snapshot.externalServices;
  const entryPoint = snapshot.entryPoints[0];
  const lines = language === "id"
    ? [
      `${name} adalah project ${[projectLanguage, framework].filter(Boolean).join(" ") || "software"} yang dipetakan dari snapshot DevMap.`,
      features.length > 0
        ? `Area utamanya terlihat dari fitur terdeteksi seperti ${formatInlineList(features, "id")}.`
        : "Snapshot belum mendeteksi fitur domain yang kuat, jadi guide ini fokus pada entry point dan file penting yang tersedia.",
      entryPoint
        ? `Untuk memahami cara project berjalan, mulai dari entry point ${entryPoint}, lalu ikuti file yang terhubung dengannya.`
        : null,
      services.length > 0
        ? `Project ini juga terhubung ke external service seperti ${formatInlineList(services, "id")}, jadi bagian integrasi perlu dibaca dengan hati-hati.`
        : null
    ].filter((line): line is string => Boolean(line))
    : [
      `${name} is a ${formatEnglishProjectDescriptor(projectLanguage, framework)} project mapped from the DevMap snapshot.`,
      features.length > 0
        ? `Its main areas include detected features such as ${formatInlineList(features, "en")}.`
        : "The snapshot does not show strong domain features yet, so this guide focuses on entry points and important files.",
      entryPoint
        ? `To understand how the project runs, start from ${entryPoint}, then follow the files connected to it.`
        : null,
      services.length > 0
        ? `The project also integrates with external services such as ${formatInlineList(services, "en")}, so integration files deserve extra care.`
        : null
    ].filter((line): line is string => Boolean(line));

  return lines.slice(0, 4);
}

function formatEnglishProjectDescriptor(language: string | null, framework: string | null): string {
  if (language && framework) {
    return `${language} ${framework}`;
  }
  return language ?? framework ?? "software";
}

function describeProjectFrameworks(
  snapshot: ProjectMap,
  language: OnboardingLanguage
): string | null {
  if (snapshot.project.framework !== "unknown") {
    return language === "id"
      ? `berbasis ${snapshot.project.framework}`
      : `built with ${snapshot.project.framework}`;
  }

  if (snapshot.project.frameworks.length > 0) {
    const frameworks = snapshot.project.frameworks.join(", ");
    return language === "id"
      ? `dengan framework workspace ${frameworks}`
      : `with workspace frameworks ${frameworks}`;
  }

  return null;
}

function renderMentalModel(snapshot: ProjectMap, language: OnboardingLanguage): string[] {
  const hasCli = hasScope(snapshot, "cli") || hasPathSegment(snapshot, "commands");
  const hasRoutes = snapshot.routes.length > 0 || snapshot.apiRoutes.length > 0;
  const hasDatabase = Boolean(snapshot.database);
  const hasSnapshotEngine = hasPathSegment(snapshot, "snapshot") || hasPathSegment(snapshot, "projectMap");

  if (hasCli || hasSnapshotEngine) {
    return language === "id" ? [
      "User menjalankan CLI command.",
      "Command membaca konfigurasi dan menentukan proses yang dibutuhkan.",
      "Project files discan dan dianalisis menjadi Project Map.",
      "Hasil analisis disimpan sebagai Snapshot.",
      "Command lain memakai Snapshot untuk menjawab, membuat guide, atau memberi output."
    ] : [
      "User runs a CLI command.",
      "The command reads configuration and decides which process is needed.",
      "Project files are scanned and analyzed into a Project Map.",
      "The analysis result is saved as a Snapshot.",
      "Other commands reuse the Snapshot to answer, guide, or render output."
    ];
  }

  if (hasRoutes) {
    const steps = (language === "id" ? [
      "User membuka route atau mengirim request.",
      snapshot.routes.length > 0 ? "Route UI merender halaman dan menghubungkan komponen terkait." : null,
      snapshot.apiRoutes.length > 0 ? "API route menjalankan business logic di sisi server." : null,
      hasDatabase ? "Data layer membaca atau menulis data yang dibutuhkan." : null,
      "Response dikembalikan ke user atau client."
    ] : [
      "User opens a route or sends a request.",
      snapshot.routes.length > 0 ? "UI routes render pages and connect related components." : null,
      snapshot.apiRoutes.length > 0 ? "API routes run server-side business logic." : null,
      hasDatabase ? "The data layer reads or writes the required data." : null,
      "A response is returned to the user or client."
    ]).filter((line): line is string => Boolean(line));
    return steps.slice(0, 10);
  }

  if (snapshot.entryPoints.length > 0) {
    return language === "id" ? [
      "Runtime masuk melalui entry point project.",
      "Entry point memanggil module utama yang terhubung lewat import.",
      "File penting dan feature-related files menjelaskan responsibility utama.",
      "Output akhir mengikuti framework atau runtime yang dipakai project."
    ] : [
      "Runtime starts from the project entry point.",
      "The entry point calls main modules connected through imports.",
      "Important files and feature-related files explain the main responsibilities.",
      "The final output follows the framework or runtime used by the project."
    ];
  }

  return language === "id" ? [
    "Snapshot belum punya flow runtime yang kuat.",
    "Mulai dari file penting dan dependency yang terdeteksi sebelum membuka area lain."
  ] : [
    "The snapshot does not expose a strong runtime flow yet.",
    "Start from important files and detected dependencies before opening other areas."
  ];
}

function renderMainConcepts(snapshot: ProjectMap, language: OnboardingLanguage): string[] {
  const concepts: Array<{ name: string; description: string; reason: string }> = [];
  const addConcept = (name: string, description: string, reason: string) => {
    if (!concepts.some((concept) => concept.name === name)) {
      concepts.push({ name, description, reason });
    }
  };

  for (const feature of snapshot.features.slice(0, 4)) {
    addConcept(
      feature.name,
      describeFeatureConcept(feature, language),
      feature.entryPoint
        ? language === "id"
          ? `Penting karena punya entry point ${feature.entryPoint}.`
          : `It matters because it has entry point ${feature.entryPoint}.`
        : language === "id"
          ? "Penting karena beberapa file snapshot mengarah ke area ini."
          : "It matters because multiple snapshot files point to this area."
    );
  }

  if (snapshot.entryPoints.length > 0) {
    addConcept(
      "Entry Points",
      language === "id"
        ? "File tempat runtime, command, atau request mulai masuk ke project."
        : "Files where runtime, commands, or requests enter the project.",
      language === "id"
        ? "Ini membantu agent membuka file pertama yang benar sebelum membaca detail lain."
        : "This helps an agent open the right first file before reading details."
    );
  }

  if (snapshot.routes.length > 0 || snapshot.apiRoutes.length > 0) {
    addConcept(
      "Routes",
      language === "id"
        ? "Mapping halaman atau API yang menjadi permukaan utama project."
        : "Page or API mappings that form the main project surface.",
      language === "id"
        ? "Routes menunjukkan bagaimana user atau client berinteraksi dengan sistem."
        : "Routes show how users or clients interact with the system."
    );
  }

  if (snapshot.database) {
    addConcept(
      "Database Layer",
      language === "id"
        ? `Bagian project yang berhubungan dengan ${snapshot.database.provider}.`
        : `The project area connected to ${snapshot.database.provider}.`,
      language === "id"
        ? "Penting untuk memahami persistence, schema, dan risiko perubahan data."
        : "This matters for understanding persistence, schema, and data-change risk."
    );
  }

  if (snapshot.externalServices.length > 0) {
    addConcept(
      "External Services",
      language === "id"
        ? `Integrasi ke service seperti ${formatInlineList(snapshot.externalServices, "id")}.`
        : `Integrations with services such as ${formatInlineList(snapshot.externalServices, "en")}.`,
      language === "id"
        ? "Area ini biasanya berkaitan dengan credential, network call, dan failure handling."
        : "This area usually involves credentials, network calls, and failure handling."
    );
  }

  if (hasPathSegment(snapshot, "snapshot")) {
    addConcept(
      "Snapshot",
      language === "id"
        ? "Representasi hasil analisis project yang digunakan ulang oleh command lain."
        : "A reusable representation of project analysis used by other commands.",
      language === "id"
        ? "Mengurangi kebutuhan agent membaca repository dari nol setiap kali bekerja."
        : "It reduces the need for agents to reread the repository from scratch."
    );
  }

  if (hasPathSegment(snapshot, "contextBuilder")) {
    addConcept(
      "Context Retrieval",
      language === "id"
        ? "Proses memilih file paling relevan sebelum AI menjawab pertanyaan."
        : "The process of selecting the most relevant files before AI answers.",
      language === "id"
        ? "Ini menjaga jawaban tetap fokus dan menghindari eksplorasi repository yang terlalu luas."
        : "It keeps answers focused and avoids broad repository exploration."
    );
  }

  if (concepts.length === 0) {
    return [language === "id"
      ? "Belum ada konsep utama yang cukup kuat dari snapshot saat ini."
      : "No strong main concepts were detected from the current snapshot."];
  }

  return concepts.slice(0, 8).flatMap((concept) => [
    `### ${concept.name}`,
    "",
    concept.description,
    "",
    concept.reason,
    ""
  ]);
}

function renderReadingAreas(snapshot: ProjectMap, language: OnboardingLanguage): string[] {
  const groups = groupReadingItems(snapshot, language);
  const labels: Record<ReadingPriority, string> = {
    1: "Priority 1 - Core architecture",
    2: "Priority 2 - Core execution flow",
    3: "Priority 3 - Supporting infrastructure",
    4: "Priority 4 - Utilities and helpers"
  };
  const lines: string[] = [];

  for (const priority of [1, 2, 3, 4] as ReadingPriority[]) {
    const items = groups[priority];
    if (items.length === 0) {
      continue;
    }

    lines.push(`### ${labels[priority]}`, "");
    for (const item of items.slice(0, 5)) {
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

function groupReadingItems(snapshot: ProjectMap, language: OnboardingLanguage): Record<ReadingPriority, ReadingItem[]> {
  const items = new Map<string, ReadingItem>();
  const add = (path: string | undefined, priority: ReadingPriority) => {
    if (!path || !hasFile(snapshot, path)) {
      return;
    }

    const existing = items.get(path);
    const item: ReadingItem = {
      path,
      priority: existing ? Math.min(existing.priority, priority) as ReadingPriority : priority,
      purpose: describeFilePurpose(path, snapshot, language),
      why: describeFileImportance(path, snapshot, language)
    };
    items.set(path, item);
  };

  for (const path of snapshot.entryPoints) add(path, 1);
  for (const path of snapshot.onboarding.recommendedPath.slice(0, 4)) add(path, 1);
  for (const file of snapshot.criticalFiles.slice(0, 6)) add(file.path, 1);

  for (const feature of snapshot.features) {
    add(feature.entryPoint, 2);
    for (const path of feature.files.slice(0, 4)) add(path, 2);
  }

  for (const flow of snapshot.flows.slice(0, 3)) {
    add(flow.entryPoint, 2);
    for (const step of flow.steps.slice(0, 4)) add(step.file, 2);
  }

  for (const [path, entry] of Object.entries(snapshot.fileIndex)) {
    if (["api", "service", "database", "config"].includes(entry.scope) || entry.featureRefs.length > 0) {
      add(path, 3);
    }
  }

  for (const path of snapshot.onboarding.recommendedPath) add(path, 4);

  const grouped: Record<ReadingPriority, ReadingItem[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const item of items.values()) {
    grouped[item.priority].push(item);
  }

  for (const priority of [1, 2, 3, 4] as ReadingPriority[]) {
    grouped[priority].sort((left, right) =>
      fileSortScore(right.path, snapshot) - fileSortScore(left.path, snapshot)
      || left.path.localeCompare(right.path)
    );
  }

  return grouped;
}

function renderImportantFlows(snapshot: ProjectMap, language: OnboardingLanguage): string[] {
  const flows = snapshot.flows.slice(0, 3);
  if (flows.length === 0) {
    return [];
  }

  return [
    `## ${language === "id" ? "Flow Penting" : "Key Flows"}`,
    "",
    ...flows.flatMap((flow) => [
      `### ${flow.name}`,
      "",
      ...flow.steps.slice(0, 8).map((step, index) =>
        `${index + 1}. ${describeFlowStep(step.file ?? step.label, step.purpose, language)}`
      ),
      ""
    ])
  ];
}

function renderWhereToStart(snapshot: ProjectMap, language: OnboardingLanguage): string[] {
  const groups = groupReadingItems(snapshot, language);
  const firstFiles = [...groups[1], ...groups[2]].slice(0, 3).map((item) => item.path);
  const lines = language === "id" ? [
    "Jika baru pertama kali masuk project ini:",
    "",
    "1. Baca `DEVMAP.md` untuk memahami cara memakai Snapshot dan aturan agent.",
    "2. Pahami Mental Model di atas sebelum membuka source file.",
    firstFiles.length > 0
      ? `3. Buka ${formatInlineList(firstFiles, "id")} sebagai file awal.`
      : "3. Mulai dari entry point atau critical file yang tersedia di snapshot.",
    "4. Ikuti Flow Penting atau feature entry point yang paling dekat dengan task.",
    "5. Baru buka file tambahan jika Snapshot belum cukup menjawab pertanyaan."
  ] : [
    "If this is your first time in the project:",
    "",
    "1. Read `DEVMAP.md` to understand how to use the Snapshot and agent rules.",
    "2. Understand the Mental Model above before opening source files.",
    firstFiles.length > 0
      ? `3. Open ${formatInlineList(firstFiles, "en")} as the first source files.`
      : "3. Start from the entry point or critical files available in the snapshot.",
    "4. Follow the Key Flows or the feature entry point closest to your task.",
    "5. Only open extra files when the Snapshot is not enough."
  ];

  return lines;
}

function describeFilePurpose(path: string, snapshot: ProjectMap, language: OnboardingLanguage): string {
  const entry = snapshot.fileIndex[path];
  const featureRefs = entry?.featureRefs ?? [];
  const critical = snapshot.criticalFiles.find((file) => file.path === path);

  if (entry?.purpose && !isLowValuePurpose(entry.purpose)) {
    return entry.purpose;
  }

  if (snapshot.entryPoints.includes(path)) {
    return language === "id"
      ? "Menjadi titik awal runtime atau command utama project."
      : "Acts as a runtime or command entry point for the project.";
  }

  if (featureRefs.length > 0) {
    return language === "id"
      ? `Mendukung area fitur ${formatInlineList(featureRefs, "id")}.`
      : `Supports the ${formatInlineList(featureRefs, "en")} feature area.`;
  }

  if (critical) {
    return language === "id"
      ? "Menghubungkan beberapa bagian penting dalam project."
      : "Connects important parts of the project.";
  }

  if (entry?.scope && entry.scope !== "unknown") {
    return language === "id"
      ? `Menangani responsibility ${entry.scope} dalam struktur project.`
      : `Handles the ${entry.scope} responsibility in the project structure.`;
  }

  return language === "id"
    ? "Membantu melengkapi konteks project berdasarkan snapshot."
    : "Helps complete project context from the snapshot.";
}

function describeFileImportance(path: string, snapshot: ProjectMap, language: OnboardingLanguage): string {
  const entry = snapshot.fileIndex[path];
  const impact = snapshot.changeImpact[path];
  const critical = snapshot.criticalFiles.find((file) => file.path === path);

  if (snapshot.entryPoints.includes(path)) {
    return language === "id"
      ? "File ini menjelaskan bagaimana eksekusi project dimulai."
      : "This file explains how project execution starts.";
  }

  if (entry?.featureRefs.length) {
    return language === "id"
      ? `File ini memberi konteks langsung untuk ${formatInlineList(entry.featureRefs, "id")}.`
      : `This file gives direct context for ${formatInlineList(entry.featureRefs, "en")}.`;
  }

  if (impact?.impacts.length) {
    return language === "id"
      ? `Perubahan di sini dapat memengaruhi ${formatInlineList(impact.impacts, "id")}.`
      : `Changes here can affect ${formatInlineList(impact.impacts, "en")}.`;
  }

  if (impact?.dependents.length) {
    return language === "id"
      ? "Banyak bagian project bergantung pada file ini."
      : "Several project areas depend on this file.";
  }

  if (critical) {
    return language === "id"
      ? "Snapshot menandai file ini sebagai critical karena perannya dalam struktur project."
      : "The snapshot marks this file as critical because of its structural role.";
  }

  return language === "id"
    ? "File ini membantu agent memahami konteks sebelum membuka detail yang lebih kecil."
    : "This file helps an agent understand context before opening smaller details.";
}

function describeFlowStep(label: string, purpose: string | undefined, language: OnboardingLanguage): string {
  if (purpose && !isLowValuePurpose(purpose)) {
    return purpose;
  }

  if (/\.[cm]?[jt]sx?$|\.json$|\.md$/.test(label)) {
    return language === "id"
      ? `Masuk ke ${label} untuk memahami bagian flow ini.`
      : `Open ${label} to understand this part of the flow.`;
  }

  return label;
}

function describeFeatureConcept(feature: ProjectMap["features"][number], language: OnboardingLanguage): string {
  if (feature.purpose && !isLowValuePurpose(feature.purpose)) {
    return feature.purpose;
  }

  if (feature.entryPoint) {
    return language === "id"
      ? `Area ${feature.name} dimulai dari ${feature.entryPoint} dan terhubung ke file pendukung yang terdeteksi di snapshot.`
      : `${feature.name} starts from ${feature.entryPoint} and connects to supporting files detected in the snapshot.`;
  }

  if (feature.files.length > 0) {
    return language === "id"
      ? `Area ${feature.name} terlihat dari beberapa file terkait di snapshot.`
      : `${feature.name} appears across several related files in the snapshot.`;
  }

  return language === "id"
    ? `Area ${feature.name} terdeteksi sebagai konsep penting dalam project.`
    : `${feature.name} is detected as an important project concept.`;
}

function isLowValuePurpose(purpose: string): boolean {
  return /\b(exposes|contains project code|identifies .* capability)\b/i.test(purpose);
}

function hasScope(snapshot: ProjectMap, scope: string): boolean {
  return Object.values(snapshot.fileIndex).some((entry) => entry.scope === scope);
}

function hasPathSegment(snapshot: ProjectMap, segment: string): boolean {
  const normalizedSegment = segment.toLowerCase();
  return Object.keys(snapshot.fileIndex).some((path) =>
    path.toLowerCase().includes(normalizedSegment)
  );
}

function hasFile(snapshot: ProjectMap, path: string): boolean {
  return Boolean(snapshot.fileIndex[path])
    || snapshot.entryPoints.includes(path)
    || snapshot.criticalFiles.some((file) => file.path === path)
    || snapshot.onboarding.recommendedPath.includes(path);
}

function fileSortScore(path: string, snapshot: ProjectMap): number {
  const entry = snapshot.fileIndex[path];
  const critical = snapshot.criticalFiles.find((file) => file.path === path);
  return (entry?.importance ?? 0)
    + (critical?.score ?? 0)
    + (snapshot.entryPoints.includes(path) ? 100 : 0)
    + ((entry?.featureRefs.length ?? 0) * 20);
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

function renderLearningPath(snapshot: ProjectMap, labels: OnboardingLabels): string[] {
  const path = snapshot.onboarding.recommendedPath.slice(0, 8);
  if (path.length === 0) {
    return [labels.noLearningPath];
  }

  return path.flatMap((file, index) => [
    `### ${index + 1}. ${file}`,
    "",
    `- ${labels.learnWhy}: ${describeLearningPurpose(file, snapshot, labels)}`,
    `- ${labels.focusOn}: ${describeLearningFocus(file, snapshot, labels)}`,
    `- ${labels.nextStep}: ${describeLearningNextStep(file, path[index + 1], labels)}`,
    ""
  ]);
}

function describeLearningPurpose(
  file: string,
  snapshot: ProjectMap,
  labels: OnboardingLabels
): string {
  const entry = snapshot.fileIndex[file];
  const critical = snapshot.criticalFiles.find((item) => item.path === file);

  if (file.toLowerCase().includes("readme")) {
    return labels.learnReadme;
  }
  if (file.toLowerCase().includes("agents")) {
    return labels.learnAgents;
  }
  if (file.endsWith("package.json")) {
    return labels.learnPackageJson;
  }
  if (snapshot.entryPoints.includes(file)) {
    return labels.learnEntryPoint;
  }
  if (entry?.purpose) {
    return entry.purpose;
  }
  if (critical) {
    return `${labels.learnCriticalPrefix} ${critical.reasons.join(", ")}.`;
  }

  return labels.learnGeneric;
}

function describeLearningFocus(
  file: string,
  snapshot: ProjectMap,
  labels: OnboardingLabels
): string {
  const entry = snapshot.fileIndex[file];
  const exports = entry?.exportedSymbols.slice(0, 4) ?? [];
  const functions = entry?.topFunctions.slice(0, 4).map((item) => item.name) ?? [];
  const featureRefs = entry?.featureRefs.slice(0, 3) ?? [];
  const focusItems = [
    exports.length > 0 ? `${labels.exports}: ${exports.join(", ")}` : null,
    functions.length > 0 ? `${labels.functions}: ${functions.join(", ")}` : null,
    featureRefs.length > 0 ? `${labels.relatedFeatures}: ${featureRefs.join(", ")}` : null,
    entry?.scope ? `${labels.scope}: ${entry.scope}` : null
  ].filter(Boolean);

  return focusItems.length > 0 ? focusItems.join("; ") : labels.focusGeneric;
}

function describeLearningNextStep(
  file: string,
  nextFile: string | undefined,
  labels: OnboardingLabels
): string {
  if (!nextFile) {
    return labels.nextStepFinal;
  }

  return labels.nextStepTemplate
    .replace("{current}", file)
    .replace("{next}", nextFile);
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
      describeProjectFrameworks(snapshot, "id"),
      entryPoints.length > 0 ? `dan mulai dari ${entryPoints[0]}` : null,
      featureNames.length > 0 ? `dengan area fitur terdeteksi seperti ${formatInlineList(featureNames, "id")}` : null,
      services.length > 0 ? `serta external service seperti ${formatInlineList(services, "id")}` : null
    ].filter(Boolean).join(" ")
    : [
      `${snapshot.project.name} is a ${snapshot.project.language} project`,
      `using ${snapshot.project.packageManager}`,
      describeProjectFrameworks(snapshot, "en"),
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
