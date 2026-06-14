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

export function printWelcome(projectRoot: string): void {
  const hasSnapshot = existsSync(getSnapshotPath(projectRoot));
  const status = hasSnapshot ? "Project snapshot found." : "No project analyzed yet.";

  console.log(renderWelcomeBrandPanel(process.stdout.columns ?? 80));
  console.log("  Understand Any Codebase.");
  console.log(`\n  ${theme.gray}──────────────────────────────────────────${theme.reset}\n`);
  console.log(`  ${status}\n`);
  console.log("  Start with:\n");
  printCommand("devmap init");
  printCommand("devmap analyze");
  console.log("\n  Popular commands:\n");
  printCommand("devmap analyze", "scan current project");
  printCommand("devmap explain", "explain architecture");
  printCommand('devmap ask "..."', "ask your codebase");
  printCommand("devmap docs", "generate documentation");
  printCommand("devmap onboard", "generate onboarding guide");
  console.log("");
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

function printCommand(command: string, description?: string): void {
  const padded = command.padEnd(22);
  const suffix = description ? ` ${theme.gray}${description}${theme.reset}` : "";
  console.log(`    ${theme.aqua}${padded}${theme.reset}${suffix}`);
}
