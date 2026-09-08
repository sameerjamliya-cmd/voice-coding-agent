import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Tool } from "../agent/types.js";

// The one tool that blocks the loop on real terminal input. Every other
// tool is fire-and-forget; this one waits on a human before the loop
// continues.
export const askUserTool: Tool = {
  name: "ask_user",
  description:
    "Ask the user a question and block until they respond, via the terminal. Use this when genuinely unsure how to proceed — ambiguous instructions, a decision only the user can make, or confirmation before something risky.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The question to ask the user" },
    },
    required: ["question"],
  },
  execute: async (input: { question: string }) => {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = await rl.question(`\n? ${input.question}\n> `);
      return { output: answer };
    } catch (err: any) {
      return { error: `Failed to read user input: ${err.message}` };
    } finally {
      rl.close();
    }
  },
};
