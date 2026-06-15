#!/usr/bin/env node
import { Command } from "commander";
import { analyzeCommand } from "./commands/analyze.js";
import { askCommand } from "./commands/ask.js";
import { configModelCommand } from "./commands/config.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { printHelp } from "./utils/help.js";
import { printWelcome } from "./utils/welcome.js";
import { runSafely } from "./utils/errors.js";

const program = new Command();

program
  .name("devmap")
  .description("Understand any codebase in minutes, not days.")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize DevMap configuration")
  .option("--json", "output machine-readable JSON")
  .action((options) => initCommand({ json: options.json }));

program
  .command("analyze")
  .description("Analyze project structure and generate a static project map")
  .argument("[target]", "folder to analyze", ".")
  .option("--deep", "show a deeper static breakdown")
  .option("--fresh", "ignore cache and run a fresh analysis")
  .option("--json", "output machine-readable JSON")
  .action((target, options) => analyzeCommand(target, options));

program
  .command("ask")
  .description("Find files relevant to a codebase question")
  .argument("<question...>", "question to ask")
  .option("--json", "output machine-readable JSON")
  .action((question, options) => askCommand(question, { json: options.json }));

const configCommand = program
  .command("config")
  .description("Update DevMap configuration");

configCommand
  .command("model")
  .description("Set a model override or restore automatic routing")
  .argument("<model>", "Groq model ID or auto")
  .option("--json", "output machine-readable JSON")
  .action((model, options) => configModelCommand(model, { json: options.json }));

program
  .command("doctor")
  .description("Diagnose DevMap setup")
  .option("--json", "output machine-readable JSON")
  .action((options) => doctorCommand({ json: options.json }));

await runSafely(async () => {
  if (process.argv.length === 2) {
    printWelcome(process.cwd());
    return;
  }

  if (process.argv.length === 3 && ["--help", "-h", "help"].includes(process.argv[2])) {
    printHelp();
    return;
  }

  await program.parseAsync(process.argv);
});
