import { theme } from "./output.js";

const commands = [
  ["init", "Initialize DevMap configuration"],
  ["analyze", "Analyze project structure"],
  ["ask <question>", "Ask about your codebase"],
  ["doctor", "Diagnose DevMap setup"]
] as const;

export function printHelp(): void {
  console.log(`\n${theme.aqua}devmap${theme.reset} - Understand any codebase.\n`);
  console.log(`${theme.aqua}USAGE${theme.reset}`);
  console.log(`  devmap <command> [options]\n`);
  console.log(`${theme.aqua}COMMANDS${theme.reset}`);

  for (const [command, description] of commands) {
    console.log(`  ${theme.aqua}${command.padEnd(16)}${theme.reset} ${theme.gray}${description}${theme.reset}`);
  }

  console.log(`\n${theme.aqua}OPTIONS${theme.reset}`);
  console.log(`  ${theme.aqua}-V, --version${theme.reset}   ${theme.gray}Show version number${theme.reset}`);
  console.log(`  ${theme.aqua}-h, --help${theme.reset}      ${theme.gray}Show help message${theme.reset}`);
  console.log(`\n${theme.gray}More info: ${theme.aqua}https://github.com/itsflaid/devmap${theme.reset}\n`);
}
