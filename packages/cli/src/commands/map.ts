import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  buildBoundedTree,
  buildReverseGraph,
  DEFAULT_MAX_CHILDREN,
  type MapTreeNode
} from "../analyzers/graph/index.js";
import type { ProjectMap } from "../analyzers/pipeline/index.js";
import { isSnapshotStale, readSnapshotOrThrow } from "../cache/snapshot.js";
import { DevmapError } from "../utils/errors.js";
import { slugifyMapName } from "../utils/slug.js";
import { resolveFileTarget } from "../utils/targetResolver.js";
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
const FEATURE_MAP_DEPTH = 4;

export type MapOptions = {
  json?: boolean;
  projectRoot?: string;
  target?: string;
  depth?: number;
  all?: boolean;
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
    ? buildFileMap(snapshot, resolved.value, options.depth, options.all)
    : resolved.mode === "feature"
      ? buildFeatureMap(snapshot, resolved.value, options.depth, options.all)
      : buildProjectMap(snapshot, options.all);

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

  const fileTarget = resolveFileTarget(snapshot, target);
  if (fileTarget) {
    return fileTarget;
  }

  const featureNames = snapshot.features.map((f) => f.name).join(", ") || "(none detected)";
  throw new DevmapError(
    `"${target}" isn't a known file or feature.`,
    `Known features: ${featureNames}. For a file, use its path relative to the project root.`
  );
}

function buildFileMap(
  snapshot: ProjectMap,
  path: string,
  depth?: number,
  all?: boolean
): { markdown: string; mermaid: string } {
  const reverseGraph = buildReverseGraph(snapshot.fileGraph);
  const maxChildren = all ? Infinity : DEFAULT_MAX_CHILDREN;

  const usesTree = buildBoundedTree(snapshot.fileGraph, path, depth ?? USES_DEPTH, { maxChildren });
  const usedByTree = buildBoundedTree(reverseGraph, path, depth ?? USED_BY_DEPTH, { maxChildren });

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
  name: string,
  depth?: number,
  all?: boolean
): { markdown: string; mermaid: string } {
  const feature = snapshot.features.find((candidate) => candidate.name === name);
  if (!feature) {
    throw new DevmapError(`Feature "${name}" not found in the current snapshot.`);
  }

  const featureFiles = new Set(feature.files);
  const reverseGraph = buildReverseGraph(snapshot.fileGraph);
  const root = feature.entryPoint ?? feature.files[0];
  const maxChildren = all ? Infinity : DEFAULT_MAX_CHILDREN;
  const listCap = all ? Infinity : DEFAULT_MAX_CHILDREN;

  const internalTree = root
    ? buildBoundedTree(snapshot.fileGraph, root, depth ?? FEATURE_MAP_DEPTH, {
        filter: (path) => featureFiles.has(path),
        maxChildren
      })
    : { path: name, children: [], isCycle: false };

  const reached = new Set<string>();
  if (root) collectTreePaths(internalTree, reached);
  const unreached = feature.files.filter((path) => path !== root && !reached.has(path));

  const externalDependencies = new Set<string>();
  for (const file of feature.files) {
    for (const dependency of snapshot.fileGraph[file] ?? []) {
      if (!featureFiles.has(dependency)) externalDependencies.add(dependency);
    }
  }

  const externalDependents = new Set<string>();
  for (const file of feature.files) {
    for (const dependent of reverseGraph[file] ?? []) {
      if (!featureFiles.has(dependent)) externalDependents.add(dependent);
    }
  }

  // Cap which files are actually drawn as edges to match the (possibly
  // truncated) flat lists below — otherwise the mermaid diagram could still
  // balloon even after the text list is capped.
  const shownDependencies = Number.isFinite(listCap)
    ? new Set([...externalDependencies].slice(0, listCap))
    : externalDependencies;
  const shownDependents = Number.isFinite(listCap)
    ? new Set([...externalDependents].slice(0, listCap))
    : externalDependents;

  const dependencyEdges: MermaidEdge[] = [];
  for (const file of feature.files) {
    for (const dependency of snapshot.fileGraph[file] ?? []) {
      if (shownDependencies.has(dependency)) dependencyEdges.push({ from: file, to: dependency });
    }
  }

  const dependentEdges: MermaidEdge[] = [];
  for (const file of feature.files) {
    for (const dependent of reverseGraph[file] ?? []) {
      if (shownDependents.has(dependent)) dependentEdges.push({ from: dependent, to: file });
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
    sections.push({
      heading: "Other files in this feature",
      body: renderFlatList(unreached, { cap: listCap })
    });
  }
  sections.push(
    {
      heading: "Depends on (outside this feature)",
      body: renderFlatList([...externalDependencies], { cap: listCap })
    },
    {
      heading: "Used by (outside this feature)",
      body: renderFlatList([...externalDependents], { cap: listCap })
    }
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

function buildProjectMap(snapshot: ProjectMap, all?: boolean): { markdown: string; mermaid: string } {
  if (all) {
    return buildFullProjectDump(snapshot);
  }

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

function buildFullProjectDump(snapshot: ProjectMap): { markdown: string; mermaid: string } {
  const files = Object.keys(snapshot.fileGraph).sort();
  const mermaidEdges: MermaidEdge[] = [];
  const lines: string[] = [];

  for (const file of files) {
    const dependencies = snapshot.fileGraph[file] ?? [];
    lines.push(dependencies.length > 0
      ? `  - ${file} → ${dependencies.join(", ")}`
      : `  - ${file}`);
    for (const dependency of dependencies) {
      mermaidEdges.push({ from: file, to: dependency });
    }
  }

  return {
    markdown: buildMapMarkdown({
      title: "Project (full)",
      sections: [
        {
          heading: "All files",
          body: lines.length > 0 ? lines.join("\n") : "(no files scanned)"
        }
      ],
      mermaid: renderMermaid(mermaidEdges)
    }),
    mermaid: renderMermaid(mermaidEdges)
  };
}
