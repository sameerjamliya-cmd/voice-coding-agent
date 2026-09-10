import type { Tool } from "../agent/types.js";
import type { Skill } from "../skills/types.js";

// Closes over an already-loaded skill list (loaded once at CLI startup)
// rather than re-reading the skills directory from disk on every call.
export function createLoadSkillTool(skills: Skill[]): Tool {
  return {
    name: "load_skill",
    description:
      "Load the full instructions for a named skill from the skill index in your system prompt. Call this before starting work that matches one of the listed skills.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The exact skill name from the index" },
      },
      required: ["name"],
    },
    execute: async (input: { name: string }) => {
      const skill = skills.find((s) => s.name === input.name);
      if (!skill) {
        return {
          error: `No skill named "${input.name}" found. Available: ${skills.map((s) => s.name).join(", ")}`,
        };
      }
      return { output: skill.body };
    },
  };
}
