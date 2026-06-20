import {
  clearLine,
  createInterface as createCallbackInterface,
  cursorTo,
  emitKeypressEvents,
  moveCursor
} from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export type PromptOption<T extends string> = {
  label: string;
  value: T;
};

export type Prompt = {
  ask(question: string): Promise<string>;
  select<T extends string>(
    question: string,
    options: Array<PromptOption<T>>,
    initialValue?: T
  ): Promise<T>;
  close(): void;
};

export function createPrompt(): Prompt {
  let closed = false;

  return {
    async ask(question: string): Promise<string> {
      if (closed) return "";
      const readline = createInterface({ input: stdin, output: stdout });
      try {
        return await readline.question(question);
      } finally {
        readline.close();
      }
    },
    select<T extends string>(
      question: string,
      options: Array<PromptOption<T>>,
      initialValue?: T
    ): Promise<T> {
      if (options.length === 0) {
        throw new Error("Prompt options cannot be empty.");
      }

      const initialIndex = Math.max(
        0,
        options.findIndex((option) => option.value === initialValue)
      );
      return selectWithArrowKeys(question, options, initialIndex);
    },
    close(): void {
      closed = true;
    }
  };
}

function selectWithArrowKeys<T extends string>(
  question: string,
  options: Array<PromptOption<T>>,
  initialIndex: number
): Promise<T> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return Promise.resolve(options[initialIndex]!.value);
  }

  return new Promise((resolve) => {
    let selectedIndex = initialIndex;
    const render = (replace = false): void => {
      if (replace) {
        moveCursor(stdout, 0, -options.length);
      }
      for (const [index, option] of options.entries()) {
        cursorTo(stdout, 0);
        clearLine(stdout, 0);
        stdout.write(`${index === selectedIndex ? ">" : " "} ${option.label}\n`);
      }
    };

    const readline = createCallbackInterface({ input: stdin, output: stdout });
    emitKeypressEvents(stdin, readline);
    stdout.write(`${question}\n`);
    render();
    stdin.setRawMode(true);
    stdin.resume();

    const finish = (): void => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(false);
      stdin.pause();
      readline.close();
      resolve(options[selectedIndex]!.value);
    };

    const onKeypress = (
      _value: string,
      key: { name?: string; ctrl?: boolean }
    ): void => {
      if (key.name === "up") {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render(true);
        return;
      }
      if (key.name === "down") {
        selectedIndex = (selectedIndex + 1) % options.length;
        render(true);
        return;
      }
      if (key.name === "return") {
        finish();
        return;
      }
      if (key.ctrl && key.name === "c") {
        finish();
      }
    };

    stdin.on("keypress", onKeypress);
  });
}
