import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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
const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testDirectory, "..");
const workspaceRoot = resolve(packageRoot, "../..");
const pnpmCli = process.env.npm_execpath;
const npmCli = resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");

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
    "devmap",
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

  console.log("Packed CLI E2E passed for Next.js and Express fixtures.");

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

    await runNodeCli(npmCli, [
      "install",
      "--no-package-lock",
      "--ignore-scripts",
      "--save-dev",
      tarballPath
    ], projectRoot);

    await writeFile(packageJsonPath, fixturePackageJson, "utf8");

    const version = await runDevmap(projectRoot, ["--version"]);
    assert.match(version.stdout, /^0\.1\.0/m);

    const help = await runDevmap(projectRoot, ["--help"]);
    assert.match(stripAnsi(help.stdout), /analyze\s+Analyze project structure/);

    const analyze = await runDevmap(projectRoot, ["analyze", "--fresh"]);
    assert.match(
      stripAnsi(analyze.stdout),
      new RegExp(`Framework\\s+${expectedFramework}`, "i")
    );

    const snapshotPath = join(projectRoot, ".devmap", "snapshot.json");
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
    assert.equal(snapshot.project.framework, expectedFramework);

    const ask = await runDevmap(projectRoot, [
      "ask",
      "Where is the main application entry point?"
    ]);
    assert.match(stripAnsi(ask.stdout), /Relevant Files/);

    const doctor = await runDevmap(projectRoot, ["doctor"]);
    const doctorOutput = stripAnsi(doctor.stdout);
    assert.match(doctorOutput, /DevMap Doctor/);
    assert.match(doctorOutput, /Config\s+missing/i);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function runDevmap(cwd, args) {
  return runNodeCli(npmCli, ["exec", "--", "devmap", ...args], cwd);
}

async function runNodeCli(cliPath, args, cwd) {
  return execute(process.execPath, [cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      NO_COLOR: "1"
    },
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true
  });
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}
