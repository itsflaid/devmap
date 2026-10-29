import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ProjectMap } from "../src/analyzers/pipeline/index.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { getSnapshotPath, readSnapshot, saveSnapshot } from "../src/cache/snapshot.js";
import {
  createDevmapServer,
  type DevmapServerOptions
} from "../src/mcp/server.js";
import { queryImpact } from "../src/mcp/queries.js";
import {
  acquireLock,
  createRefresher,
  LOCK_STALE_MS,
  type AnalyzeFn
} from "../src/mcp/refresh.js";
import { createSnapshotProvider } from "../src/mcp/snapshotProvider.js";
import { DevmapError } from "../src/utils/errors.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testDirectory, "..");
const hubFixture = join(testDirectory, "fixtures", "hub-fanin");

/** A tiny real project with a saved, current snapshot. */
async function tinyProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-mcp-fresh-"));
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "fresh-app", version: "1.0.0" }));
  await writeFile(join(projectRoot, "src", "index.ts"), "export const a = 1;\n");
  await saveSnapshot(projectRoot, await createProjectMap(projectRoot));
  return projectRoot;
}

async function addFile(projectRoot: string, name = "extra.ts"): Promise<void> {
  await writeFile(join(projectRoot, "src", name), `export const v${Date.now()} = 2;\n`);
}

/** Wraps the real static analysis and counts how often it runs. */
function countingAnalyze(): { analyze: AnalyzeFn; calls: Array<{ fresh: boolean; offline: boolean }> } {
  const calls: Array<{ fresh: boolean; offline: boolean }> = [];
  const analyze: AnalyzeFn = async (projectRoot, options) => {
    calls.push(options);
    const { runAnalyze } = await import("../src/commands/analyze.js");
    const { withJsonOutput } = await import("../src/utils/output.js");
    return withJsonOutput(() => runAnalyze(
      projectRoot,
      { fresh: options.fresh, offline: options.offline, json: true },
      {}
    ));
  };
  return { analyze, calls };
}

async function connect(
  options: DevmapServerOptions
): Promise<{ client: Client; close: () => Promise<void> }> {
  const { server } = createDevmapServer(options);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ isError: boolean; data: any }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  return { isError: result.isError === true, data: JSON.parse(result.content[0]!.text) };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolveFn) => {
    resolvePromise = resolveFn;
  });
  return { promise, resolve: resolvePromise };
}

// ── devmap_analyze ─────────────────────────────────────────────────────────

