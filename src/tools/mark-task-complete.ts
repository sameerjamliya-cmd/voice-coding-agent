import type { Tool } from "../agent/types.js";

// Special-cased by loop.ts, not routed through harness.execute like other
// tools: calling this is what triggers checkpoint validation (the full
// test suite), never a plain-text response ending on its own. This
// execute() is a defensive fallback in case something ever calls it
// directly outside that interception — the real behavior lives in
// agent/loop.ts and harness/harness.ts.
export const markTaskCompleteTool: Tool = {
  name: "mark_task_complete",
  description:
    "Call this when you believe the task is fully complete. You must restate the original task and explain how your changes address it. This triggers full validation (the project's test suite).",
  inputSchema: {
    type: "object",
    properties: {
      original_task: {
        type: "string",
        description: "Restate the task as originally given.",
      },
      summary: {
        type: "string",
        description: "Explain what was changed and how it satisfies the original task.",
      },
    },
    required: ["original_task", "summary"],
  },
  execute: async (input: { original_task: string; summary: string }) => {
    return { output: input.summary };
  },
};
