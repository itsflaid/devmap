import type { Command } from "commander";
import { theme } from "./output.js";

export function printHelp(program: Command): void {
  console.log(`\n${theme.aqua}devmap${theme.reset} - Understand any codebase.\n`);
  console.log(`${theme.aqua}USAGE${theme.reset}`);
  console.log(`  devmap <command> [options]\n`);
  console.log(`${theme.aqua}COMMANDS${theme.reset}`);

  for (const cmd of program.commands) {
    const args = cmd.registeredArguments
      .map((argument) => (argument.required ? `<${argument.name()}>` : `[${argument.name()}]`))
      .join(" ");
    const usage = args ? `${cmd.name()} ${args}` : cmd.name();
    console.log(`  ${theme.aqua}${usage.padEnd(16)}${theme.reset} ${theme.gray}${cmd.description()}${theme.reset}`);
  }

  console.log(`\n${theme.aqua}OPTIONS${theme.reset}`);
  console.log(`  ${theme.aqua}-V, --version${theme.reset}   ${theme.gray}Show version number${theme.reset}`);
  console.log(`  ${theme.aqua}-h, --help${theme.reset}      ${theme.gray}Show help message${theme.reset}`);
  console.log(`\n${theme.gray}More info: ${theme.aqua}https://github.com/itsflaid/devmap${theme.reset}\n`);
}