test("devmap_analyze reports unchanged without re-analyzing when nothing changed", async () => {
  const projectRoot = await tinyProject();
  const { analyze, calls } = countingAnalyze();
  const { client, close } = await connect({ projectRoot, analyze });

  try {
    const result = await callTool(client, "devmap_analyze");
    assert.equal(result.isError, false);
    assert.equal(result.data.status, "unchanged");
    assert.equal(result.data.mode, "static");
    assert.equal(result.data.aiDataDropped, false);
    assert.deepEqual(calls, []);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap_analyze rebuilds a stale snapshot offline and clears staleness", async () => {
  const projectRoot = await tinyProject();
  const { analyze, calls } = countingAnalyze();
  const { client, close } = await connect({ projectRoot, analyze });

  try {
    await addFile(projectRoot);
    assert.equal((await callTool(client, "devmap_overview")).data.snapshot.stale, true);

    const result = await callTool(client, "devmap_analyze");
    assert.equal(result.isError, false);
    assert.equal(result.data.status, "refreshed");
    assert.deepEqual(calls, [{ fresh: false, offline: true }], "AI must stay off by default");

    const overview = await callTool(client, "devmap_overview");
    assert.equal(overview.data.snapshot.stale, false);
    assert.equal(overview.data.stats.totalFiles, result.data.stats.totalFiles);
    assert.equal(await stat(join(projectRoot, ".devmap", "analyze.lock")).then(() => true, () => false), false, "lock is released");
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap_analyze fresh:true forces a rebuild even when nothing changed", async () => {
  const projectRoot = await tinyProject();
  const { analyze, calls } = countingAnalyze();
  const { client, close } = await connect({ projectRoot, analyze });

  try {
    const result = await callTool(client, "devmap_analyze", { fresh: true });
    assert.equal(result.data.status, "refreshed");
    assert.deepEqual(calls, [{ fresh: true, offline: true }]);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("allowAi lets analysis run with AI enabled, and says so", async () => {
  const projectRoot = await tinyProject();
  const { analyze, calls } = countingAnalyze();
  const { client, close } = await connect({ projectRoot, analyze, allowAi: true });

  try {
    const tools = await client.listTools();
    const analyzeTool = tools.tools.find((tool) => tool.name === "devmap_analyze")!;
    assert.equal(analyzeTool.annotations?.openWorldHint, true);

    await addFile(projectRoot);
    const result = await callTool(client, "devmap_analyze");
    assert.equal(result.data.mode, "ai-enabled");
    assert.deepEqual(calls, [{ fresh: false, offline: false }]);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("static analysis reports aiDataDropped when the old snapshot had AI data", async () => {
  const projectRoot = await tinyProject();
  const previous = (await readSnapshot(projectRoot))!;
  await saveSnapshot(projectRoot, {
    ...previous,
    domain: { domain: "test", summary: "AI summary" } as unknown as ProjectMap["domain"]
  });
  const { analyze } = countingAnalyze();
  const { client, close } = await connect({ projectRoot, analyze });

  try {
    await addFile(projectRoot);
    const result = await callTool(client, "devmap_analyze");
    assert.equal(result.data.status, "refreshed");
    assert.equal(result.data.aiDataDropped, true);
    assert.match(result.data.note, /--allow-ai|devmap analyze/);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("concurrent devmap_analyze calls share a single analysis", async () => {
  const projectRoot = await tinyProject();
  await addFile(projectRoot);
  const gate = deferred<void>();
  let runs = 0;
  const analyze: AnalyzeFn = async (root, options) => {
    runs += 1;
    await gate.promise;
    return countingAnalyze().analyze(root, options);
  };
  const { client, close } = await connect({ projectRoot, analyze });

  try {
    const first = callTool(client, "devmap_analyze");
    const second = callTool(client, "devmap_analyze");
    await new Promise((done) => setTimeout(done, 100));
    gate.resolve();

    const [a, b] = await Promise.all([first, second]);
    assert.equal(runs, 1);
    assert.equal(a.data.status, "refreshed");
    assert.equal(b.data.status, "refreshed");
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("a slow analysis returns status running and keeps going in the background", async () => {
  const projectRoot = await tinyProject();
  await addFile(projectRoot);
  const gate = deferred<void>();
  const { analyze: realAnalyze } = countingAnalyze();
  const analyze: AnalyzeFn = async (root, options) => {
    await gate.promise;
    return realAnalyze(root, options);
  };
  const { client, close } = await connect({ projectRoot, analyze });

  try {
    const waiting = await callTool(client, "devmap_analyze", { timeoutSeconds: 1 });
    assert.equal(waiting.isError, false);
    assert.equal(waiting.data.status, "running");
    assert.match(waiting.data.hint, /again/);

    gate.resolve();
    const done = await callTool(client, "devmap_analyze", { timeoutSeconds: 30 });
    assert.equal(done.data.status, "refreshed");
    assert.equal((await callTool(client, "devmap_overview")).data.snapshot.stale, false);
  } finally {
    gate.resolve();
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap_analyze sends progress notifications while it runs", async () => {
  const projectRoot = await tinyProject();
  await addFile(projectRoot);
  const { analyze: realAnalyze } = countingAnalyze();
  const analyze: AnalyzeFn = async (root, options) => {
    await new Promise((done) => setTimeout(done, 400));
    return realAnalyze(root, options);
  };
  const { client, close } = await connect({ projectRoot, analyze, heartbeatMs: 50 });

  try {
    const progress: number[] = [];
    await client.callTool(
      { name: "devmap_analyze", arguments: {} },
      undefined,
      { onprogress: (update) => progress.push(update.progress) }
    );
    assert.ok(progress.length >= 2, `expected heartbeats, got ${progress.length}`);
    assert.deepEqual([...progress].sort((a, b) => a - b), progress, "progress must increase");
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ── auto-refresh ───────────────────────────────────────────────────────────

test("without autoRefresh, queries never write: stale results are reported as stale", async () => {
  const projectRoot = await tinyProject();
  const { analyze, calls } = countingAnalyze();
  const { client, close } = await connect({ projectRoot, analyze });

  try {
    await addFile(projectRoot);
    const before = (await stat(getSnapshotPath(projectRoot))).mtimeMs;
    const overview = await callTool(client, "devmap_overview");
    assert.equal(overview.data.snapshot.stale, true);
    assert.equal(overview.data.snapshot.refreshed, undefined);
    assert.deepEqual(calls, []);
    assert.equal((await stat(getSnapshotPath(projectRoot))).mtimeMs, before);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("autoRefresh re-analyzes a stale snapshot before answering", async () => {
  const projectRoot = await tinyProject();
  const { analyze, calls } = countingAnalyze();
  const { client, close } = await connect({ projectRoot, analyze, autoRefresh: true });

  try {
    await addFile(projectRoot);
    const overview = await callTool(client, "devmap_overview");
    assert.equal(overview.data.snapshot.stale, false);
    assert.equal(overview.data.snapshot.refreshed, true);
    assert.equal(overview.data.stats.totalFiles >= 3, true);
    assert.equal(calls.length, 1);

    const again = await callTool(client, "devmap_overview");
    assert.equal(again.data.snapshot.refreshed, undefined);
    assert.equal(calls.length, 1, "a fresh snapshot is not rebuilt again");
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("autoRefresh builds the first snapshot when none exists", async () => {
  const projectRoot = await tinyProject();
  await rm(join(projectRoot, ".devmap"), { recursive: true, force: true });
  const { analyze, calls } = countingAnalyze();
  const { client, close } = await connect({ projectRoot, analyze, autoRefresh: true });

  try {
    const overview = await callTool(client, "devmap_overview");
    assert.equal(overview.isError, false);
    assert.equal(overview.data.snapshot.refreshed, true);
    assert.equal(calls.length, 1);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("a failing auto-refresh falls back to the stale snapshot and backs off", async () => {
  const projectRoot = await tinyProject();
  let attempts = 0;
  const analyze: AnalyzeFn = async () => {
    attempts += 1;
    throw new Error("boom");
  };
  const { client, close } = await connect({ projectRoot, analyze, autoRefresh: true });

  try {
    await addFile(projectRoot);
    const first = await callTool(client, "devmap_overview");
    assert.equal(first.isError, false, "stale data is better than no data");
    assert.equal(first.data.snapshot.stale, true);
    assert.equal(first.data.snapshot.refreshError, "boom");
    assert.match(first.data.snapshot.note, /Auto-refresh failed/);

    await callTool(client, "devmap_overview");
    assert.equal(attempts, 1, "retry is held back during the cooldown");
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("provider auto-refresh retries after the cooldown", async () => {
  const projectRoot = await tinyProject();
  let attempts = 0;
  let clock = 1_000;
  const provider = createSnapshotProvider(projectRoot, {
    staleTtlMs: 0,
    now: () => clock,
    retryCooldownMs: 100,
    autoRefresh: async () => {
      attempts += 1;
      throw new Error("nope");
    }
  });

  try {
    await addFile(projectRoot);
    await provider.get();
    clock += 50;
    await provider.get();
    assert.equal(attempts, 1);
    clock += 100;
    await provider.get();
    assert.equal(attempts, 2);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ── lock ───────────────────────────────────────────────────────────────────

test("analysis refuses to start while a live process holds the lock", async () => {
  const projectRoot = await tinyProject();

  try {
    const release = await acquireLock(projectRoot);
    await assert.rejects(
      () => acquireLock(projectRoot),
      (error: unknown) => error instanceof DevmapError && /already running/.test(error.message)
    );
    await release();

    const again = await acquireLock(projectRoot);
    await again();
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("a lock from a dead process or an expired lock is taken over", async () => {
  const projectRoot = await tinyProject();
  const lockFile = join(projectRoot, ".devmap", "analyze.lock");

  try {
    await writeFile(lockFile, JSON.stringify({ pid: 2_147_483_000, startedAt: new Date().toISOString() }));
    await (await acquireLock(projectRoot))();

    await writeFile(lockFile, JSON.stringify({
      pid: process.pid,
      startedAt: new Date(Date.now() - LOCK_STALE_MS - 1_000).toISOString()
    }));
    await (await acquireLock(projectRoot))();

    await writeFile(lockFile, "not json");
    await (await acquireLock(projectRoot))();
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap_analyze surfaces a held lock as a structured error", async () => {
  const projectRoot = await tinyProject();
  await addFile(projectRoot);
  const { analyze } = countingAnalyze();
  const { client, close } = await connect({ projectRoot, analyze });
  const release = await acquireLock(projectRoot);

  try {
    const result = await callTool(client, "devmap_analyze");
    assert.equal(result.isError, true);
    assert.match(result.data.error, /already running/);
    assert.match(result.data.hint, /retry/i);
  } finally {
    await release();
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("refresher: unchanged projects skip the lock and the analysis", async () => {
  const projectRoot = await tinyProject();
  const { analyze, calls } = countingAnalyze();
  const refresher = createRefresher({ projectRoot, analyze });

  try {
    const release = await acquireLock(projectRoot); // would block a real analysis
    const outcome = await refresher.run();
    assert.equal(outcome.status, "unchanged");
    assert.deepEqual(calls, []);
    await release();
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ── impact (transitive) ────────────────────────────────────────────────────

test("devmap_impact follows imports transitively and reports affected features", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-mcp-impact-"));
  await cp(hubFixture, projectRoot, { recursive: true });
  const snapshot = await createProjectMap(projectRoot);
  await saveSnapshot(projectRoot, snapshot);

  try {
    // Pick the file with the most direct dependents.
    const [hub] = Object.entries(snapshot.changeImpact)
      .sort((a, b) => b[1].dependents.length - a[1].dependents.length)[0]!;

    const shallow = queryImpact(snapshot, hub, { depth: 1 });
    const deep = queryImpact(snapshot, hub, { depth: 3 });

    assert.equal(shallow.transitive.depth, 1);
    assert.ok(shallow.transitive.files.every((entry) => entry.depth === 1));
    assert.ok(deep.transitive.count >= shallow.transitive.count);
    assert.equal(deep.dependentCount, snapshot.changeImpact[hub]!.dependents.length);
    assert.ok(!deep.transitive.files.some((entry) => entry.file === hub), "the file is not its own dependent");
    assert.deepEqual(
      deep.transitive.files.map((entry) => entry.depth),
      [...deep.transitive.files.map((entry) => entry.depth)].sort((a, b) => a - b),
      "ordered by hop"
    );
    assert.equal(typeof deep.isCritical, "boolean");
    assert.ok(Array.isArray(deep.affectedFeatures));
    assert.ok(deep.criticalDependents.every((path) => snapshot.criticalFiles.some((file) => file.path === path)));

    const limited = queryImpact(snapshot, hub, { depth: 3, limit: 1 });
    assert.equal(limited.transitive.files.length, Math.min(1, deep.transitive.count));
    assert.equal(limited.transitive.truncated, deep.transitive.count > 1);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("transitive impact is cycle-safe", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-mcp-cycle-"));
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "cycle", version: "1.0.0" }));
  await writeFile(join(projectRoot, "src", "a.ts"), 'import { b } from "./b";\nexport const a = () => b;\n');
  await writeFile(join(projectRoot, "src", "b.ts"), 'import { a } from "./a";\nexport const b = () => a;\n');

  try {
    const snapshot = await createProjectMap(projectRoot);
    const impact = queryImpact(snapshot, "src/a.ts", { depth: 5 });
    assert.deepEqual(impact.transitive.files.map((entry) => entry.file), ["src/b.ts"]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ── prompts ────────────────────────────────────────────────────────────────

test("prompts expose ready-made DevMap workflows", async () => {
  const projectRoot = await tinyProject();
  const { client, close } = await connect({ projectRoot });

  try {
    const { prompts } = await client.listPrompts();
    assert.deepEqual(prompts.map((prompt) => prompt.name).sort(), ["devmap_onboard", "devmap_plan_change"]);

    const onboard = await client.getPrompt({ name: "devmap_onboard", arguments: { focus: "payments" } });
    const onboardText = (onboard.messages[0]!.content as { text: string }).text;
    assert.match(onboardText, /devmap_overview/);
    assert.match(onboardText, /payments/);

    const plan = await client.getPrompt({
      name: "devmap_plan_change",
      arguments: { change: "add rate limiting to login" }
    });
    const planText = (plan.messages[0]!.content as { text: string }).text;
    assert.match(planText, /add rate limiting to login/);
    for (const tool of ["devmap_find", "devmap_map", "devmap_impact", "devmap_analyze"]) {
      assert.match(planText, new RegExp(tool));
    }

    await assert.rejects(() => client.getPrompt({ name: "devmap_plan_change", arguments: {} }));
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// ── real process ───────────────────────────────────────────────────────────

test("devmap mcp --auto-refresh over stdio refreshes a stale project with a clean protocol stream", async () => {
  const projectRoot = await tinyProject();
  await addFile(projectRoot);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", join(packageRoot, "src", "index.ts"), "mcp", "--root", projectRoot, "--auto-refresh"],
    cwd: packageRoot,
    stderr: "pipe"
  });
  const client = new Client({ name: "stdio-fresh-client", version: "0.0.0" });
  const protocolErrors: unknown[] = [];
  transport.onerror = (error) => protocolErrors.push(error);

  try {
    await client.connect(transport);

    // A real analysis runs inside the server process; any stray console/spinner
    // output on stdout would be reported as a protocol error.
    const overview = await callTool(client, "devmap_overview");
    assert.equal(overview.isError, false);
    assert.equal(overview.data.snapshot.refreshed, true);
    assert.equal(overview.data.snapshot.stale, false);

    const forced = await callTool(client, "devmap_analyze", { fresh: true });
    assert.equal(forced.data.status, "refreshed");
    assert.equal(forced.data.mode, "static");

    assert.deepEqual(protocolErrors, []);
    const saved = JSON.parse(await readFile(getSnapshotPath(projectRoot), "utf8")) as ProjectMap;
    assert.ok(saved.stats.totalFiles >= 3);
  } finally {
    await client.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});
