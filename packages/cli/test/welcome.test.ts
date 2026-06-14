import assert from "node:assert/strict";
import test from "node:test";
import { renderWelcomeBrandPanel } from "../src/utils/welcome.js";

test("welcome brand panel frames the logo and wordmark on wide terminals", () => {
  const panel = stripAnsi(renderWelcomeBrandPanel(100));
  const lines = panel.split("\n");

  assert.match(panel, /██████╗ ███████╗/);
  assert.match(panel, /╱╲/);
  assert.ok(lines.every((line) => line.length === lines[0]?.length));
  assert.ok((lines[0]?.length ?? 0) <= 76);
  assert.match(lines[0] ?? "", /^╭─+╮$/);
  assert.match(lines.at(-1) ?? "", /^╰─+╯$/);
});

test("welcome brand panel uses a compact wordmark on narrow terminals", () => {
  const panel = stripAnsi(renderWelcomeBrandPanel(48));
  const lines = panel.split("\n");

  assert.match(panel, /DEVMAP/);
  assert.ok(lines.every((line) => line.length === lines[0]?.length));
  assert.ok((lines[0]?.length ?? 0) <= 48);
  assert.doesNotMatch(panel, /██████/);
});

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}
