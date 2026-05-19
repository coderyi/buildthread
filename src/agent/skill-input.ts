export interface ParsedSkillInput {
  readonly prompt: string;
  readonly skillName?: string;
}

const SKILL_PREFIX = "/skill:";

export function parseSkillInput(input: string): ParsedSkillInput {
  const trimmed = input.trim();

  if (!trimmed.startsWith(SKILL_PREFIX)) {
    return { prompt: input };
  }

  const rest = trimmed.slice(SKILL_PREFIX.length);
  const separator = rest.search(/\s/u);
  const rawName = separator === -1 ? rest : rest.slice(0, separator);
  const prompt = separator === -1 ? "" : rest.slice(separator).trim();
  const skillName = rawName.trim();

  if (skillName.length === 0) {
    throw new Error("Skill name is required after /skill:.");
  }

  if (prompt.length === 0) {
    throw new Error("Prompt is required after /skill:<name>.");
  }

  return { prompt, skillName };
}
