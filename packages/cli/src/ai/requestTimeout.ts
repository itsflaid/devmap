const DEFAULT_AI_TIMEOUT_MS = 120_000;

/**
 * Abort signal for one chat request. A provider that accepts the connection and
 * never answers would otherwise block `explain`, `flow` and the MCP server forever.
 * `DEVMAP_AI_TIMEOUT_MS` overrides the default.
 */
export function aiRequestSignal(): AbortSignal {
  const configured = Number(process.env.DEVMAP_AI_TIMEOUT_MS);
  return AbortSignal.timeout(Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_AI_TIMEOUT_MS);
}

export function isRequestTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
