import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { logWarning } from "./log.js";

export interface LoadedSkill {
  name: string;
  description: string;
  source: "workspace" | "channel";
  baseDirPath: string;
  filePath: string;
}

function toPromptPath(workingDir: string, workspacePath: string, targetPath: string): string {
  const relativePath = path.relative(workingDir, targetPath);
  const segments = relativePath.split(path.sep).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return workspacePath;
  }
  return path.posix.join(workspacePath, ...segments);
}

function extractFrontmatter(content: string): string | null {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  return match ? match[1] ?? null : null;
}

function parseFrontmatterValue(frontmatter: string, key: string): string | null {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match || !match[1]) {
    return null;
  }

  const value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim() || null;
  }
  return value || null;
}

async function loadSkillsFromDir(options: {
  workingDir: string;
  workspacePath: string;
  skillsDir: string;
  source: "workspace" | "channel";
}): Promise<LoadedSkill[]> {
  let entries: Array<{ isDirectory(): boolean; name: string }>;
  try {
    entries = await readdir(options.skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: LoadedSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillDir = path.join(options.skillsDir, entry.name);
    const skillFile = path.join(skillDir, "SKILL.md");

    let content: string;
    try {
      content = await readFile(skillFile, "utf8");
    } catch {
      continue;
    }

    const frontmatter = extractFrontmatter(content);
    if (!frontmatter) {
      logWarning("Skipping skill without YAML frontmatter", skillFile);
      continue;
    }

    const name = parseFrontmatterValue(frontmatter, "name");
    const description = parseFrontmatterValue(frontmatter, "description");
    if (!name || !description) {
      logWarning("Skipping skill without required name/description", skillFile);
      continue;
    }

    skills.push({
      name,
      description,
      source: options.source,
      baseDirPath: toPromptPath(options.workingDir, options.workspacePath, skillDir),
      filePath: toPromptPath(options.workingDir, options.workspacePath, skillFile),
    });
  }

  return skills;
}

export async function loadMomSkills(
  workingDir: string,
  channelId: string,
  workspacePath: string,
): Promise<LoadedSkill[]> {
  const skillMap = new Map<string, LoadedSkill>();

  const workspaceSkills = await loadSkillsFromDir({
    workingDir,
    workspacePath,
    skillsDir: path.join(workingDir, "skills"),
    source: "workspace",
  });
  for (const skill of workspaceSkills) {
    skillMap.set(skill.name, skill);
  }

  const channelSkills = await loadSkillsFromDir({
    workingDir,
    workspacePath,
    skillsDir: path.join(workingDir, channelId, "skills"),
    source: "channel",
  });
  for (const skill of channelSkills) {
    skillMap.set(skill.name, skill);
  }

  return Array.from(skillMap.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function formatSkillsForPrompt(skills: readonly LoadedSkill[]): string {
  if (skills.length === 0) {
    return "(no skills installed yet)";
  }

  return skills
    .map(
      (skill) =>
        `- ${skill.name} (${skill.source}) — ${skill.description}\n  Directory: ${skill.baseDirPath}\n  Readme: ${skill.filePath}`,
    )
    .join("\n");
}
