import type { FileGraph } from "./dependencyGraph.js";

/** Inverts a file -> imports graph into file -> importers ("who depends on me"). */
export function buildReverseGraph(fileGraph: FileGraph): FileGraph {
  const reverse: FileGraph = {};

  for (const [file, dependencies] of Object.entries(fileGraph)) {
    for (const dependency of dependencies) {
      const dependents = reverse[dependency] ?? (reverse[dependency] = []);
      if (!dependents.includes(file)) {
        dependents.push(file);
      }
    }
  }

  return reverse;
}

export type MapTreeNode = {
  path: string;
  children: MapTreeNode[];
  /** true if this node closes a cycle back to an ancestor already shown above it */
  isCycle: boolean;
  /** number of additional direct children that exist but were cut off by maxChildren */
  truncatedCount?: number;
};

/**
 * Default cap on direct children shown per node. Hub files (shared types.ts,
 * utils.ts, common UI components) have huge fan-in, and a "used by" tree or
 * mermaid diagram without a cap grows to hundreds of unreadable nodes. Pass
 * `maxChildren: Infinity` (the `--all` flag) to bypass it.
 */
export const DEFAULT_MAX_CHILDREN = 25;

/**
 * Walks the graph outward from `root` up to `maxDepth` hops. A path that
 * revisits a file already on its branch stops and is flagged `isCycle`; import
 * cycles (A imports B imports A) are real and would otherwise recurse forever.
 */
export function buildBoundedTree(
  graph: FileGraph,
  root: string,
  maxDepth: number,
  options: { ancestors?: string[]; filter?: (path: string) => boolean; maxChildren?: number } = {}
): MapTreeNode {
  const ancestors = options.ancestors ?? [root];
  const maxChildren = options.maxChildren ?? DEFAULT_MAX_CHILDREN;

  if (maxDepth <= 0) {
    return { path: root, children: [], isCycle: false };
  }

  const candidates = (graph[root] ?? []).filter(
    (next) => !options.filter || options.filter(next)
  );
  const shown = candidates.slice(0, maxChildren);
  const truncatedCount = candidates.length - shown.length;

  const children: MapTreeNode[] = [];
  for (const next of shown) {
    if (ancestors.includes(next)) {
      children.push({ path: next, children: [], isCycle: true });
      continue;
    }
    children.push(
      buildBoundedTree(graph, next, maxDepth - 1, {
        ancestors: [...ancestors, next],
        filter: options.filter,
        maxChildren
      })
    );
  }

  return {
    path: root,
    children,
    isCycle: false,
    ...(truncatedCount > 0 ? { truncatedCount } : {})
  };
}

/** Flat, deduplicated list of files reachable from `root` within `maxDepth` hops, root excluded. */
export function collectNodesWithinDepth(
  graph: FileGraph,
  root: string,
  maxDepth: number
): string[] {
  const visited = new Set<string>([root]);
  let frontier = [root];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const file of frontier) {
      for (const neighbor of graph[file] ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }

  visited.delete(root);
  return [...visited];
}
