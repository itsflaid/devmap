import { existsSync } from "node:fs";
import { getSnapshotPath } from "../cache/snapshot.js";
import { theme } from "./output.js";

const WIDE_WORDMARK = [
  "██████╗ ███████╗██╗   ██╗███╗   ███╗ █████╗ ██████╗",
  "██╔══██╗██╔════╝██║   ██║████╗ ████║██╔══██╗██╔══██╗",
  "██║  ██║█████╗  ██║   ██║██╔████╔██║███████║██████╔╝",
  "██║  ██║██╔══╝  ╚██╗ ██╔╝██║╚██╔╝██║██╔══██║██╔═══╝",
  "██████╔╝███████╗ ╚████╔╝ ██║ ╚═╝ ██║██║  ██║██║",
  "╚═════╝ ╚══════╝  ╚═══╝  ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝"
];

const WIDE_PANEL_WIDTH = 76;
const COMPACT_PANEL_WIDTH = 48;
const WIDE_TERMINAL_MINIMUM = 72;
const PRODUCT_LABEL = "DEVMAP CLI";
const PRODUCT_CAPABILITIES = "CODEBASE MAP  /  STATIC ANALYSIS  /  AI CONTEXT";

type Step = { cmd: string; desc: string };

export function printWelcome(projectRoot: string): void {
  const hasSnapshot = existsSync(getSnapshotPath(projectRoot));

  console.log(renderWelcomeBrandPanel(process.stdout.columns ?? 80));
  console.log("");
  printStatusLine(hasSnapshot);
  console.log("");

  if (hasSnapshot) {
    printNextSteps([
      { cmd: "devmap onboarding", desc: "see where to start reading" },
      { cmd: "devmap analyze", desc: "re-scan after changes" },
      { cmd: "devmap doctor", desc: "check project health" }
    ]);
  } else {
    printNextSteps([
      { cmd: "devmap init", desc: "set up this project" },
      { cmd: "devmap analyze", desc: "generate the codebase map" }
    ]);
  }

  console.log("");
  console.log(`  ${theme.gray}docs: devmap.dev${theme.reset}`);
  console.log("");
}

export function printStatusLine(hasSnapshot: boolean): void {
  const symbol = hasSnapshot ? `${theme.green}◆${theme.reset}` : `${theme.yellow}◆${theme.reset}`;
  const message = hasSnapshot
    ? "Project snapshot found — ready to explore."
    : "No project analyzed yet.";
  console.log(`  ${symbol} ${message}`);
}

export function printNextSteps(steps: Step[]): void {
  for (const step of steps) {
    const padded = step.cmd.padEnd(22);
    console.log(`  ${theme.aqua}◆ ${padded}${theme.reset}${theme.gray}${step.desc}${theme.reset}`);
  }
}

export function renderWelcomeBrandPanel(terminalWidth: number): string {
  const isWide = terminalWidth >= WIDE_TERMINAL_MINIMUM;
  const contentWidth = Math.max(
    24,
    Math.min(terminalWidth, isWide ? WIDE_PANEL_WIDTH : COMPACT_PANEL_WIDTH)
  );
  const wordmark = isWide ? WIDE_WORDMARK : ["DEVMAP"];
  const label = centerLine(`[ ${PRODUCT_LABEL} ]`, contentWidth);
  const wordmarkRows = centerBlock(wordmark, contentWidth);
  const capabilities = centerLine(
    isWide ? PRODUCT_CAPABILITIES : "CODEBASE INTELLIGENCE",
    contentWidth
  );
  const separator = "━".repeat(Math.min(contentWidth, 64));

  return [
    `${theme.gray}${label}${theme.reset}`,
    "",
    ...wordmarkRows.map((line) => `${theme.aqua}${line}${theme.reset}`),
    "",
    `${theme.gray}${capabilities}${theme.reset}`,
    `${theme.aqua}${separator}${theme.reset}`
  ].join("\n");
}

function centerLine(line: string, width: number): string {
  const visibleLine = line.slice(0, width);
  const leftPadding = Math.floor((width - visibleLine.length) / 2);
  return `${" ".repeat(leftPadding)}${visibleLine}`;
}

function centerBlock(lines: string[], width: number): string[] {
  const blockWidth = Math.min(width, Math.max(...lines.map((line) => line.length)));
  const leftPadding = Math.floor((width - blockWidth) / 2);
  return lines.map((line) => `${" ".repeat(leftPadding)}${line.slice(0, width)}`);
}


