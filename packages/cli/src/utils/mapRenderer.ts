import type { MapTreeNode } from "../analyzers/graph/dependencyMap.js";

/**
 * Box-drawing tree in the style of the Unix `tree` command. Cycle-closing
 * nodes get a "(cycle)" suffix instead of being expanded again.
 */
export function renderTree(node: MapTreeNode, prefix = ""): string {
  const lines: string[] = [];
  renderTreeLines(node, prefix, lines);
  return lines.length > 0 ? lines.join("\n") : "(no connections found)";
}

function renderTreeLines(
  node: MapTreeNode,
  prefix: string,
  lines: string[]
): void {
  const { children, truncatedCount } = node;
  const hasMore = Boolean(truncatedCount);

  children.forEach((child, index) => {
    const isLast = index === children.length - 1 && !hasMore;
    const branch = isLast ? "└── " : "├── ";
    const nextPrefix = prefix + (isLast ? "    " : "│   ");
    const suffix = child.isCycle ? " (cycle)" : "";

    lines.push(`${prefix}${branch}${child.path}${suffix}`);
    if (!child.isCycle) {
      renderTreeLines(child, nextPrefix, lines);
    }
  });

  if (hasMore) {
    lines.push(`${prefix}└── … +${truncatedCount} more (truncated for readability — pass --all to see everything)`);
  }
}

/** Bullet list for feature/project mode, where there is no meaningful nesting. */
export function renderFlatList(paths: string[], options: { cap?: number } = {}): string {
  if (paths.length === 0) return "(none)";
  const cap = options.cap ?? Infinity;
  const shown = paths.slice(0, cap);
  const lines = shown.map((path) => `  - ${path}`);
  const omitted = paths.length - shown.length;
  if (omitted > 0) {
    lines.push(`  - … +${omitted} more (truncated for readability — pass --all to see everything)`);
  }
  return lines.join("\n");
}

export type MermaidEdge = { from: string; to: string };

/**
 * Mermaid node IDs cannot contain slashes or dots, so each path gets a
 * sanitized ID and keeps the real path as its label.
 */
export function renderMermaid(
  edges: MermaidEdge[],
  options: { direction?: "LR" | "TD" } = {}
): string {
  const direction = options.direction ?? "LR";
  const ids = new Map<string, string>();
  const idFor = (path: string): string => {
    const existing = ids.get(path);
    if (existing) return existing;
    const id = `n${ids.size}`;
    ids.set(path, id);
    return id;
  };

  const lines = [`graph ${direction}`];
  const seenEdges = new Set<string>();

  for (const edge of edges) {
    const key = `${edge.from}=>${edge.to}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);

    const fromId = idFor(edge.from);
    const toId = idFor(edge.to);
    lines.push(`  ${fromId}["${escapeMermaidLabel(edge.from)}"] --> ${toId}["${escapeMermaidLabel(edge.to)}"]`);
  }

  return lines.join("\n");
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, "#quot;");
}

/** Wraps the text tree and Mermaid diagram into one markdown body. */
export function buildMapMarkdown(options: {
  title: string;
  sections: Array<{ heading: string; body: string }>;
  mermaid?: string;
}): string {
  const parts = [`# ${options.title}`, ""];

  for (const section of options.sections) {
    parts.push(`## ${section.heading}`, "", section.body, "");
  }

  if (options.mermaid) {
    parts.push("## Diagram", "", "```mermaid", options.mermaid, "```", "");
  }

  return parts.join("\n").trimEnd() + "\n";
}
