import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export type Prompt = {
  ask(question: string): Promise<string>;
  close(): void;
};

export function createPrompt(): Prompt {
  const readline = createInterface({
    input: stdin,
    output: stdout
  });

  return {
    ask(question: string): Promise<string> {
      return readline.question(question);
    },
    close(): void {
      readline.close();
    }
  };
}
