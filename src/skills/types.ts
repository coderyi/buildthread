export type SkillSource = "project" | "user";

export interface SkillSearchRoot {
  readonly source: SkillSource;
  readonly directory: string;
}

export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
}

export interface DiscoveredSkill extends SkillMetadata {
  readonly source: SkillSource;
  readonly directory: string;
  readonly file: string;
}

export interface ActivatedSkill extends DiscoveredSkill {
  readonly content: string;
}
