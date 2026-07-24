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
  renderFlatList,
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
  snapshot: ProjectMap,
  name: string
): { markdown: string; mermaid: string } {
  const feature = snapshot.features.find((candidate) => candidate.name === name);
  if (!feature) {
    throw new DevmapError(`Feature "${name}" not found in the current snapshot.`);
  }

  const featureFiles = new Set(feature.files);
  const reverseGraph = buildReverseGraph(snapshot.fileGraph);
  const root = feature.entryPoint ?? feature.files[0];

  const internalTree = root
    ? buildBoundedTree(snapshot.fileGraph, root, 4, {
        filter: (path) => featureFiles.has(path)
      })
    : { path: name, children: [], isCycle: false };

  const reached = new Set<string>();
  if (root) collectTreePaths(internalTree, reached);
  const unreached = feature.files.filter((path) => path !== root && !reached.has(path));

  const externalDependencies = new Set<string>();
  const dependencyEdges: MermaidEdge[] = [];
  for (const file of feature.files) {
    for (const dependency of snapshot.fileGraph[file] ?? []) {
      if (!featureFiles.has(dependency)) {
        externalDependencies.add(dependency);
        dependencyEdges.push({ from: file, to: dependency });
      }
    }
  }

  const externalDependents = new Set<string>();
  const dependentEdges: MermaidEdge[] = [];
  for (const file of feature.files) {
    for (const dependent of reverseGraph[file] ?? []) {
      if (!featureFiles.has(dependent)) {
        externalDependents.add(dependent);
        dependentEdges.push({ from: dependent, to: file });
      }
    }
  }

  const internalEdges = root ? collectEdgesFromTree(root, internalTree, "forward") : [];
  const mermaidEdges = [...internalEdges, ...dependencyEdges, ...dependentEdges];

  const sections = [
    {
      heading: "Internal structure",
      body: root ? `${root}\n${renderTree(internalTree)}` : renderTree(internalTree)
    }
  ];
  if (unreached.length > 0) {
    sections.push({ heading: "Other files in this feature", body: renderFlatList(unreached) });
  }
  sections.push(
    { heading: "Depends on (outside this feature)", body: renderFlatList([...externalDependencies]) },
    { heading: "Used by (outside this feature)", body: renderFlatList([...externalDependents]) }
  );

  return {
    markdown: buildMapMarkdown({ title: name, sections, mermaid: renderMermaid(mermaidEdges) }),
    mermaid: renderMermaid(mermaidEdges)
  };
}

function collectTreePaths(node: MapTreeNode, into: Set<string>): void {
  into.add(node.path);
  if (!node.isCycle) {
    for (const child of node.children) collectTreePaths(child, into);
  }
}

function buildProjectMap(snapshot: ProjectMap): { markdown: string; mermaid: string } {
  const features = snapshot.features;
  const fileToFeature = new Map<string, string>();
  for (const feature of features) {
    for (const file of feature.files) {
      if (!fileToFeature.has(file)) fileToFeature.set(file, feature.name);
    }
  }

  const featureSummaries = features.map(
    (feature) => `${feature.name} (${feature.files.length} file${feature.files.length === 1 ? "" : "s"})`
  );

  const crossFeatureEdgeKeys = new Set<string>();
  const mermaidEdges: MermaidEdge[] = [];
  for (const feature of features) {
    for (const file of feature.files) {
      for (const dependency of snapshot.fileGraph[file] ?? []) {
        const dependencyFeature = fileToFeature.get(dependency);
        if (dependencyFeature && dependencyFeature !== feature.name) {
          const key = `${feature.name}=>${dependencyFeature}`;
          if (!crossFeatureEdgeKeys.has(key)) {
            crossFeatureEdgeKeys.add(key);
            mermaidEdges.push({ from: feature.name, to: dependencyFeature });
          }
        }
      }
    }
  }

  const relationshipLines = [...crossFeatureEdgeKeys].map((key) => {
    const [from, to] = key.split("=>");
    return `  - ${from} → ${to}`;
  });

  const totalFiles = Object.keys(snapshot.fileIndex).length;
  const mappedFiles = fileToFeature.size;
  const coverageNote = totalFiles > 0
    ? `${mappedFiles} of ${totalFiles} files belong to a detected feature. The rest (config, infra, tests, etc.) aren't shown here — use "devmap map <file>" for any specific file.`
    : "(no files scanned)";

  const sections = [
    {
      heading: "Features",
      body: featureSummaries.length > 0 ? renderFlatList(featureSummaries) : "(none detected)"
    },
    {
      heading: "Feature relationships",
      body: relationshipLines.length > 0
        ? relationshipLines.join("\n")
        : "(no cross-feature dependencies detected)"
    },
    { heading: "Entry points", body: renderFlatList(snapshot.entryPoints) },
    { heading: "Coverage", body: coverageNote }
  ];

  return {
    markdown: buildMapMarkdown({ title: "Project", sections, mermaid: renderMermaid(mermaidEdges) }),
    mermaid: renderMermaid(mermaidEdges)
  };
}

function slugifyMapName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "map";
}
