import type { ProjectMap } from "../analyzers/pipeline/projectMap.js";
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
