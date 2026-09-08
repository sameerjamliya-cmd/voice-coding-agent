import type { Tool } from "../agent/types.js";
import { choice, prompt } from "../shared/terminal-prompt.js";

// The one tool that blocks the loop on real terminal input. Every other
// tool is fire-and-forget; this one waits on a human before the loop
// continues.
export const askUserTool: Tool = {
  name: "ask_user",
  description:
    "Ask the user a question and block until they respond, via the terminal. Use this when genuinely unsure how to proceed — ambiguous instructions, a decision only the user can make, or confirmation before something risky. Pass `options` (2-4 short choices) for a bounded decision instead of open-ended text whenever the possible answers are known in advance.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The question to ask the user" },
      options: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 4,
        description: "Optional 2-4 short choices, rendered as a numbered list. Omit for a free-text question.",
      },
    },
    required: ["question"],
  },
  execute: async (input: { question: string; options?: string[] }) => {
    try {
      if (input.options && input.options.length >= 2) {
        const answer = await choice(input.question, input.options.slice(0, 4));
        return { output: answer };
      }
      const answer = await prompt(`\n? ${input.question}\n> `);
      return { output: answer };
    } catch (err: any) {
      return { error: `Failed to read user input: ${err.message}` };
    }
  },
};
