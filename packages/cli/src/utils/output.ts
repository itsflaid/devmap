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

export type Spinner = {
  succeed(message?: string): void;
  fail(message?: string): void;
  stop(): void;
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

function createSpinner(label: string): Spinner {
  if (process.stdout.isTTY !== true) {
    // No live terminal to animate against (piped output, CI, etc.) — announce once
    // and report completion as a second line instead of framing in place.
    console.log(`${color("◆", "aqua")} ${label}`);
    return {
      succeed(message?: string): void {
        console.log(`${color("◆", "green")} ${message ?? label}`);
      },
      fail(message?: string): void {
        console.log(`${color("◆", "red")} ${message ?? label}`);
      },
      stop(): void {}
    };
  }

  let frame = 0;
  const render = (): void => {
    const glyph = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    process.stdout.write(`\r\x1b[K${color(glyph, "aqua")} ${label}`);
    frame += 1;
  };
  render();
  const timer = setInterval(render, SPINNER_INTERVAL_MS);
  timer.unref(); // never let a stray spinner keep the process alive

  const finish = (symbol: string, tone: "green" | "red", message?: string): void => {
    clearInterval(timer);
    process.stdout.write(`\r\x1b[K${color(symbol, tone)} ${message ?? label}\n`);
  };

  return {
    succeed(message?: string): void {
      finish("◆", "green", message);
    },
    fail(message?: string): void {
      finish("◆", "red", message);
    },
    stop(): void {
      clearInterval(timer);
      process.stdout.write("\r\x1b[K");
    }
  };
}

export type MarkdownStream = {
  write(chunk: string): void;
  end(): void;
};

export const output = {
  section(title: string): void {
    if (isJsonOutput()) return;
    console.log(`\n${color(title, "aqua")}`);
    console.log(color(LINE, "gray"));
  },

  step(message: string): void {
    if (isJsonOutput()) return;
    console.log(`${color("◆", "aqua")} ${message}`);
  },

  spinner(label: string): Spinner {
    if (isJsonOutput()) {
      return { succeed(): void {}, fail(): void {}, stop(): void {} };
    }
    return createSpinner(label);
  },

  success(message: string): void {
    if (isJsonOutput()) return;
    console.log(`${color("◆", "green")} ${message}`);
  },

  warning(message: string): void {
    if (isJsonOutput()) return;
    console.log(`${color("◆", "yellow")} ${message}`);
  },

  error(message: string): void {
    if (isJsonOutput()) return;
    console.error(`${color("◆", "red")} ${message}`);
  },

  keyValue(key: string, value: string | number): void {
    if (isJsonOutput()) return;
    console.log(`${color(key.padEnd(18), "gray")} ${color(value, "aqua")}`);
  },

  item(value: string): void {
    if (isJsonOutput()) return;
    console.log(`${color("◆", "aqua")} ${value}`);
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

  markdownStream(): MarkdownStream {
    let buffer = "";

    const renderParagraph = (paragraph: string): void => {
      if (isJsonOutput() || paragraph.trim() === "") return;
      console.log(renderTerminalMarkdown(paragraph, {
        width: process.stdout.columns ?? 80,
        colors: true
      }));
    };

    return {
      write(chunk: string): void {
        buffer += chunk.replace(/\r\n?/g, "\n");

        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          renderParagraph(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      },
      end(): void {
        renderParagraph(buffer);
        buffer = "";
      }
    };
  },

  json(value: unknown): void {
    console.log(JSON.stringify(value));
  }
};
