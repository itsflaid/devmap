import assert from "node:assert/strict";
import test from "node:test";
import { renderWelcomeBrandPanel } from "../src/utils/welcome.js";

test("welcome brand panel renders an outlined block wordmark and tool identity", () => {
  const panel = stripAnsi(renderWelcomeBrandPanel(100));
  const lines = panel.split("\n");

  assert.match(panel, /\[ DEVMAP CLI \]/);
  assert.match(panel, /██████╗ ███████╗/);
  assert.match(panel, /██╔══██╗██╔════╝/);
  assert.match(panel, /CODEBASE MAP  \/  STATIC ANALYSIS  \/  AI CONTEXT/);
  assert.ok(lines.every((line) => line.length <= 76));
  assert.match(lines.at(-1) ?? "", /^━+$/);
  assert.equal(lines[2]?.indexOf("█"), lines[3]?.indexOf("█"));
});

test("welcome brand panel uses a compact tool identity on narrow terminals", () => {
  const panel = stripAnsi(renderWelcomeBrandPanel(48));
  const lines = panel.split("\n");

  assert.match(panel, /\[ DEVMAP CLI \]/);
  assert.match(panel, /DEVMAP/);
  assert.match(panel, /CODEBASE INTELLIGENCE/);
  assert.ok(lines.every((line) => line.length <= 48));
  assert.doesNotMatch(panel, /██████╗/);
  assert.match(lines.at(-1) ?? "", /^━+$/);
});

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}
