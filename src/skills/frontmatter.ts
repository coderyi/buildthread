import type { SkillMetadata } from "./types.js";

export class SkillFrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillFrontmatterError";
  }
}

export function parseSkillFrontmatter(content: string): SkillMetadata {
  const lines = content.split(/\r?\n/);

  if (lines[0]?.trim() !== "---") {
    throw new SkillFrontmatterError("SKILL.md is missing YAML frontmatter.");
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");

  if (endIndex === -1) {
    throw new SkillFrontmatterError("SKILL.md frontmatter is not closed.");
  }

  const fields = new Map<string, string>();

  for (const line of lines.slice(1, endIndex)) {
    const trimmed = line.trim();

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    fields.set(key, normalizeScalar(rawValue));
  }

  const name = fields.get("name")?.trim();
  const description = fields.get("description")?.trim();

  if (name === undefined || name.length === 0) {
    throw new SkillFrontmatterError("SKILL.md frontmatter is missing name.");
  }

  if (description === undefined || description.length === 0) {
    throw new SkillFrontmatterError("SKILL.md frontmatter is missing description.");
  }

  return { name, description };
}

function normalizeScalar(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];

  if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }

  return value;
}
