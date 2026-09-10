import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill } from "./types.js";

// Skills are static instructional content authored with the agent itself,
// not part of whatever project the agent is currently working in — they
// live at the package root (skills/*.md), resolved relative to this
// module's own location so it works identically whether running compiled
// (dist/skills/registry.js) or via tsx (src/skills/registry.ts): both are
// exactly two directories below the package root.
const DEFAULT_SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");

export async function loadSkills(skillsDir: string = DEFAULT_SKILLS_DIR): Promise<Skill[]> {
  let files: string[];
  try {
    files = (await readdir(skillsDir)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  const skills = await Promise.all(
    files.map(async (file) => parseSkillFile(await readFile(join(skillsDir, file), "utf-8")))
  );

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

// Frontmatter here is a flat set of scalar key: value pairs — simple
// enough to hand-parse without pulling in a YAML dependency.
function parseSkillFile(raw: string): Skill {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("Skill file is missing --- frontmatter delimiters");
  }
  const [, frontmatter, body] = match;

  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    fields[key] = value;
  }

  if (!fields.name || !fields.description) {
    throw new Error('Skill frontmatter must include "name" and "description"');
  }

  return {
    name: fields.name,
    description: fields.description,
    alwaysOn: fields.always_on === "true",
    body: body.trim(),
  };
}
