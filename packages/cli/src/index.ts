#!/usr/bin/env node
import { Command } from "commander";
import { analyzeCommand } from "./commands/analyze.js";
import { askCommand } from "./commands/ask.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";

const program = new Command();

program
  .name("devmap")
  .description("Understand any codebase in minutes, not days.")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize DevMap configuration")
  .action(initCommand);

program
  .command("analyze")
  .description("Analyze project structure and generate a static project map")
  .argument("[target]", "folder to analyze", ".")
  .option("--deep", "show a deeper static breakdown")
  .option("--fresh", "ignore cache and run a fresh analysis")
  .action(analyzeCommand);

program
  .command("ask")
  .description("Find files relevant to a codebase question")
  .argument("<question...>", "question to ask")
  .action(askCommand);

program
  .command("doctor")
  .description("Diagnose DevMap setup")
  .action(doctorCommand);

await program.parseAsync(process.argv);
