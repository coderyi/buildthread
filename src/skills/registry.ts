import type { DiscoveredSkill } from "./types.js";

const SOURCE_PRIORITY: Record<DiscoveredSkill["source"], number> = {
  user: 0,
  project: 1
};

export function resolveSkillRegistry(skills: readonly DiscoveredSkill[]): DiscoveredSkill[] {
  const byName = new Map<string, DiscoveredSkill>();

  for (const skill of skills) {
    const existing = byName.get(skill.name);

    if (existing === undefined || SOURCE_PRIORITY[skill.source] >= SOURCE_PRIORITY[existing.source]) {
      byName.set(skill.name, skill);
    }
  }

  return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
}
