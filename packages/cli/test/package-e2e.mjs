import assert from "node:assert/strict";
import { exec, execFile } from "node:child_process";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const executeShell = promisify(exec);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testDirectory, "..");
const workspaceRoot = resolve(packageRoot, "../..");
const pnpmCli = process.env.npm_execpath;
const npmExecutable = join(
  dirname(process.execPath),
  process.platform === "win32" ? "npm.cmd" : "npm"
);

if (!pnpmCli) {
  throw new Error("Run this test through pnpm so npm_execpath is available.");
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "devmap-package-e2e-"));
const artifactsDirectory = join(temporaryRoot, "artifacts");
const isolatedHome = join(temporaryRoot, "home");

try {
  await mkdir(artifactsDirectory, { recursive: true });
  await mkdir(isolatedHome, { recursive: true });

  await runNodeCli(pnpmCli, [
    "--filter",
    "@flaid/devmap",
    "pack",
    "--pack-destination",
    artifactsDirectory
  ], workspaceRoot);

  const tarballName = (await readdir(artifactsDirectory))
    .find((file) => file.endsWith(".tgz"));
  assert.ok(tarballName, "Expected pnpm pack to create a tarball.");

  const tarballPath = join(artifactsDirectory, tarballName);
  await verifyProject("nextjs-project", "nextjs");
  await verifyProject("express-project", "express");
  await verifyProject("react-project", "react");

  console.log("Packed CLI E2E passed for Next.js, Express, and React fixtures.");

  async function verifyProject(fixtureName, expectedFramework) {
    const projectRoot = join(temporaryRoot, fixtureName);
    await cp(join(testDirectory, "fixtures", fixtureName), projectRoot, {
      recursive: true
    });

    const packageJsonPath = join(projectRoot, "package.json");
    const fixturePackageJson = await readFile(packageJsonPath, "utf8");
    await writeFile(packageJsonPath, JSON.stringify({
      name: `devmap-e2e-${fixtureName}`,
      private: true
    }, null, 2), "utf8");

    await runNpm([
      "install",
      "--no-package-lock",
      "--ignore-scripts",
      "--save-dev",
      tarballPath
    ], projectRoot);

    await writeFile(packageJsonPath, fixturePackageJson, "utf8");

    const version = await runDevmap(projectRoot, ["--version"]);
    assert.match(version.stdout, /^0\.2\.0/m);

    const help = await runDevmap(projectRoot, ["--help"]);
    assert.match(stripAnsi(help.stdout), /analyze\s+\[target\]\s+Analyze project structure/);

    const analyze = await runDevmap(projectRoot, ["analyze", "--fresh"]);
    assert.match(
      stripAnsi(analyze.stdout),
      new RegExp(`Framework\\s+${expectedFramework}`, "i")
    );

    const snapshotPath = join(projectRoot, ".devmap", "snapshot.json");
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
    assert.equal(snapshot.project.framework, expectedFramework);
    const agentIndex = JSON.parse(await readFile(
      join(projectRoot, ".devmap", "index.json"),
      "utf8"
    ));
    assert.equal(agentIndex.snapshot.path, ".devmap/snapshot.json");
    assert.ok(Array.isArray(agentIndex.features));
    for (const feature of agentIndex.features) {
      const featureMap = JSON.parse(await readFile(join(projectRoot, feature.map), "utf8"));
      assert.equal(featureMap.id, feature.id);
      assert.ok(Array.isArray(featureMap.sourcePriority));
    }

    const analyzeJson = parseJsonOutput(await runDevmap(projectRoot, [
      "analyze",
      "--fresh",
      "--json"
    ]));
    assert.equal(analyzeJson.project.framework, expectedFramework);

    const flow = await runDevmap(projectRoot, ["flow"]);
    const flowOutput = stripAnsi(flow.stdout);
    if (snapshot.flows.length > 0) {
      assert.match(flowOutput, /Wrote \.devmap\/flows\/.*\.md/);
    }

    const flowJson = parseJsonOutput(await runDevmap(projectRoot, [
      "flow",
      "--json"
    ]));
    assert.equal(flowJson.status, "ok");
    assert.ok(Array.isArray(flowJson.flows));
    assert.equal(flowJson.flows.length, snapshot.flows.length);
    assert.ok(flowJson.writtenPaths.length === flowJson.flows.length);
    for (const path of flowJson.writtenPaths) {
      await readFile(join(projectRoot, path.markdown), "utf8");
    }

    const doctor = await runDevmap(projectRoot, ["doctor"]);
    const doctorOutput = stripAnsi(doctor.stdout);
    assert.match(doctorOutput, /DevMap Doctor/);
    assert.match(doctorOutput, /Config\s+missing/i);

    const doctorJson = parseJsonOutput(await runDevmap(projectRoot, [
      "doctor",
      "--json"
    ]));
    assert.equal(doctorJson.config, "missing");
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function runDevmap(cwd, args) {
  return runNpm(["exec", "--", "devmap", ...args], cwd);
}

async function runNodeCli(cliPath, args, cwd) {
  return runExecutable(process.execPath, [cliPath, ...args], cwd);
}

async function runNpm(args, cwd) {
  if (process.platform !== "win32") {
    return runExecutable(npmExecutable, args, cwd);
  }

  const command = [npmExecutable, ...args]
    .map(quoteWindowsArgument)
    .join(" ");
  return executeShell(command, commandOptions(cwd));
}

async function runExecutable(executable, args, cwd) {
  return execute(executable, args, commandOptions(cwd));
}

function commandOptions(cwd) {
  return {
    cwd,
    env: {
      ...process.env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      NO_COLOR: "1"
    },
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true
  };
}

function quoteWindowsArgument(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function parseJsonOutput(result) {
  assert.doesNotMatch(result.stdout, /\u001B\[|─|•/);
  return JSON.parse(result.stdout);
}
