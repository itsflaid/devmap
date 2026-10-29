import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDevmapServer } from "../mcp/server.js";

export type McpOptions = {
  root?: string;
  /** Re-analyze automatically when the snapshot is stale or missing. Default off. */
  autoRefresh?: boolean;
  /** Allow analysis to use the configured AI provider. Default off. */
  allowAi?: boolean;
};

/**
 * Run DevMap as an MCP server over stdio.
 *
 * stdout carries the JSON-RPC stream, so anything else that would print there
 * must go to stderr instead. Every console method that writes to stdout is
 * redirected before the server starts.
 */
export async function mcpCommand(options: McpOptions = {}): Promise<void> {
  const redirect = (...values: unknown[]): void => {
    console.error(...values);
  };
  console.log = redirect;
  console.info = redirect;
  console.debug = redirect;

  const projectRoot = resolve(options.root ?? ".");
  const { server } = createDevmapServer({
    projectRoot,
    autoRefresh: options.autoRefresh === true,
    allowAi: options.allowAi === true
  });
  const transport = new StdioServerTransport();

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.stdin.once("end", shutdown);

  await server.connect(transport);
  const modes = [
    options.autoRefresh ? "auto-refresh" : undefined,
    options.allowAi ? "ai-enabled" : undefined
  ].filter(Boolean);
  console.error(
    `DevMap MCP server ready (root: ${projectRoot}${modes.length > 0 ? `, ${modes.join(", ")}` : ""})`
  );
}
