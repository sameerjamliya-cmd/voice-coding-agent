import { createTwoFilesPatch } from "diff";
import type { Tool } from "../agent/types.js";

// Displays a proposed change without applying it. Non-blocking on its own;
// naturally pairs with ask_user for a "here's the diff, should I apply it?"
// flow. Printing straight to stdout (rather than returning it as the tool
// result) means the user sees it immediately, not just after Claude's next
// turn.
export const showDiffToUserTool: Tool = {
  name: "show_diff_to_user",
  description:
    "Show the user a diff between old and new content for a file, without applying it. Use this to preview a change before writing it, especially paired with ask_user for confirmation.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path of the file the diff is for (for display only)" },
      old_content: { type: "string", description: "Current content of the file" },
      new_content: { type: "string", description: "Proposed new content of the file" },
    },
    required: ["path", "old_content", "new_content"],
  },
  execute: async (input: { path: string; old_content: string; new_content: string }) => {
    const patch = createTwoFilesPatch(
      input.path,
      input.path,
      input.old_content,
      input.new_content,
      "before",
      "after"
    );
    console.log(`\n${patch}`);
    return { output: `Diff for "${input.path}" displayed to user.` };
  },
};
