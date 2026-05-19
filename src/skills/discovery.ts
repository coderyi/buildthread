import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseSkillFrontmatter } from "./frontmatter.js";
import type { DiscoveredSkill, SkillSearchRoot } from "./types.js";

const SKILLS_DIRECTORY = ".buildthread/skills";
const SKILL_ENTRY_FILE = "SKILL.md";

export function getDefaultSkillSearchRoots(cwd: string): SkillSearchRoot[] {
  return [
    {
      source: "user",
      directory: path.join(os.homedir(), SKILLS_DIRECTORY)
    },
    {
      source: "project",
      directory: path.join(path.resolve(cwd), SKILLS_DIRECTORY)
    }
  ];
}

export async function discoverSkills(cwd: string): Promise<DiscoveredSkill[]> {
  const roots = getDefaultSkillSearchRoots(cwd);
  const discovered: DiscoveredSkill[] = [];

  for (const root of roots) {
    discovered.push(...(await discoverSkillsInRoot(root)));
  }

  return discovered;
}

async function discoverSkillsInRoot(root: SkillSearchRoot): Promise<DiscoveredSkill[]> {
  const rootInfo = await stat(root.directory).catch(() => undefined);

  if (rootInfo === undefined || !rootInfo.isDirectory()) {
    return [];
  }

  const entries = await readdir(root.directory, { withFileTypes: true }).catch(() => []);
  const skills: DiscoveredSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = path.join(root.directory, entry.name);
    const file = path.join(directory, SKILL_ENTRY_FILE);
    const fileInfo = await stat(file).catch(() => undefined);

    if (fileInfo === undefined || !fileInfo.isFile()) {
      continue;
    }

    const content = await readFile(file, "utf8").catch(() => undefined);

    if (content === undefined) {
      continue;
    }

    try {
      const metadata = parseSkillFrontmatter(content);
      skills.push({
        ...metadata,
        source: root.source,
        directory,
        file
      });
    } catch {
      continue;
    }
  }

  return skills;
}
