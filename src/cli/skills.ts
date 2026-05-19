import { discoverSkills } from "../skills/discovery.js";
import { resolveSkillRegistry } from "../skills/registry.js";
import type { DiscoveredSkill } from "../skills/types.js";

export async function formatSkills(cwd: string): Promise<string> {
  const skills = resolveSkillRegistry(await discoverSkills(cwd));

  if (skills.length === 0) {
    return "No skills found.\n";
  }

  const lines = ["Available skills:", ""];

  for (const skill of skills) {
    lines.push(...formatSkill(skill), "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatSkill(skill: DiscoveredSkill): string[] {
  return [
    `- ${skill.name}`,
    `  Source: ${skill.source}`,
    `  Directory: ${skill.directory}`,
    `  Description: ${skill.description}`
  ];
}
