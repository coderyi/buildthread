import { discoverSkills } from "./discovery.js";
import { resolveSkillRegistry } from "./registry.js";
import { loadSkillContent } from "./content.js";
import type { ActivatedSkill } from "./types.js";

export class SkillNotFoundError extends Error {
  constructor(name: string) {
    super(`Skill not found: ${name}. Run buildthread --skills to list available skills.`);
    this.name = "SkillNotFoundError";
  }
}

export async function activateExplicitSkill(cwd: string, name: string): Promise<ActivatedSkill> {
  const skillName = name.trim();
  const skills = resolveSkillRegistry(await discoverSkills(cwd));
  const skill = skills.find((candidate) => candidate.name === skillName);

  if (skill === undefined) {
    throw new SkillNotFoundError(skillName);
  }

  return loadSkillContent(skill);
}
