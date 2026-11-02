import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DEVMAP_VERSION } from "../utils/packageMetadata.js";
import { createDevmapServer } from "./server.js";

export type McpHealth = {
  ok: boolean;
  tools: number;
  error?: string;
};

const HEALTH_TIMEOUT_MS = 5_000;

const EXPECTED_TOOLS = [
  "devmap_overview",
  "devmap_map",
  "devmap_flow",
  "devmap_routes",
  "devmap_impact",
  "devmap_find",
  "devmap_analyze"
];

/**
 * Starts the MCP server in-process, connects a client over a linked in-memory
 * pair and lists the tools. Nothing is written and no stdio is touched.
 */
export async function checkMcpServer(projectRoot: string): Promise<McpHealth> {
  const { server } = createDevmapServer({ projectRoot });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "devmap-doctor", version: DEVMAP_VERSION });
  let timer: NodeJS.Timeout | undefined;

  try {
    const handshake = (async () => {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      return client.listTools();
    })();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no response within ${HEALTH_TIMEOUT_MS / 1000}s`)),
        HEALTH_TIMEOUT_MS
      );
    });

    const { tools } = await Promise.race([handshake, timeout]);
    const names = new Set(tools.map((tool) => tool.name));
    const missing = EXPECTED_TOOLS.filter((name) => !names.has(name));

    return missing.length > 0
      ? { ok: false, tools: tools.length, error: `missing tools: ${missing.join(", ")}` }
      : { ok: true, tools: tools.length };
  } catch (error) {
    return { ok: false, tools: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timer) clearTimeout(timer);
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
