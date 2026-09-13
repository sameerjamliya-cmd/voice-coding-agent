import { describe, it, expect } from "vitest";
import { loadSkills } from "../src/skills/registry.js";
import { composeSystemPrompt } from "../src/skills/compose-system-prompt.js";

describe("loadSkills", () => {
  it("loads every skill file with required frontmatter fields", async () => {
    const skills = await loadSkills();
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(typeof skill.alwaysOn).toBe("boolean");
      expect(skill.body.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate skill names", async () => {
    const skills = await loadSkills();
    const names = skills.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("returns an empty list for a directory with no skill files", async () => {
    const skills = await loadSkills("/tmp/definitely-does-not-exist-skills-dir");
    expect(skills).toEqual([]);
  });
});

describe("composeSystemPrompt", () => {
  it("injects always-on skills' full body and lists the rest as name+description only", async () => {
    const skills = await loadSkills();
    const prompt = composeSystemPrompt("BASE", skills);

    expect(prompt.startsWith("BASE")).toBe(true);

    const alwaysOn = skills.filter((s) => s.alwaysOn);
    const onDemand = skills.filter((s) => !s.alwaysOn);

    for (const skill of alwaysOn) {
      expect(prompt).toContain(skill.body);
    }
    for (const skill of onDemand) {
      expect(prompt).toContain(`${skill.name}: ${skill.description}`);
      // Body content of on-demand skills should not be inlined.
      const bodyFirstLine = skill.body.split("\n")[0];
      if (bodyFirstLine.startsWith("#")) {
        expect(prompt).not.toContain(bodyFirstLine);
      }
    }
  });
});
