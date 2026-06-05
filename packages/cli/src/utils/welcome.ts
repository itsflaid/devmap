import { existsSync } from "node:fs";
import { getSnapshotPath } from "../cache/snapshot.js";
import { theme } from "./output.js";

const LOGO = String.raw`
  ██████╗ ███████╗██╗   ██╗███╗   ███╗ █████╗ ██████╗ 
  ██╔══██╗██╔════╝██║   ██║████╗ ████║██╔══██╗██╔══██╗
  ██║  ██║█████╗  ██║   ██║██╔████╔██║███████║██████╔╝
  ██║  ██║██╔══╝  ╚██╗ ██╔╝██║╚██╔╝██║██╔══██║██╔═══╝ 
  ██████╔╝███████╗ ╚████╔╝ ██║ ╚═╝ ██║██║  ██║██║     
  ╚═════╝ ╚══════╝  ╚═══╝  ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝     
`;

export function printWelcome(projectRoot: string): void {
  const hasSnapshot = existsSync(getSnapshotPath(projectRoot));
  const status = hasSnapshot ? "Project snapshot found." : "No project analyzed yet.";

  console.log(`${theme.aqua}${LOGO}${theme.reset}`);
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

function printCommand(command: string, description?: string): void {
  const padded = command.padEnd(22);
  const suffix = description ? ` ${theme.gray}${description}${theme.reset}` : "";
  console.log(`    ${theme.aqua}${padded}${theme.reset}${suffix}`);
}
