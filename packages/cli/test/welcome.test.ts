import assert from "node:assert/strict";
import test from "node:test";
import { renderWelcomeBrandPanel, printStatusLine, printNextSteps } from "../src/utils/welcome.js";

test("welcome brand panel renders only the big outlined block wordmark", () => {
  const panel = stripAnsi(renderWelcomeBrandPanel(100));
  const lines = panel.split("\n");

  assert.match(panel, /██████╗ ███████╗/);
  assert.match(panel, /██╔══██╗██╔════╝/);
  assert.doesNotMatch(panel, /DEVMAP CLI/);
  assert.doesNotMatch(panel, /STATIC ANALYSIS/);
  assert.ok(lines.every((line) => line.length <= 76));
  assert.match(lines.at(-1) ?? "", /^━+$/);
  assert.equal(lines[0]?.indexOf("█"), lines[1]?.indexOf("█"));
});

test("welcome brand panel uses a compact plain-text wordmark on narrow terminals", () => {
  const panel = stripAnsi(renderWelcomeBrandPanel(48));
  const lines = panel.split("\n");

  assert.match(panel, /DEVMAP/);
  assert.doesNotMatch(panel, /DEVMAP CLI/);
  assert.doesNotMatch(panel, /CODEBASE INTELLIGENCE/);
  assert.ok(lines.every((line) => line.length <= 48));
  assert.doesNotMatch(panel, /██████╗/);
  assert.match(lines.at(-1) ?? "", /^━+$/);
});

function captureStdout(fn: () => void): string {
  const writes: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: unknown) => { writes.push(String(chunk)); return true; };
  try { fn(); } finally { process.stdout.write = orig; }
  return stripAnsi(writes.join(""));
}

test("printStatusLine shows green diamond with snapshot message when true", () => {
  const out = captureStdout(() => printStatusLine(true));
  assert.match(out, /Project snapshot found/);
  assert.match(out, /◆/);
  assert.doesNotMatch(out, /No project analyzed/);
});

test("printStatusLine shows yellow diamond with no-snapshot message when false", () => {
  const out = captureStdout(() => printStatusLine(false));
  assert.match(out, /No project analyzed/);
  assert.match(out, /◆/);
});

test("printNextSteps lists commands with diamond and descriptions", () => {
  const out = captureStdout(() =>
    printNextSteps([
      { cmd: "devmap init", desc: "set up this project" },
      { cmd: "devmap analyze", desc: "generate the codebase map" }
    ])
  );
  assert.match(out, /devmap init/);
  assert.match(out, /devmap analyze/);
  assert.match(out, /set up this project/);
  assert.match(out, /◆/);
  assert.match(out, /generate the codebase map/);
});

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}
