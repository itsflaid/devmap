import type { ProjectMap } from "../analyzers/pipeline/index.js";
import { DevmapError } from "./errors.js";

export type ResolvedFileTarget = { mode: "file"; value: string };

export function resolveFileTarget(
  snapshot: ProjectMap,
  target: string
): ResolvedFileTarget | null {
  if (snapshot.fileIndex[target]) {
    return { mode: "file", value: target };
  }

  const suffixMatches = Object.keys(snapshot.fileIndex).filter(
    (path) => path.endsWith(`/${target}`) || path === target
  );
  if (suffixMatches.length === 1) {
    return { mode: "file", value: suffixMatches[0] };
  }
  if (suffixMatches.length > 1) {
    throw new DevmapError(
      `"${target}" matches multiple files.`,
      `Be more specific — options: ${suffixMatches.slice(0, 5).join(", ")}${suffixMatches.length > 5 ? ", ..." : ""}`
    );
  }

  return null;
}
