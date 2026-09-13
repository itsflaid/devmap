import type { ScannedFile } from "../analysis/index.js";
import type { RouteInfo } from "./routeDetector.js";
import { isArchitectureSource } from "../graph/index.js";

type ProcedureKind = "QUERY" | "MUTATION";

// Known V1 limitations:
// - Only processes the first router({...}) call per file
// - Nested composition resolved max 2 levels (root → sub)

export function usesTrpc(files: ScannedFile[]): boolean {
  return files.some((f) =>
    f.path.endsWith("package.json")
    && isArchitectureSource(f.path)
    && /"@trpc\/server"/.test(f.content)
  );
}

export function detectTrpcRoutes(
  files: ScannedFile[],
  graph?: Record<string, string[]>
): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const eligibleFiles = files.filter((f) =>
    isArchitectureSource(f.path) && /\.[cm]?[jt]sx?$/.test(f.path)
  );

  const routerFiles = eligibleFiles.filter((f) =>
    /\brouter\s*\(/.test(f.content)
  );
  if (routerFiles.length === 0) return routes;

  const byPath = new Map(routerFiles.map((f) => [f.path, f]));

  const routerDefs: Array<{
    name: string;
    procedures: Array<{ name: string; kind: ProcedureKind }>;
    file: string;
    subRouterRefs: string[];
  }> = [];

  for (const file of routerFiles) {
    const defs = parseRouterFile(file.content, file.path);
    routerDefs.push(...defs);
  }

  const defByName = new Map(routerDefs.map((d) => [d.name, d]));
  const seen = new Set<string>();

  for (const def of routerDefs) {
    if (def.procedures.length === 0 && def.subRouterRefs.length > 0) {
      for (const ref of def.subRouterRefs) {
        const sub = defByName.get(ref);
        if (!sub) continue;
        for (const proc of sub.procedures) {
          const path = `/trpc/${ref}.${proc.name}`;
          const key = `${path}:${sub.file}`;
          if (seen.has(key)) continue;
          seen.add(key);
          routes.push({
            path,
            file: sub.file,
            kind: "api",
            methods: [proc.kind]
          });
        }
      }
      continue;
    }

    for (const proc of def.procedures) {
      const path = `/trpc/${def.name}.${proc.name}`;
      const key = `${path}:${def.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({
        path,
        file: def.file,
        kind: "api",
        methods: [proc.kind]
      });
    }
  }

  return routes.sort((left, right) =>
    left.path.localeCompare(right.path) || left.file.localeCompare(right.file)
  );
}

function parseRouterFile(
  content: string,
  filePath: string
): Array<{
  name: string;
  procedures: Array<{ name: string; kind: ProcedureKind }>;
  file: string;
  subRouterRefs: string[];
}> {
  const results: Array<{
    name: string;
    procedures: Array<{ name: string; kind: ProcedureKind }>;
    file: string;
    subRouterRefs: string[];
  }> = [];

  const routerCallPattern = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*router\s*\(\s*\{/g;
  let routerMatch = routerCallPattern.exec(content);
  if (!routerMatch) return results;

  const routerName = routerMatch[1];
  const startIdx = routerMatch.index + routerMatch[0].length;

  let depth = 1;
  let endIdx = startIdx;
  while (endIdx < content.length && depth > 0) {
    const ch = content[endIdx];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    endIdx++;
  }

  const routerBody = content.slice(startIdx - 1, endIdx);

  // Extract procedures by finding "name: publicProcedure" then scanning forward for .query or .mutation
  const procStartPattern = /(\w+)\s*:\s*publicProcedure\b/g;
  const procedures: Array<{ name: string; kind: ProcedureKind }> = [];
  let procStartMatch = procStartPattern.exec(routerBody);
  while (procStartMatch) {
    const procName = procStartMatch[1];
    const afterStart = routerBody.slice(procStartMatch.index + procStartMatch[0].length);
    const kindMatch = afterStart.match(/\.(query|mutation)\s*\(/);
    if (kindMatch) {
      procedures.push({
        name: procName,
        kind: kindMatch[1].toUpperCase() as ProcedureKind
      });
    }
    procStartMatch = procStartPattern.exec(routerBody);
  }

  // Extract sub-router references: "subRouter" used as values
  const subRouterRefs: string[] = [];
  const refPattern = /(\w+)\s*:\s*(\w+Router)\b/g;
  let refMatch = refPattern.exec(routerBody);
  while (refMatch) {
    const refName = refMatch[2].replace(/Router$/, "");
    subRouterRefs.push(refName);
    refMatch = refPattern.exec(routerBody);
  }

  results.push({
    name: routerName.replace(/Router$/, "").replace(/^app$/, ""),
    procedures,
    file: filePath,
    subRouterRefs
  });

  return results;
}
