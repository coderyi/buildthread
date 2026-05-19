import { readFile } from "node:fs/promises";
import type { ActivatedSkill, DiscoveredSkill } from "./types.js";

export async function loadSkillContent(skill: DiscoveredSkill): Promise<ActivatedSkill> {
  return {
    ...skill,
    content: await readFile(skill.file, "utf8")
  };
}
