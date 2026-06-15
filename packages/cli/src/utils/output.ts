import { AsyncLocalStorage } from "node:async_hooks";
import { renderTerminalMarkdown } from "./markdownTerminal.js";

export const theme = {
  aqua: "\x1b[38;2;46;230;214m",
  gray: "\x1b[90m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m"
};

const LINE = "─".repeat(56);
const outputMode = new AsyncLocalStorage<"human" | "json">();

export function withJsonOutput<T>(action: () => Promise<T>): Promise<T> {
  return outputMode.run("json", action);
}

function isJsonOutput(): boolean {
  return outputMode.getStore() === "json";
}

function color(value: string | number, tone: keyof typeof theme): string {
  return `${theme[tone]}${value}${theme.reset}`;
}

export const output = {
  section(title: string): void {
    if (isJsonOutput()) return;
    console.log(`\n${color(title, "aqua")}`);
    console.log(color(LINE, "gray"));
  },

  step(message: string): void {
    if (isJsonOutput()) return;
    console.log(`${color(">", "aqua")} ${message}`);
  },

  success(message: string): void {
    if (isJsonOutput()) return;
    console.log(`${color("OK", "green")} ${message}`);
  },

  warning(message: string): void {
    if (isJsonOutput()) return;
    console.log(`${color("WARN", "yellow")} ${message}`);
  },

  error(message: string): void {
    if (isJsonOutput()) return;
    console.error(`${color("ERROR", "red")} ${message}`);
  },

  keyValue(key: string, value: string | number): void {
    if (isJsonOutput()) return;
    console.log(`${color(key.padEnd(18), "gray")} ${color(value, "aqua")}`);
  },

  item(value: string): void {
    if (isJsonOutput()) return;
    console.log(`${color("•", "aqua")} ${value}`);
  },

  note(message: string): void {
    if (isJsonOutput()) return;
    console.log(color(message, "gray"));
  },

  codeBlock(content: string): void {
    if (isJsonOutput()) return;
    console.log(color(content, "gray"));
  },

  markdown(content: string): void {
    if (isJsonOutput()) return;
    console.log(renderTerminalMarkdown(content, {
      width: process.stdout.columns ?? 80,
      colors: true
    }));
  },

  json(value: unknown): void {
    console.log(JSON.stringify(value));
  }
};
