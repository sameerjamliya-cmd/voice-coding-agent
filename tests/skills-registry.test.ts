import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { loadSkills } from "../src/skills/registry.js";
import { composeSystemPrompt } from "../src/skills/compose-system-prompt.js";
import { createLoadSkillTool } from "../src/tools/load-skill.js";

// Mirrors registry.ts's own DEFAULT_SKILLS_DIR resolution (package root /
// skills), but from this test file's location instead — kept independent
// of loadSkills() itself so these checks aren't validating the loader
// against its own output.
const REAL_SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const REAL_SKILL_FILENAMES = (await readdir(REAL_SKILLS_DIR)).filter((f) => f.endsWith(".md"));

const DESCRIPTION_MAX_CHARS = 200;

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

  describe("with a temp skills directory containing bad files", () => {
    let skillsDir: string;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeAll(async () => {
      skillsDir = await mkdtemp(join(tmpdir(), "skills-test-"));

      await writeFile(
        join(skillsDir, "a-good-one.md"),
        `---\nname: good-one\ndescription: A perfectly fine skill.\nalways_on: false\n---\n\n# Good One\n\nSome real body content.\n`,
        "utf-8"
      );

      // No frontmatter delimiters at all.
      await writeFile(join(skillsDir, "b-no-frontmatter.md"), `# Just a heading\n\nNo frontmatter here.\n`, "utf-8");

      // Frontmatter present but missing the required "description" field.
      await writeFile(
        join(skillsDir, "c-missing-description.md"),
        `---\nname: missing-description\nalways_on: false\n---\n\nBody.\n`,
        "utf-8"
      );

      // Duplicate name of "good-one" — sorted after a-good-one.md
      // alphabetically, so "first occurrence wins" means this one loses.
      await writeFile(
        join(skillsDir, "z-duplicate-name.md"),
        `---\nname: good-one\ndescription: A different skill that reuses the same name.\nalways_on: false\n---\n\nDifferent body.\n`,
        "utf-8"
      );
    });

    afterAll(async () => {
      await rm(skillsDir, { recursive: true, force: true });
    });

    it("excludes malformed skill files from the index instead of crashing the whole load", async () => {
      // Before the fix, one bad file in the directory would reject the
      // whole Promise.all and loadSkills() would throw entirely.
      const skills = await loadSkills(skillsDir);
      const names = skills.map((s) => s.name);
      expect(names).toContain("good-one");
      expect(names).not.toContain("missing-description");
      expect(skills).toHaveLength(1);
    });

    it("logs a warning for each excluded file rather than failing silently", async () => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await loadSkills(skillsDir);
      const warnings = warnSpy.mock.calls.map((args) => String(args[0]));
      expect(warnings.some((w) => w.includes("b-no-frontmatter.md"))).toBe(true);
      expect(warnings.some((w) => w.includes("c-missing-description.md"))).toBe(true);
      warnSpy.mockRestore();
    });

    it("on a duplicate skill name, the first occurrence (alphabetically by filename) wins", async () => {
      const skills = await loadSkills(skillsDir);
      const goodOne = skills.find((s) => s.name === "good-one");
      expect(goodOne?.description).toBe("A perfectly fine skill.");
    });
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

  it("no on-demand skill's full body text (a distinctive line from its Rules section) leaks into the index", async () => {
    const skills = await loadSkills();
    const onDemand = skills.filter((s) => !s.alwaysOn);
    const prompt = composeSystemPrompt("BASE", skills);

    for (const skill of onDemand) {
      const rulesLine = skill.body
        .split("\n")
        .find((line) => line.trim().startsWith("1.") && line.length > 20);
      if (rulesLine) {
        expect(prompt).not.toContain(rulesLine.trim());
      }
    }
  });
});

describe("load_skill tool", () => {
  it("a valid name returns only the body content, not the raw file with frontmatter", async () => {
    const skills = await loadSkills();
    const tool = createLoadSkillTool(skills);
    const debugging = skills.find((s) => s.name === "debugging")!;

    const result = await tool.execute({ name: "debugging" });
    expect(result.error).toBeUndefined();
    expect(result.output).toBe(debugging.body);
    expect(result.output).not.toContain("---\nname:");
  });

  it("an unknown name returns a ToolResult error listing the valid skill names", async () => {
    const skills = await loadSkills();
    const tool = createLoadSkillTool(skills);

    const result = await tool.execute({ name: "does-not-exist" });
    expect(result.error).toMatch(/no skill named/i);
    for (const skill of skills) {
      expect(result.error).toContain(skill.name);
    }
  });

  it("against an empty skill list, always returns a clean error rather than crashing", async () => {
    const tool = createLoadSkillTool([]);
    const result = await tool.execute({ name: "anything" });
    expect(result.error).toMatch(/no skill named/i);
    expect(result.output).toBeUndefined();
  });
});

// Generated from the actual skills/ directory contents at test time — not
// a hand-listed array of skill names, which would silently drift out of
// sync the moment a skill is added, renamed, or removed. Each check below
// runs once per real skill file via it.each, so this scales automatically
// (23 skills x 5 checks today; more skills later means more cases, no
// test file edits needed).
describe("every real skill file (generated from skills/ at test time)", () => {
  it("found at least one skill file to check (sanity check that the directory resolution itself isn't broken)", () => {
    expect(REAL_SKILL_FILENAMES.length).toBeGreaterThan(0);
  });

  it.each(REAL_SKILL_FILENAMES)("%s: frontmatter parses without error", async (filename) => {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(join(REAL_SKILLS_DIR, filename), "utf-8");
    expect(raw).toMatch(/^---\n[\s\S]*?\n---\n/);
  });

  it.each(REAL_SKILL_FILENAMES)("%s: name field matches the filename (minus .md)", async (filename) => {
    const skills = await loadSkills(REAL_SKILLS_DIR);
    const expectedName = filename.replace(/\.md$/, "");
    const skill = skills.find((s) => s.name === expectedName);
    expect(skill, `expected a skill named "${expectedName}" loaded from ${filename}`).toBeDefined();
  });

  it.each(REAL_SKILL_FILENAMES)(
    "%s: description is non-empty and under the context-budget length ceiling",
    async (filename) => {
      const skills = await loadSkills(REAL_SKILLS_DIR);
      const expectedName = filename.replace(/\.md$/, "");
      const skill = skills.find((s) => s.name === expectedName)!;
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_CHARS);
    }
  );

  it.each(REAL_SKILL_FILENAMES)("%s: body content (below frontmatter) is non-empty", async (filename) => {
    const skills = await loadSkills(REAL_SKILLS_DIR);
    const expectedName = filename.replace(/\.md$/, "");
    const skill = skills.find((s) => s.name === expectedName)!;
    expect(skill.body.length).toBeGreaterThan(0);
  });

  it.each(REAL_SKILL_FILENAMES)(
    "%s: load_skill with this exact name returns exactly this file's body",
    async (filename) => {
      const skills = await loadSkills(REAL_SKILLS_DIR);
      const expectedName = filename.replace(/\.md$/, "");
      const skill = skills.find((s) => s.name === expectedName)!;
      const tool = createLoadSkillTool(skills);
      const result = await tool.execute({ name: expectedName });
      expect(result.error).toBeUndefined();
      expect(result.output).toBe(skill.body);
    }
  );
});
