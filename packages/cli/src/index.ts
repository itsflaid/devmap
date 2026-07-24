#!/usr/bin/env node
import { Command } from "commander";
import { analyzeCommand } from "./commands/analyze.js";
import { configModelCommand } from "./commands/config.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { mapCommand } from "./commands/map.js";
import { onboardingCommand } from "./commands/onboarding.js";
import { printHelp } from "./utils/help.js";
import { printWelcome } from "./utils/welcome.js";
import { runSafely } from "./utils/errors.js";
import { DEVMAP_VERSION } from "./utils/packageMetadata.js";

const program = new Command();

program
  .name("devmap")
  .description("Understand any codebase in minutes, not days.")
  .version(DEVMAP_VERSION);

program
  .command("init")
  .description("Initialize DevMap configuration")
  .option("--json", "output machine-readable JSON")
  .action((options) => initCommand({ json: options.json }));

program
  .command("analyze")
  .description("Analyze project structure and generate a static project map")
  .argument("[target]", "folder to analyze", ".")
  .option("--fresh", "ignore cache and run a fresh analysis")
  .option("--json", "output machine-readable JSON")
  .action((target, options) => analyzeCommand(target, options));

program
  .command("onboarding")
  .alias("onboard")
  .description("Generate a project onboarding guide from the DevMap snapshot")
  .argument("[target]", "folder with a DevMap snapshot", ".")
  .option("--write", "write ONBOARDING.md")
  .option("--language <language>", "language for generated onboarding markdown (en or id)")
  .option("--json", "output machine-readable JSON")
  .action((target, options) => onboardingCommand({
    target,
    language: options.language,
    write: options.write,
    json: options.json
  }));

program
  .command("map")
  .description("Map dependencies: full project, one feature, or one file")
  .argument("[target]", "feature name or file path — omit for a full project map")
  .option("--json", "output machine-readable JSON")
  .action((target, options) => mapCommand(target, { json: options.json }));

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
