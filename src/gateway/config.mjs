import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync } from 'fs';

const CONFIG_PATH = process.env.AQUACLAW_CONFIG ?? join(homedir(), '.aquaclaw', 'aquaclaw.json');

function loadConfig() {
  if (existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
      console.error(`Failed to parse config at ${CONFIG_PATH}: ${e.message}`);
    }
  }
  // Default config — works with env vars
  return {
    agent: { model: process.env.AQUACLAW_MODEL ?? 'claude-sonnet-4-6' },
    models: {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      openaiApiKey: process.env.OPENAI_API_KEY,
    },
    gateway: { port: parseInt(process.env.AQUACLAW_PORT ?? '18790'), bind: 'loopback' },
    channels: {},
    voice: { enabled: false },
  };
}

export const config = loadConfig();
