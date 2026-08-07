import type { FlowInfo, ProjectMap } from "../analyzers/pipeline/index.js";
import type { QuestionContext } from "./contextBuilder.js";
import type { AiMessage } from "./types.js";

export function buildAnalyzeMessages(snapshot: ProjectMap): AiMessage[] {
  const analysisData = {
    project: snapshot.project,
    stats: snapshot.stats,
    entryPoints: snapshot.entryPoints,
    criticalFiles: snapshot.criticalFiles,
    routes: snapshot.routes,
    externalServices: snapshot.externalServices,
    database: snapshot.database,
    features: snapshot.features,
    dependencies: snapshot.dependencies
  };

  return [
    {
      role: "system",
      content: [
        "You are DevMap, a codebase architecture interpreter.",
        "Explain only facts supported by the supplied static analysis snapshot.",
        "Do not invent modules, flows, frameworks, or services.",
        "Clearly separate confirmed structure from reasonable interpretation.",
        "Provide a concise architecture overview, main entry points, and important relationships.",
        "Mention relevant file paths.",
        "Use clear Markdown."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        "Interpret this DevMap static analysis snapshot:",
        JSON.stringify(analysisData, null, 2)
      ].join("\n\n")
    }
  ];
}

export function buildFlowNarrationMessages(flow: FlowInfo): AiMessage[] {
  const flowData = {
    name: flow.name,
    purpose: flow.purpose,
    type: flow.type,
    entryPoint: flow.entryPoint,
    steps: flow.steps
  };

  return [
    {
      role: "system",
      content: [
        "You are DevMap, a codebase architecture interpreter.",
        "Turn the given ordered list of structural steps into ONE short flowing paragraph (3-5 sentences).",
        "Only restate facts already present in the steps below — do not invent files, modules, services, or behavior not listed.",
        "Do not add a heading. Plain prose only."
      ].join(" ")
    },
    {
      role: "user",
      content: ["Narrate this flow:", JSON.stringify(flowData, null, 2)].join("\n\n")
    }
  ];
}

export function buildExplainMessages(
  targetLabel: string,
  context: QuestionContext
): AiMessage[] {
  const payload = context.files.map(f => ({
    path: f.path,
    purpose: f.purpose,
    exports: f.exports,
    reasons: f.reasons,
    content: f.content
  }));

  return [
    {
      role: "system",
      content: [
        "You are DevMap, a codebase architecture interpreter.",
        "Explain only what is shown in the provided file excerpts below.",
        "Do not invent behavior, files, or dependencies not shown.",
        "Cover: what it does, what calls/imports it, what it depends on, why it matters if that's evident from the excerpts.",
        "3-6 sentences of plain prose, then file paths mentioned inline with backticks. No headings."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `Explain: ${targetLabel}`,
        "Relevant file excerpts:",
        JSON.stringify(payload, null, 2)
      ].join("\n\n")
    }
  ];
}

