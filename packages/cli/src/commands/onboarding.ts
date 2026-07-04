import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProjectMap } from "../analyzers/pipeline/index.js";
import { isSnapshotStale, readSnapshotOrThrow } from "../cache/snapshot.js";
import { buildOnboardingModel } from "../onboarding/modelBuilder.js";
import type { OnboardingLanguage, OnboardingModel, ConceptualStep, FeatureSummary, StartHereItem } from "../onboarding/model.js";
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
  projectName: string;
  tagline: string;
  stackLine: string;
  whatThisIs: string;
  howItWorks: ConceptualStep[];
  features: FeatureSummary[];
  startHere: StartHereItem[];
  snapshot: {
    generatedAt: string;
    stale: boolean;
  };
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
  model.isStale = stale;

  const markdown = buildOnboardingMarkdown(model, { stale, language, flows: snapshot.flows });
  const writtenPath = options.write ? "ONBOARDING.md" : null;

  if (writtenPath) {
    await writeFile(join(projectRoot, writtenPath), `${markdown}\n`, "utf8");
  }

  return {
    status: "ok",
    language,
    projectName: model.projectName,
    tagline: model.tagline,
    stackLine: model.stackLine,
    whatThisIs: model.whatThisIs,
    howItWorks: model.howItWorks,
    features: model.features,
    startHere: model.startHere,
    snapshot: {
      generatedAt: snapshot.generatedAt,
      stale
    },
    markdown,
    writtenPath
  };
}

export function buildOnboardingMarkdown(
  model: OnboardingModel,
  options: {
    stale?: boolean;
    language?: OnboardingLanguage;
    flows?: ProjectMap["flows"];
  } = {}
): string {
  const lang = options.language ?? model.language;
  const sections: string[] = [];

  // Header
  sections.push(`# ${model.projectName}`);
  sections.push("");
  sections.push(model.tagline);
  if (model.stackLine) sections.push(`\`${model.stackLine}\``);
  sections.push("");

  // Stale warning
  if (options.stale || model.isStale) {
    sections.push(lang === "id"
      ? "> ⚠ Snapshot stale — jalankan `devmap analyze --fresh` sebelum mengandalkan guide ini."
      : "> ⚠ Snapshot is stale — run `devmap analyze --fresh` before relying on this guide."
    );
    sections.push("");
  }

  sections.push("---");
  sections.push("");

  // Section 1: What this is
  sections.push(lang === "id" ? "## Tentang project ini" : "## What this is");
  sections.push("");
  sections.push(model.whatThisIs);
  sections.push("");

  // Section 2: How it works
  sections.push(lang === "id" ? "## Cara kerjanya" : "## How it works");
  sections.push("");
  for (let i = 0; i < model.howItWorks.length; i++) {
    sections.push(`${i + 1}. ${model.howItWorks[i].step}`);
  }
  sections.push("");

  // Section 3: What's inside
  if (model.features.length > 0) {
    sections.push(lang === "id" ? "## Fitur yang ada" : "## What's inside");
    sections.push("");
    sections.push(...renderFeatureTable(model.features, lang));
    sections.push("");
  }

  // Section 4: Start here
  if (model.startHere.length > 0) {
    sections.push(lang === "id" ? "## Mulai dari sini" : "## Start here");
    sections.push("");
    sections.push(...renderStartHereTable(model.startHere, lang));
    sections.push("");
  }

  // Section 5: Key flows (optional, dari snapshot langsung)
  const flows = options.flows ?? [];
  if (flows.length > 0) {
    sections.push(lang === "id" ? "## Flow utama" : "## Key flows");
    sections.push("");
    sections.push(...renderKeyFlows(flows, lang));
    sections.push("");
  }

  // Section 6: Go deeper (statik)
  sections.push(lang === "id" ? "## Lebih dalam" : "## Go deeper");
  sections.push("");
  sections.push(...renderGoDeeper(lang));
  sections.push("");

  // Footer
  sections.push("---");
  sections.push(lang === "id"
    ? "*Dibuat oleh DevMap · Jalankan `devmap analyze` untuk refresh*"
    : "*Generated by DevMap · Run `devmap analyze` to refresh*"
  );

  return sections.join("\n").replace(/\n{3,}/g, "\n\n");
}

function renderFeatureTable(features: FeatureSummary[], lang: OnboardingLanguage): string[] {
  const header = lang === "id"
    ? ["| Fitur | Fungsi |", "|-------|--------|"]
    : ["| Feature | What it does |", "|---------|-------------|"];

  const rows = features.map((f) => {
    const entryNote = f.entryFile ? ` Entry: \`${f.entryFile}\`` : "";
    return `| ${f.name} | ${f.what}${entryNote} |`;
  });

  return [...header, ...rows];
}

function renderStartHereTable(items: StartHereItem[], lang: OnboardingLanguage): string[] {
  const header = lang === "id"
    ? ["| # | File | Kenapa baca ini |", "|---|------|-----------------|"]
    : ["| # | File | Why read this |", "|---|------|---------------|"];

  const rows = items.map((item) =>
    `| ${item.order} | \`${item.path}\` | ${item.reason} |`
  );

  return [...header, ...rows];
}

function renderKeyFlows(flows: ProjectMap["flows"], lang: OnboardingLanguage): string[] {
  const lines: string[] = [];

  const topFlows = flows
    .filter((f) => f.steps.length > 1)
    .slice(0, 3);

  for (const flow of topFlows) {
    lines.push(`### ${flow.name}`);
    lines.push("");

    if (flow.entryPoint) {
      lines.push(`\`${flow.entryPoint}\``);
    }

    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      const isLast = i === flow.steps.length - 1;
      const fileLabel = step.file ? `\`${step.file}\`` : step.label;
      const purposeNote = step.purpose ? `  — ${step.purpose}` : "";
      const prefix = isLast ? "  └─" : "  ├─";
      lines.push(`${prefix} ${fileLabel}${purposeNote}`);
    }

    lines.push("");
  }

  return lines;
}

function renderGoDeeper(lang: OnboardingLanguage): string[] {
  if (lang === "id") {
    return [
      "- `devmap explain <file>` — pahami apa yang dilakukan file tertentu",
      "- `devmap map` — lihat graph dependency lengkap",
      "- `devmap flow` — trace request dari awal sampai akhir",
    ];
  }
  return [
    "- `devmap explain <file>` — understand what a specific file does",
    "- `devmap map` — see the full dependency graph",
    "- `devmap flow` — trace a request end-to-end",
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

  if (["id", "ind", "indo", "indonesia", "indonesian", "bahasa indonesia"].includes(normalized)) {
    return "id";
  }
  if (["en", "eng", "english", "inggris"].includes(normalized)) {
    return "en";
  }

  return null;
}
