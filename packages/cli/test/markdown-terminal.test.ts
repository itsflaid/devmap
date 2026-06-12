import assert from "node:assert/strict";
import test from "node:test";
import { renderTerminalMarkdown } from "../src/utils/markdownTerminal.js";

test("terminal markdown renders headings, inline formatting, and lists cleanly", () => {
  const rendered = renderTerminalMarkdown([
    "## Main Flow",
    "",
    "This project uses **NextAuth** from `lib/auth.ts` with `users_email_key`.",
    "",
    "1. **Login**",
    "   - Validate the session token.",
    "   - Redirect unauthenticated users."
  ].join("\n"), { width: 60, colors: false });

  assert.match(rendered, /Main Flow\n-+/);
  assert.match(rendered, /users_email_key/);
  assert.match(rendered, /1\. Login/);
  assert.match(rendered, /   - Validate the session token\./);
  assert.doesNotMatch(rendered, /\*\*|`/);
});

test("terminal markdown converts tables into readable vertical records", () => {
  const rendered = renderTerminalMarkdown([
    "| Table | Main columns | Relation |",
    "| --- | --- | --- |",
    "| users | id, name, email | Primary key id |",
    "| rooms | id, userId | userId -> users.id |"
  ].join("\n"), { width: 50, colors: false });

  assert.match(rendered, /users/);
  assert.match(rendered, /Main columns\s+id, name, email/);
  assert.match(rendered, /Relation\s+Primary key id/);
  assert.match(rendered, /rooms/);
  assert.doesNotMatch(rendered, /\|/);
});

test("terminal markdown wraps prose and preserves fenced code", () => {
  const rendered = renderTerminalMarkdown([
    "A deliberately long explanation that must wrap before it reaches the edge of a narrow terminal.",
    "",
    "```ts",
    "const project = createProjectMap(root);",
    "```"
  ].join("\n"), { width: 36, colors: false });

  const proseLines = rendered.split("\n").filter((line) => !line.startsWith("  "));
  assert.ok(proseLines.every((line) => line.length <= 36));
  assert.match(rendered, /  const project = createProjectMap\(root\);/);
  assert.doesNotMatch(rendered, /```/);
});
