/**
 * The nine commands shown in the command explorer.
 *
 * `out` lines use a one-character prefix for styling:
 *   "§ " section heading   "· " dim / secondary   "+ " highlighted
 *   anything else is plain text; "" is a blank line.
 *
 * Source of the output (`source`):
 *   "real"         captured by running the built CLI (v0.8.3) on this repository
 *                  with no API key, then trimmed. The scratch path is shown as ~/devmap.
 *   "illustrative" the command needs an interactive prompt or an AI provider, so the
 *                  lines are written from the messages in packages/cli/src/commands.
 *
 * To refresh the real ones: build packages/cli, copy the repo somewhere outside git, run
 * `node packages/cli/dist/index.js <command>` there, and trim the output. Do not edit lines by hand.
 */
export type CommandGroup = "Set up" | "Map" | "Read" | "Serve";

export interface CommandEntry {
  id: string;
  /** What the user types, without the leading "$ ". */
  cmd: string;
  /** Name shown in the list. */
  name: string;
  group: CommandGroup;
  summary: string;
  needsAi?: boolean;
  source: "real" | "illustrative";
  out: string[];
}

export const COMMANDS: CommandEntry[] = [
  {
    id: "init",
    cmd: "devmap init",
    name: "devmap init",
    group: "Set up",
    summary: "Set up DevMap for this project and pick an AI provider if you want one.",
    source: "illustrative",
    out: [
      "◆ Validating Groq API key",
      "◆ Groq API key is valid",
      "◆ Config saved to ~/.devmap/config.json",
      "◆ Added .devmap/ to .gitignore",
      "◆ Created DEVMAP.md",
      "◆ Created AGENTS.md",
      "+ ◆ Next: devmap analyze"
    ]
  },
  {
    id: "config-model",
    cmd: "devmap config model llama-3.3-70b-versatile",
    name: "devmap config model",
    group: "Set up",
    summary: "Pick the model the AI-powered commands use.",
    needsAi: true,
    source: "illustrative",
    out: [
      "◆ Default model override set to llama-3.3-70b-versatile."
    ]
  },
  {
    id: "doctor",
    cmd: "devmap doctor",
    name: "devmap doctor",
    group: "Set up",
    summary: "Check your setup and print a report you can paste into a bug report.",
    source: "real",
    out: [
      "§ DevMap Doctor",
      "DevMap             0.8.3",
      "Node.js            v22.23.4 (supported)",
      "OS                 linux/x64",
      "Project            devmap-workspace",
      "Framework          astro",
      "Package Manager    pnpm",
      "Provider           not configured",
      "Config             missing",
      "Snapshot           valid",
      "API key            not configured",
      "",
      "§ Issues",
      "◆ Run devmap init to create ~/.devmap/config.json."
    ]
  },
  {
    id: "analyze",
    cmd: "devmap analyze",
    name: "devmap analyze",
    group: "Map",
    summary: "Scan the project and write the .devmap folder. Static analysis, no AI required.",
    source: "real",
    out: [
      "§ DevMap Analyze",
      "◆ Scanning ~/devmap",
      "◆ Scanned 377 files",
      "◆ Mapping dependencies",
      "◆ Detected 7 features",
      "◆ Project index built",
      "Project            devmap-workspace",
      "Framework          astro",
      "Language           typescript",
      "Package Manager    pnpm",
      "Files              377",
      "Lines              55284",
      "",
      "§ Entry Points",
      "◆ packages/cli/src/index.ts",
      "◆ apps/web/src/pages/docs.astro",
      "· … 3 more",
      "",
      "+ ◆ Snapshot saved to .devmap/snapshot.json",
      "+ ◆ Agent navigation saved to .devmap/index.json and .devmap/features/"
    ]
  },
  {
    id: "map",
    cmd: "devmap map",
    name: "devmap map",
    group: "Map",
    summary: "Show the dependency tree from the saved analysis, without scanning again.",
    source: "real",
    out: [
      "§ DevMap — map: project",
      "",
      "§ Features",
      "  - AI Integration (5 files)",
      "  - Caching (5 files)",
      "  - CLI Commands (9 files)",
      "  - Doc (5 files)",
      "  - Documentation (11 files)",
      "  - Home (16 files)",
      "  - Testing (1 file)",
      "",
      "§ Feature relationships",
      "  - Caching → AI Integration",
      "  - CLI Commands → AI Integration",
      "  - CLI Commands → Caching",
      "  - Doc → Home",
      "  - Documentation → Doc",
      "",
      "· 48 of 377 files belong to a detected feature.",
      "+ ◆ Wrote .devmap/maps/project.mermaid"
    ]
  },
  {
    id: "flow",
    cmd: "devmap flow",
    name: "devmap flow",
    group: "Map",
    summary: "Walk a feature or request step by step, as a Mermaid diagram or in the terminal.",
    source: "real",
    out: [
      "· AI flow narration is not configured. Run devmap init to enable it.",
      "",
      "§ Flows written",
      "◆ AI Integration flow",
      "◆ Caching flow",
      "◆ CLI Commands flow",
      "◆ Request /robots.txt",
      "◆ Request /sitemap.xml",
      "",
      "+ ◆ Wrote .devmap/flows/cli-commands-flow.md",
      "+ ◆ Wrote .devmap/flows/cli-commands-flow.mermaid"
    ]
  },
  {
    id: "onboarding",
    cmd: "devmap onboarding",
    name: "devmap onboarding",
    group: "Read",
    summary: "A reading order for someone new to the codebase: where to start, what to read next.",
    source: "real",
    out: [
      "§ DevMap Onboarding",
      "devmap-workspace",
      "Typescript · Astro · Groq · OpenRouter",
      "",
      "§ What this is",
      "devmap-workspace handles ai integration, caching, cli commands. Integrates with Groq, OpenRouter.",
      "",
      "§ Start here",
      "1",
      "  File           examples/todo-app/prisma/schema.prisma",
      "  Why read this  Understand the data model and entity relationships",
      "2",
      "  File           packages/cli/src/index.ts",
      "  Why read this  Execution entry point — see available commands or routes",
      "3",
      "  File           apps/web/src/pages/docs.astro",
      "  Why read this  Execution entry point — see available commands or routes"
    ]
  },
  {
    id: "explain",
    cmd: "devmap explain packages/cli/src/index.ts",
    name: "devmap explain",
    group: "Read",
    summary: "Ask about a file or feature and get an answer grounded in the analysis.",
    needsAi: true,
    source: "illustrative",
    out: [
      "· Context files: packages/cli/src/index.ts",
      "",
      "§ Answer",
      "The CLI entry point. It builds the commander program and hands",
      "init, analyze, onboarding, map, flow, explain, config, doctor and mcp",
      "to their command handlers."
    ]
  },
  {
    id: "mcp",
    cmd: "devmap mcp",
    name: "devmap mcp",
    group: "Serve",
    summary: "Run DevMap as an MCP server. Your agent starts it and calls tools; you rarely run it by hand.",
    source: "illustrative",
    out: [
      "· DevMap MCP server ready (root: ~/your-project)"
    ]
  }
];

export const COMMAND_GROUPS: CommandGroup[] = ["Set up", "Map", "Read", "Serve"];

/** Which command is open when the page loads. */
export const DEFAULT_COMMAND = "analyze";
