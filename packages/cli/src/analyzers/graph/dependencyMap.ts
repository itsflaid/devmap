import type { FileGraph } from "./dependencyGraph.js";

/**
 * buildReverseGraph — invert a forward file-import graph into a
 * "who depends on me" graph. `fileGraph` maps a file to the files it
 * imports; the reverse maps a file to the files that import it.
 */
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
 * Default cap on direct children shown per node. Hub files (a shared
 * types.ts, utils.ts, a common UI component) can have very high fan-in —
 * without a cap, a single "used by" tree (or the mermaid diagram built from
 * it) can balloon to hundreds of lines/nodes and become unreadable. Pass
 * `maxChildren: Infinity` (wired to the `--all` flag) to bypass this.
 */
export const DEFAULT_MAX_CHILDREN = 25;

/**
 * buildBoundedTree — walk a graph outward from `root` up to `maxDepth` hops,
 * stopping (and flagging isCycle) whenever a path revisits a file already on
 * the current branch. File dependency graphs commonly have real cycles
 * (A imports B imports A), so a naive walk without a visited-per-branch set
 * would recurse forever.
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

/**
 * collectNodesWithinDepth — flat, deduplicated list of every file reachable
 * from `root` within `maxDepth` hops (root excluded). Used for feature-level
 * "what does this feature touch outside itself" style queries where a flat
 * set is more useful than a nested tree.
 */
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
