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

function color(value: string | number, tone: keyof typeof theme): string {
  return `${theme[tone]}${value}${theme.reset}`;
}

export const output = {
  section(title: string): void {
    console.log(`\n${color(title, "aqua")}`);
    console.log(color(LINE, "gray"));
  },

  step(message: string): void {
    console.log(`${color(">", "aqua")} ${message}`);
  },

  success(message: string): void {
    console.log(`${color("OK", "green")} ${message}`);
  },

  warning(message: string): void {
    console.log(`${color("WARN", "yellow")} ${message}`);
  },

  error(message: string): void {
    console.error(`${color("ERROR", "red")} ${message}`);
  },

  keyValue(key: string, value: string | number): void {
    console.log(`${color(key.padEnd(18), "gray")} ${color(value, "aqua")}`);
  },

  item(value: string): void {
    console.log(`${color("•", "aqua")} ${value}`);
  },

  note(message: string): void {
    console.log(color(message, "gray"));
  },

  codeBlock(content: string): void {
    console.log(color(content, "gray"));
  },

  markdown(content: string): void {
    console.log(renderTerminalMarkdown(content, {
      width: process.stdout.columns ?? 80,
      colors: true
    }));
  }
};
