/**
 * Tools the DevMap MCP server exposes, shown in the "Works as an MCP server" section.
 * Keep in step with packages/cli/src/mcp/server.ts and docs/mcp.md.
 */
export interface McpTool {
  name: string;
  text: string;
  /** Only registered when the server starts with --allow-ai. */
  needsAi?: boolean;
}

export const MCP_TOOLS: McpTool[] = [
  { name: "devmap_overview", text: "Framework, entry points, critical files, features and flows. Where an agent starts." },
  { name: "devmap_map", text: "Dependency map of the project, one feature or one file." },
  { name: "devmap_flow", text: "Trace a feature or an API request from entry to database." },
  { name: "devmap_routes", text: "List page and API routes." },
  { name: "devmap_impact", text: "What breaks if this file changes, followed through the import graph." },
  { name: "devmap_find", text: "Find features, files and routes by keyword." },
  { name: "devmap_analyze", text: "Re-analyze and refresh the snapshot. Writes only inside .devmap/." },
  { name: "devmap_explain", text: "Explain a file, feature or function with your own AI key.", needsAi: true }
];

/** The Claude Code one-liner and the .mcp.json every client can use. */
export const MCP_ADD_COMMAND = "claude mcp add devmap -- npx -y @flaid/devmap mcp";

export const MCP_CONFIG = [
  "{",
  '  "mcpServers": {',
  '    "devmap": {',
  '      "command": "npx",',
  '      "args": ["-y", "@flaid/devmap", "mcp"]',
  "    }",
  "  }",
  "}"
];
