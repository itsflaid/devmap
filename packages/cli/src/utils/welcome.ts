import { existsSync } from "node:fs";
import { getSnapshotPath } from "../cache/snapshot.js";
import { theme } from "./output.js";

const SYMBOL_LOGO = [
  "           ╷        ╱╲",
  "    ╭──────┼──────╱  ╲",
  "  ╭─╯      ●─────╯   ╱",
  " ╱        ╱│        ╱",
  "│       ╱  │  ╭────╯",
  "│     ╱    │╱╱",
  " ╲__╱     ╱│",
  "    ╲____╱ │",
  "           ╵"
];

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
  const panelWidth = Math.max(
    28,
    Math.min(
      terminalWidth,
      isWide ? WIDE_PANEL_WIDTH : COMPACT_PANEL_WIDTH
    )
  );
  const contentWidth = panelWidth - 4;
  const wordmark = isWide ? WIDE_WORDMARK : ["DEVMAP"];
  const content = [
    ...SYMBOL_LOGO,
    "",
    ...wordmark
  ];
  const top = `╭${"─".repeat(panelWidth - 2)}╮`;
  const bottom = `╰${"─".repeat(panelWidth - 2)}╯`;
  const rows = content.map((line) => {
    const visibleLine = line.slice(0, contentWidth);
    const leftPadding = Math.floor((contentWidth - visibleLine.length) / 2);
    const rightPadding = contentWidth - visibleLine.length - leftPadding;
    return `│ ${" ".repeat(leftPadding)}${visibleLine}${" ".repeat(rightPadding)} │`;
  });

  return [top, ...rows, bottom]
    .map((line) => `${theme.aqua}${line}${theme.reset}`)
    .join("\n");
}

function printCommand(command: string, description?: string): void {
  const padded = command.padEnd(22);
  const suffix = description ? ` ${theme.gray}${description}${theme.reset}` : "";
  console.log(`    ${theme.aqua}${padded}${theme.reset}${suffix}`);
}
