import type { Skill } from "./types.js";

// Always-on skills' full instructions are injected directly; everything
// else appears only as a name + description in an index, loaded on demand
// via the load_skill tool. Keeps the base prompt from growing unbounded
// as more skills are added, while still surfacing what's available.
export function composeSystemPrompt(basePrompt: string, skills: Skill[]): string {
  const alwaysOn = skills.filter((s) => s.alwaysOn);
  const onDemand = skills.filter((s) => !s.alwaysOn);

  const sections = [basePrompt];

  for (const skill of alwaysOn) {
    sections.push(`--- Skill: ${skill.name} (always active) ---\n${skill.body}`);
  }

  if (onDemand.length > 0) {
    const index = onDemand.map((s) => `- ${s.name}: ${s.description}`).join("\n");
    sections.push(
      `The following skills are available via the load_skill tool — call it with the skill's name ` +
        `whenever a task matches one, before starting that kind of work:\n${index}`
    );
  }

  return sections.join("\n\n");
}
