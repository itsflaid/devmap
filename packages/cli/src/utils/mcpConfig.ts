import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseJsonText } from "../analyzers/analysis/jsonText.js";
import { DevmapError } from "./errors.js";

export type McpClient = "opencode" | "claude" | "cursor";
export type McpConfigStatus = "created" | "added" | "unchanged" | "skipped";

export type McpConfigResult = {
  client: McpClient;
  file: string;
  status: McpConfigStatus;
  reason?: string;
};

export const MCP_CLIENTS: readonly McpClient[] = ["opencode", "claude", "cursor"];

export const MCP_CLIENT_LABELS: Record<McpClient, string> = {
  opencode: "OpenCode (opencode.json)",
  claude: "Claude Code (.mcp.json)",
  cursor: "Cursor (.cursor/mcp.json)"
};

type McpTarget = {
  file: string;
  containerKey: string;
  entry: Record<string, unknown>;
  header: Record<string, unknown>;
};

const SERVER_NAME = "devmap";

const MCP_TARGETS: Record<McpClient, McpTarget> = {
  opencode: {
    file: "opencode.json",
    containerKey: "mcp",
    header: { $schema: "https://opencode.ai/config.json" },
    entry: {
      type: "local",
      command: ["npx", "-y", "@flaid/devmap", "mcp"],
      enabled: true,
      timeout: 30000
    }
  },
  claude: {
    file: ".mcp.json",
    containerKey: "mcpServers",
    header: {},
    entry: { command: "npx", args: ["-y", "@flaid/devmap", "mcp"] }
  },
  cursor: {
    file: ".cursor/mcp.json",
    containerKey: "mcpServers",
    header: {},
    entry: {
      command: "npx",
      args: ["-y", "@flaid/devmap", "mcp", "--root", "${workspaceFolder}"]
    }
  }
};

export function parseMcpClients(value: string): McpClient[] {
  const requested = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  const unknown = requested.filter((item) => !MCP_CLIENTS.includes(item as McpClient));
  if (unknown.length > 0 || requested.length === 0) {
    throw new DevmapError(
      `Unknown MCP client: ${unknown.join(", ") || "(none given)"}.`,
      `Use one or more of: ${MCP_CLIENTS.join(", ")}.`
    );
  }

  return [...new Set(requested)] as McpClient[];
}

export async function ensureMcpConfig(
  projectRoot: string,
  client: McpClient
): Promise<McpConfigResult> {
  const target = MCP_TARGETS[client];
  const path = join(projectRoot, target.file);
  const base = { client, file: target.file };

  let raw: string | null = null;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (raw === null) {
    await writeJson(path, {
      ...target.header,
      [target.containerKey]: { [SERVER_NAME]: target.entry }
    });
    return { ...base, status: "created" };
  }

  let parsed: unknown;
  try {
    parsed = parseJsonText(raw);
  } catch {
    return { ...base, status: "skipped", reason: "the file is not plain JSON, add the entry by hand" };
  }

  if (!isRecord(parsed)) {
    return { ...base, status: "skipped", reason: "the file does not contain a JSON object" };
  }

  const existing = parsed[target.containerKey];
  if (existing !== undefined && !isRecord(existing)) {
    return { ...base, status: "skipped", reason: `"${target.containerKey}" is not an object` };
  }

  const container = existing ?? {};
  if (SERVER_NAME in container) {
    return { ...base, status: "unchanged" };
  }

  await writeJson(path, {
    ...parsed,
    [target.containerKey]: { ...container, [SERVER_NAME]: target.entry }
  });
  return { ...base, status: "added" };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function detectMcpRegistrations(projectRoot: string): Promise<McpClient[]> {
  const registered: McpClient[] = [];

  for (const client of MCP_CLIENTS) {
    const target = MCP_TARGETS[client];
    try {
      const parsed = parseJsonText(await readFile(join(projectRoot, target.file), "utf8"));
      const container = isRecord(parsed) ? parsed[target.containerKey] : undefined;
      if (isRecord(container) && SERVER_NAME in container) {
        registered.push(client);
      }
    } catch {
      continue;
    }
  }

  return registered;
}
