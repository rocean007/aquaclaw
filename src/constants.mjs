export const AQUACLAW_VERSION = '1.0.0';
export const GATEWAY_WS_PATH = '/aquaclaw';
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
export const CONFIG_DIR_NAME = '.aquaclaw';

export const THINKING_BUDGETS = {
  off: 0,
  minimal: 1024,
  low: 2000,
  medium: 5000,
  high: 10000,
  max: 32000,
  xhigh: 32000,
};

export const SUPPORTED_CHANNELS = [
  'telegram', 'discord', 'slack', 'whatsapp', 'matrix',
  'irc', 'signal', 'msteams', 'webchat', 'webhook',
  'email', 'sms', 'rss',
];

export const SUPPORTED_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
  'gpt-4o',
  'gpt-4o-mini',
  'o1', 'o3',
  'ollama/llama3.3',
  'ollama/gemma3',
  'ollama/mistral',
  'ollama/qwen2.5',
];
