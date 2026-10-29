import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type PromptMessages = {
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
};

function userPrompt(text: string): PromptMessages {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

/**
 * Reusable workflows that tell the agent *which DevMap tools to call, in what
 * order*. They contain no project data; the tools provide that.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "devmap_onboard",
    {
      title: "Onboard me to this codebase",
      description: "Walk through the project using DevMap and produce a short onboarding guide.",
      argsSchema: {
        focus: z.string().optional().describe("Optional area to emphasize, e.g. \"payments\" or \"frontend\".")
      }
    },
    ({ focus }) => userPrompt([
      "Help me understand this codebase using the DevMap tools instead of reading files blindly.",
      "",
      "1. Call devmap_overview to learn the framework, entry points, critical files, features and flows.",
      "2. Call devmap_flow with no target to see the top flows, then trace the two or three most important ones.",
      "3. For the most important feature, call devmap_map with its name to see its files and dependencies.",
      "4. Only then open specific files, starting with the critical files and entry points.",
      focus ? `5. Pay special attention to: ${focus}. Use devmap_find to locate it.` : "",
      "",
      "If any result reports snapshot.stale = true, call devmap_analyze first.",
      "Finish with: what the project does, how it is structured, where to start reading, and what to be careful about."
    ].filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n"))
  );

  server.registerPrompt(
    "devmap_plan_change",
    {
      title: "Plan a change safely",
      description: "Plan a code change using DevMap to find the right files and check their blast radius before editing.",
      argsSchema: {
        change: z.string().min(3).describe("What you want to change, e.g. \"add rate limiting to the login API\".")
      }
    },
    ({ change }) => userPrompt([
      `I want to make this change: ${change}`,
      "",
      "Plan it with DevMap before editing anything:",
      "1. Call devmap_find with the key terms of the change to locate the relevant features, files and routes.",
      "2. Call devmap_map on the most relevant feature (or file) to see how it is wired.",
      "3. If it touches a request or user journey, call devmap_flow to trace it end to end.",
      "4. For every file you expect to modify, call devmap_impact with depth 2 and note the dependents, affected features and critical dependents.",
      "5. If a result reports snapshot.stale = true, call devmap_analyze and repeat the affected steps.",
      "",
      "Then give me a plan: the files to change and why, what else could break (from devmap_impact), the tests to run or add, and any risks. Do not edit code until I approve the plan."
    ].join("\n"))
  );
}
