import type { ProjectMap } from "../analyzers/projectMap.js";
import type { QuestionContext } from "./contextBuilder.js";
import type { AiMessage } from "./types.js";

export type AskProjectSummary = Pick<ProjectMap["project"], "name" | "framework">;

export function buildAnalyzeMessages(
  snapshot: ProjectMap,
  deep = false
): AiMessage[] {
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
        deep
          ? "Provide a detailed module-oriented explanation and recommended reading order."
          : "Provide a concise architecture overview, main entry points, and important relationships.",
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

export function buildAskMessages(
  context: QuestionContext,
  project: AskProjectSummary
): AiMessage[] {
  const fileContext = context.files
    .map((file) => [
      `FILE: ${file.path}`,
      `LINES: ${file.startLine}-${file.endLine}`,
      `RELEVANCE: ${file.reasons.join("; ")}`,
      "CONTENT:",
      file.content
    ].join("\n"))
    .join("\n\n---\n\n");

  return [
    {
      role: "system",
      content: [
        "You are DevMap, a codebase understanding assistant.",
        "Answer using only the supplied DevMap context.",
        "Do not invent files, functions, flows, or behavior.",
        "If the context is insufficient, say what is missing.",
        "Answer in the same language as the user's question.",
        "Cite relevant file paths and explain relationships clearly.",
        "Keep the answer concise and practical."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `PROJECT: ${project.name}`,
        `FRAMEWORK: ${project.framework}`,
        `QUESTION: ${context.question}`,
        "",
        "SELECTED CONTEXT:",
        fileContext
      ].join("\n")
    }
  ];
}
