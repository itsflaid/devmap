import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  buildBoundedTree,
  buildReverseGraph,
  type MapTreeNode
} from "../analyzers/graph/index.js";
import type { ProjectMap } from "../analyzers/pipeline/index.js";
import { isSnapshotStale, readSnapshotOrThrow } from "../cache/snapshot.js";
import { DevmapError } from "../utils/errors.js";
import {
  buildMapMarkdown,
  renderMermaid,
  renderTree,
  type MermaidEdge
} from "../utils/mapRenderer.js";
import { output, withJsonOutput } from "../utils/output.js";

const USES_DEPTH = 2;
const USED_BY_DEPTH = 1;

export type MapOptions = {
  json?: boolean;
  projectRoot?: string;
  target?: string;
};

export type MapResult = {
  status: "ok";
  mode: "file" | "feature" | "project";
  target: string;
  markdown: string;
  mermaid: string;
  writtenPaths: { markdown: string; mermaid: string };
  snapshot: { generatedAt: string; stale: boolean };
};

export async function mapCommand(
  target: string | undefined,
  options: MapOptions = {}
): Promise<void> {
  if (options.json) {
    await withJsonOutput(async () => {
      output.json(await runMap(target, options));
    });
    return;
  }

  const result = await runMap(target, options);
  output.section(`DevMap — map: ${result.target}`);
  if (result.snapshot.stale) {
    output.warning("Snapshot is stale: this map may not reflect the latest code.");
    output.note("Run devmap analyze --fresh, then repeat devmap map.");
  }
  output.markdown(result.markdown);
  output.success(`Wrote ${result.writtenPaths.markdown}`);
  output.success(`Wrote ${result.writtenPaths.mermaid}`);
}

async function runMap(
  target: string | undefined,
  options: MapOptions
): Promise<MapResult> {
  const projectRoot = resolve(options.projectRoot ?? ".");
  const snapshot = await readSnapshotOrThrow(projectRoot);
  const stale = await isSnapshotStale(projectRoot, snapshot);

  const resolved = resolveMapTarget(snapshot, target);

  const built = resolved.mode === "file"
    ? buildFileMap(snapshot, resolved.value)
    : resolved.mode === "feature"
      ? buildFeatureMap(snapshot, resolved.value)
      : buildProjectMap(snapshot);

  const slug = slugifyMapName(resolved.value);
  const mapsDir = join(projectRoot, ".devmap", "maps");
  await mkdir(mapsDir, { recursive: true });

  const markdownPath = join(mapsDir, `${slug}.md`);
  const mermaidPath = join(mapsDir, `${slug}.mermaid`);
  await writeFile(markdownPath, built.markdown, "utf8");
  await writeFile(mermaidPath, `${built.mermaid}\n`, "utf8");

  return {
    status: "ok",
    mode: resolved.mode,
    target: resolved.value,
    markdown: built.markdown,
    mermaid: built.mermaid,
    writtenPaths: {
      markdown: `.devmap/maps/${slug}.md`,
      mermaid: `.devmap/maps/${slug}.mermaid`
    },
    snapshot: { generatedAt: snapshot.generatedAt, stale }
  };
}

type ResolvedTarget =
  | { mode: "file"; value: string }
  | { mode: "feature"; value: string }
  | { mode: "project"; value: "project" };

function resolveMapTarget(snapshot: ProjectMap, target: string | undefined): ResolvedTarget {
  if (!target || target.trim() === "") {
    return { mode: "project", value: "project" };
  }

  const feature = snapshot.features.find(
    (candidate) => candidate.name.toLowerCase() === target.toLowerCase()
  );
  if (feature) {
    return { mode: "feature", value: feature.name };
  }

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

  const featureNames = snapshot.features.map((f) => f.name).join(", ") || "(none detected)";
  throw new DevmapError(
    `"${target}" isn't a known file or feature.`,
    `Known features: ${featureNames}. For a file, use its path relative to the project root.`
  );
}

function buildFileMap(
  snapshot: ProjectMap,
  path: string
): { markdown: string; mermaid: string } {
  const reverseGraph = buildReverseGraph(snapshot.fileGraph);

  const usesTree = buildBoundedTree(snapshot.fileGraph, path, USES_DEPTH);
  const usedByTree = buildBoundedTree(reverseGraph, path, USED_BY_DEPTH);

  const mermaidEdges: MermaidEdge[] = [
    ...collectEdgesFromTree(path, usesTree, "forward"),
    ...collectEdgesFromTree(path, usedByTree, "reverse")
  ];

  return {
    markdown: buildMapMarkdown({
      title: path,
      sections: [
        { heading: "Uses", body: renderTree(usesTree) },
        { heading: "Used by", body: renderTree(usedByTree) }
      ],
      mermaid: renderMermaid(mermaidEdges)
    }),
    mermaid: renderMermaid(mermaidEdges)
  };
}

function collectEdgesFromTree(
  root: string,
  node: MapTreeNode,
  direction: "forward" | "reverse",
  parent = root
): MermaidEdge[] {
  const edges: MermaidEdge[] = [];
  for (const child of node.children) {
    edges.push(
      direction === "forward"
        ? { from: parent, to: child.path }
        : { from: child.path, to: parent }
    );
    if (!child.isCycle) {
      edges.push(...collectEdgesFromTree(root, child, direction, child.path));
    }
  }
  return edges;
}

function buildFeatureMap(
  _snapshot: ProjectMap,
  name: string
): { markdown: string; mermaid: string } {
  // Phase 3.
  return {
    markdown: buildMapMarkdown({
      title: name,
      sections: [{ heading: "Status", body: "Feature-level mapping lands in Phase 3." }]
    }),
    mermaid: "graph LR"
  };
}

function buildProjectMap(_snapshot: ProjectMap): { markdown: string; mermaid: string } {
  // Phase 4.
  return {
    markdown: buildMapMarkdown({
      title: "Project",
      sections: [{ heading: "Status", body: "Curated project-level mapping lands in Phase 4." }]
    }),
    mermaid: "graph LR"
  };
}

function slugifyMapName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "map";
}
