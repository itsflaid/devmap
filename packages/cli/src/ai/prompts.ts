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
      `EXPORTS: ${file.exports.length > 0 ? file.exports.join(", ") : "none detected"}`,
      `TOP_FUNCTIONS: ${file.topFunctions.length > 0 ? JSON.stringify(file.topFunctions) : "not extracted yet"}`,
      `PURPOSE: ${file.purpose ?? "not inferred yet"}`,
      `RELEVANCE: ${file.reasons.join("; ")}`,
      "CONTENT:",
      file.content
    ].join("\n"))
    .join("\n\n---\n\n") || "No files passed the minimum relevance threshold.";

  return [
    {
      role: "system",
      content: [
        "You are DevMap, a codebase understanding assistant.",
        "Answer using only the supplied DevMap context.",
        "Do not invent files, functions, flows, or behavior.",
        "Only mention files as existing files when they appear as FILE entries in SELECTED CONTEXT.",
        "If you infer a path that is not listed in SELECTED CONTEXT, label it as a suggested new or possible file, not an existing file.",
        "If the context is insufficient, say what is missing.",
        "Use RETRIEVAL_CONFIDENCE and TOP_SCORE to judge how strongly the selected files match the question.",
        "If RETRIEVAL_CONFIDENCE is low, do not claim the selected files are correct.",
        "For low confidence, explicitly say no strong matches were found, explain that the requested concept may not exist in the current snapshot, and offer investigation paths or likely architectural entry points.",
        "If RETRIEVAL_CONFIDENCE is high, be direct and mention exact files and exported functions when available.",
        "Answer in the same language as the user's question.",
        "Cite relevant file paths and explain relationships clearly.",
        "Do not restate the question.",
        "Do not repeat the same sentence, section, or file list.",
        "Keep the answer concise and practical.",
        "Start with the direct answer in one short paragraph.",
        "Use a Key Files section with `path` - role bullets when files matter.",
        "Use an Evidence section only when relationships or flow need explanation.",
        "Use a Limits section only when the supplied context is insufficient.",
        "Do not include long code examples unless the user explicitly asks for code.",
        "For implementation guidance, describe the smallest next change and the existing file or function to inspect first.",
        "Prefer existing supplied files over inventing new files; propose a new file only when the context clearly supports it."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `PROJECT: ${project.name}`,
        `FRAMEWORK: ${project.framework}`,
        `INTENT: ${context.intent}`,
        `KEYWORDS: ${context.keywords.length > 0 ? context.keywords.join(", ") : "none"}`,
        `RETRIEVAL_CONFIDENCE: ${context.confidence}`,
        `TOP_SCORE: ${context.topScore}`,
        `QUESTION: ${context.question}`,
        "",
        "SELECTED CONTEXT:",
        fileContext
      ].join("\n")
    }
  ];
}
