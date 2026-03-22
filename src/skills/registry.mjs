/**
 * AquaClaw Skill Registry
 *
 * Skills are markdown files in ~/.aquaclaw/workspace/skills/<name>/SKILL.md
 * They inject prompts into the agent system message.
 *
 * Built-in skills:
 *  - coding: expert software engineer persona + code quality rules
 *  - research: deep research mode with citation requirements
 *  - writing: professional writing assistance
 *  - personal: personal assistant with memory/calendar integration
 *  - security: security-focused analysis
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, mkdirSync, readdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { log } from '../utils/log.mjs';

const SKILLS_DIR = join(homedir(), '.aquaclaw', 'workspace', 'skills');

export class SkillRegistry {
  constructor(config) {
    this.config = config;
    this._skills = new Map();
  }

  async load() {
    mkdirSync(SKILLS_DIR, { recursive: true });
    this._loadBuiltins();
    this._loadWorkspaceSkills();
    log.info(`Skills loaded: ${this._skills.size}`);
  }

  async list() {
    return [...this._skills.values()].map(s => ({
      name: s.name, description: s.description, enabled: s.enabled !== false
    }));
  }

  async install(name) {
    // In a real implementation, this would fetch from ClawHub (aquahub?)
    const known = {
      'coding': BUILTIN_SKILLS.coding,
      'research': BUILTIN_SKILLS.research,
      'writing': BUILTIN_SKILLS.writing,
    };
    if (known[name]) {
      const dir = join(SKILLS_DIR, name);
      mkdirSync(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), known[name].prompt);
      this._skills.set(name, { ...known[name], enabled: true });
      return { installed: name };
    }
    throw new Error(`Skill not found: ${name}. Available: ${Object.keys(known).join(', ')}`);
  }

  async uninstall(name) {
    this._skills.delete(name);
    return { uninstalled: name };
  }

  async search(query) {
    const builtins = Object.values(BUILTIN_SKILLS);
    return builtins.filter(s =>
      s.name.includes(query) || s.description.includes(query)
    );
  }

  _loadBuiltins() {
    for (const [name, skill] of Object.entries(BUILTIN_SKILLS)) {
      if (!this._skills.has(name)) {
        this._skills.set(name, { ...skill, source: 'builtin' });
      }
    }
  }

  _loadWorkspaceSkills() {
    if (!existsSync(SKILLS_DIR)) return;
    try {
      for (const dir of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        const skillPath = join(SKILLS_DIR, dir.name, 'SKILL.md');
        if (!existsSync(skillPath)) continue;
        const content = readFileSync(skillPath, 'utf8');
        this._skills.set(dir.name, {
          name: dir.name,
          description: content.split('\n')[0].replace('#', '').trim(),
          prompt: content,
          source: 'workspace',
          enabled: true,
        });
      }
    } catch {}
  }
}

export async function loadSkillPrompts(config, session) {
  const parts = [];

  // Load workspace files (AGENTS.md, SOUL.md, TOOLS.md)
  const workspaceDir = join(homedir(), '.aquaclaw', 'workspace');
  for (const file of ['AGENTS.md', 'SOUL.md', 'TOOLS.md']) {
    const path = join(workspaceDir, file);
    if (existsSync(path)) {
      try { parts.push(readFileSync(path, 'utf8')); } catch {}
    }
  }

  // Load session-specific skill
  if (session?.skill) {
    const skillPath = join(workspaceDir, 'skills', session.skill, 'SKILL.md');
    if (existsSync(skillPath)) {
      try { parts.push(readFileSync(skillPath, 'utf8')); } catch {}
    }
  }

  return parts.join('\n\n---\n\n') || null;
}

const BUILTIN_SKILLS = {
  coding: {
    name: 'coding',
    description: 'Expert software engineer persona with code quality standards',
    prompt: `# Coding Skill

You are an expert software engineer with 20+ years of experience across all major languages.

When writing code:
- Write complete, production-ready implementations (not placeholders)
- Include error handling and edge case handling
- Add clear comments explaining complex logic
- Follow language-specific best practices and idioms
- Suggest tests and how to run them
- Explain architectural decisions when non-obvious

Prefer correctness over brevity. If a task is complex, break it into clear steps.`,
  },
  research: {
    name: 'research',
    description: 'Deep research mode with structured output and citation tracking',
    prompt: `# Research Skill

When conducting research:
- Cover the topic comprehensively from multiple angles
- Distinguish between established facts and emerging/contested claims
- Use structured headers and organized sections
- Note knowledge limitations and where information may be outdated
- Suggest follow-up questions for deeper exploration`,
  },
  writing: {
    name: 'writing',
    description: 'Professional writing assistance with style adaptation',
    prompt: `# Writing Skill

When helping with writing:
- Adapt tone and style to the context (professional, casual, academic, creative)
- Prioritize clarity and readability
- Use active voice and concrete language
- Suggest structural improvements when appropriate
- Offer alternatives when there are multiple good approaches`,
  },
  personal: {
    name: 'personal',
    description: 'Personal assistant mode with memory and scheduling',
    prompt: `# Personal Assistant Skill

You are a highly capable personal assistant. You:
- Remember context across conversations (use memory tool)
- Help manage tasks, schedules, and priorities
- Proactively notice and flag important things
- Are concise and respect the user's time
- Learn preferences and adapt over time`,
  },
};
