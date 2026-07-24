import type { MapTreeNode } from "../analyzers/graph/dependencyMap.js";

/**
 * renderTree — render a MapTreeNode as an indented, box-drawing tree
 * (same visual convention as the Unix `tree` command). Cycle-closing nodes
 * are suffixed with "(cycle)" instead of being expanded further.
 */
export function renderTree(node: MapTreeNode, prefix = ""): string {
  const lines: string[] = [];
  renderTreeLines(node.children, prefix, lines);
  return lines.length > 0 ? lines.join("\n") : "(no connections found)";
}

function renderTreeLines(
  children: MapTreeNode[],
  prefix: string,
  lines: string[]
): void {
  children.forEach((child, index) => {
    const isLast = index === children.length - 1;
    const branch = isLast ? "└── " : "├── ";
    const nextPrefix = prefix + (isLast ? "    " : "│   ");
    const suffix = child.isCycle ? " (cycle)" : "";

    lines.push(`${prefix}${branch}${child.path}${suffix}`);
    if (!child.isCycle) {
      renderTreeLines(child.children, nextPrefix, lines);
    }
  });
}

/**
 * renderFlatList — simple bullet list for cases (feature/project mode) where
 * a flat "these files are involved" view reads better than a nested tree.
 */
export function renderFlatList(paths: string[]): string {
  if (paths.length === 0) return "(none)";
  return paths.map((path) => `  - ${path}`).join("\n");
}

export type MermaidEdge = { from: string; to: string };

/**
 * renderMermaid — render a set of file-to-file edges as a Mermaid
 * flowchart. Mermaid node IDs can't contain slashes/dots, so each real path
 * gets a sanitized ID with the real path kept as the visible label.
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

/**
 * buildMapMarkdown — wrap a text tree + Mermaid diagram into a single .md
 * body, in the same style as the rest of DevMap's generated docs.
 */
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
