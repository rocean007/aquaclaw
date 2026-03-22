/**
 * AquaClaw Onboarding Wizard
 * Guides users through first-time setup
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import chalk from 'chalk';

const CONFIG_DIR = join(homedir(), '.aquaclaw');
const CONFIG_PATH = join(CONFIG_DIR, 'aquaclaw.json');
const WORKSPACE_DIR = join(CONFIG_DIR, 'workspace');

function header() {
  console.log(chalk.cyan(`
   █████╗  ██████╗ ██╗   ██╗ █████╗  ██████╗██╗      █████╗ ██╗    ██╗
  ██╔══██╗██╔═══██╗██║   ██║██╔══██╗██╔════╝██║     ██╔══██╗██║    ██║
  ███████║██║   ██║██║   ██║███████║██║     ██║     ███████║██║ █╗ ██║
  ██╔══██║██║▄▄ ██║██║   ██║██╔══██║██║     ██║     ██╔══██║██║███╗██║
  ██║  ██║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗██║  ██║╚███╔███╔╝
  ╚═╝  ╚═╝ ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
`));
  console.log(chalk.bold('  AquaClaw Onboarding — Your personal AI agent setup\n'));
}

export async function runOnboard(opts = {}) {
  header();

  // Dynamic import to avoid loading inquirer at boot
  const { default: inquirer } = await import('inquirer');
  const { default: ora } = await import('ora');

  let existing = {};
  if (existsSync(CONFIG_PATH) && !opts.force) {
    existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    console.log(chalk.yellow('  ⚠ Existing config found. Updating it.\n'));
  }

  // ── Step 1: Model / API keys ──────────────────────────────────────────────
  console.log(chalk.bold('Step 1: AI Model Configuration\n'));
  const { primaryModel } = await inquirer.prompt([{
    type: 'list', name: 'primaryModel',
    message: 'Which AI model do you want to use?',
    default: existing.agent?.model ?? 'claude-opus-4-6',
    choices: [
      { name: '🏆 Claude Opus 4.6 (best reasoning, recommended)', value: 'claude-opus-4-6' },
      { name: '⚡ Claude Sonnet 4.6 (fast + smart)', value: 'claude-sonnet-4-6' },
      { name: '🤖 GPT-4o (OpenAI)', value: 'gpt-4o' },
      { name: '🦙 Llama 3.3 via Ollama (free, local)', value: 'ollama/llama3.3' },
      { name: '🌊 Gemma 3 via Ollama (Google, local)', value: 'ollama/gemma3' },
    ]
  }]);

  let anthropicKey = existing.models?.anthropicApiKey ?? '';
  let openaiKey = existing.models?.openaiApiKey ?? '';

  if (primaryModel.startsWith('claude')) {
    const { key } = await inquirer.prompt([{
      type: 'password', name: 'key',
      message: 'Anthropic API key (from console.anthropic.com):',
      default: anthropicKey ? '(keep existing)' : '',
    }]);
    if (key && key !== '(keep existing)') anthropicKey = key;
  } else if (primaryModel.startsWith('gpt') || primaryModel.startsWith('o1') || primaryModel.startsWith('o3')) {
    const { key } = await inquirer.prompt([{
      type: 'password', name: 'key',
      message: 'OpenAI API key (from platform.openai.com):',
      default: openaiKey ? '(keep existing)' : '',
    }]);
    if (key && key !== '(keep existing)') openaiKey = key;
  } else {
    console.log(chalk.dim('  (Ollama models are free and run locally — no API key needed)'));
    const { ollamaUrl } = await inquirer.prompt([{
      type: 'input', name: 'ollamaUrl',
      message: 'Ollama base URL:',
      default: existing.models?.ollamaBaseUrl ?? 'http://localhost:11434',
    }]);
    existing.models = { ...existing.models, ollamaBaseUrl: ollamaUrl };
  }

  // ── Step 2: Channels ──────────────────────────────────────────────────────
  console.log(chalk.bold('\nStep 2: Messaging Channels\n'));
  const { selectedChannels } = await inquirer.prompt([{
    type: 'checkbox', name: 'selectedChannels',
    message: 'Which channels do you want to connect? (space to select)',
    choices: [
      { name: '💬 Telegram', value: 'telegram' },
      { name: '🎮 Discord', value: 'discord' },
      { name: '💼 Slack', value: 'slack' },
      { name: '📱 WhatsApp', value: 'whatsapp' },
      { name: '📧 Email (IMAP)', value: 'email' },
      { name: '📡 Matrix', value: 'matrix' },
      { name: '🌐 WebChat (always on)', value: 'webchat', checked: true },
      { name: '🔗 Webhook (inbound HTTP)', value: 'webhook' },
    ]
  }]);

  const channelConfig = {};
  for (const ch of selectedChannels) {
    channelConfig[ch] = await promptChannel(inquirer, ch, existing.channels?.[ch] ?? {});
  }

  // ── Step 3: Voice ─────────────────────────────────────────────────────────
  console.log(chalk.bold('\nStep 3: Voice\n'));
  const { voiceEnabled } = await inquirer.prompt([{
    type: 'confirm', name: 'voiceEnabled',
    message: 'Enable voice input/output?',
    default: existing.voice?.enabled ?? false,
  }]);

  let voiceConfig = { enabled: voiceEnabled };
  if (voiceEnabled) {
    const { ttsProvider } = await inquirer.prompt([{
      type: 'list', name: 'ttsProvider',
      message: 'Text-to-speech provider:',
      default: existing.voice?.tts ?? 'system',
      choices: [
        { name: 'System (free, built-in)', value: 'system' },
        { name: 'ElevenLabs (best quality)', value: 'elevenlabs' },
        { name: 'OpenAI TTS', value: 'openai' },
        { name: 'Coqui (free, local)', value: 'coqui' },
      ]
    }]);
    voiceConfig.tts = ttsProvider;

    const { wakeWordEnabled } = await inquirer.prompt([{
      type: 'confirm', name: 'wakeWordEnabled',
      message: 'Enable wake word detection? ("Hey Shark" / "AquaClaw")',
      default: existing.voice?.wakeWord?.enabled ?? false,
    }]);
    if (wakeWordEnabled) {
      const { wakeWords } = await inquirer.prompt([{
        type: 'input', name: 'wakeWords',
        message: 'Wake words (comma separated):',
        default: (existing.voice?.wakeWords ?? ['hey shark', 'aquaclaw']).join(', '),
      }]);
      voiceConfig.wakeWord = { enabled: true };
      voiceConfig.wakeWords = wakeWords.split(',').map(w => w.trim().toLowerCase());
    }

    if (ttsProvider === 'elevenlabs') {
      const { elKey } = await inquirer.prompt([{
        type: 'password', name: 'elKey',
        message: 'ElevenLabs API key:',
      }]);
      voiceConfig.elevenLabsApiKey = elKey;
    }
  }

  // ── Step 4: Security ──────────────────────────────────────────────────────
  console.log(chalk.bold('\nStep 4: Security\n'));
  const { dmPolicy } = await inquirer.prompt([{
    type: 'list', name: 'dmPolicy',
    message: 'DM security policy:',
    default: 'pairing',
    choices: [
      { name: 'Pairing (recommended) — unknown senders get a code to verify', value: 'pairing' },
      { name: 'Allowlist — only specific users can message', value: 'allowlist' },
      { name: 'Open — anyone can message (not recommended)', value: 'open' },
    ]
  }]);

  // ── Step 5: Daemon ────────────────────────────────────────────────────────
  if (opts.installDaemon) {
    console.log(chalk.bold('\nStep 5: Background Service\n'));
    const spinner = ora('Installing background service...').start();
    try {
      await installDaemon();
      spinner.succeed('Background service installed — AquaClaw will start on login');
    } catch (e) {
      spinner.fail(`Daemon install failed: ${e.message}`);
      console.log(chalk.dim('  Run manually: aquaclaw gateway'));
    }
  }

  // ── Write config ──────────────────────────────────────────────────────────
  mkdirSync(CONFIG_DIR, { recursive: true });
  mkdirSync(WORKSPACE_DIR, { recursive: true });

  const config = {
    ...existing,
    agent: { model: primaryModel, instructions: existing.agent?.instructions ?? '' },
    models: {
      ...existing.models,
      anthropicApiKey: anthropicKey || existing.models?.anthropicApiKey,
      openaiApiKey: openaiKey || existing.models?.openaiApiKey,
    },
    channels: { ...existing.channels, ...channelConfig },
    voice: voiceConfig,
    gateway: { port: existing.gateway?.port ?? 18790, bind: 'loopback', dmPolicy },
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  // Write default AGENTS.md
  if (!existsSync(join(WORKSPACE_DIR, 'AGENTS.md'))) {
    writeFileSync(join(WORKSPACE_DIR, 'AGENTS.md'),
      `# AquaClaw Agent\n\nYou are AquaClaw 🦈, a personal AI assistant running locally.\nBe helpful, concise, and proactive.\n`);
  }

  // Write default SOUL.md
  if (!existsSync(join(WORKSPACE_DIR, 'SOUL.md'))) {
    writeFileSync(join(WORKSPACE_DIR, 'SOUL.md'),
      `# Soul\n\nYou care about the user. You are direct and efficient. You remember context.\n`);
  }

  console.log(chalk.green('\n✓ AquaClaw configured!\n'));
  console.log(chalk.bold('Next steps:'));
  console.log('  1. Start the gateway:   ' + chalk.cyan('aquaclaw gateway'));
  console.log('  2. Open the Web UI:     ' + chalk.cyan('http://localhost:18790'));
  console.log('  3. Chat via CLI:        ' + chalk.cyan('aquaclaw chat'));
  console.log('  4. Voice mode:          ' + chalk.cyan('aquaclaw voice\n'));
}

async function promptChannel(inquirer, channel, existing) {
  const prompts = {
    telegram: [{ type: 'password', name: 'botToken', message: 'Telegram bot token (from @BotFather):', default: existing.botToken ? '(keep)' : '' }],
    discord: [{ type: 'password', name: 'token', message: 'Discord bot token:', default: existing.token ? '(keep)' : '' }],
    slack: [
      { type: 'password', name: 'botToken', message: 'Slack bot token (xoxb-...):', default: existing.botToken ? '(keep)' : '' },
      { type: 'password', name: 'appToken', message: 'Slack app token (xapp-...):', default: existing.appToken ? '(keep)' : '' },
    ],
    email: [
      { type: 'input', name: 'imapHost', message: 'IMAP host:', default: existing.imapHost ?? 'imap.gmail.com' },
      { type: 'input', name: 'user', message: 'Email address:', default: existing.user ?? '' },
      { type: 'password', name: 'password', message: 'App password:', default: existing.password ? '(keep)' : '' },
    ],
    matrix: [
      { type: 'input', name: 'homeserver', message: 'Matrix homeserver URL:', default: existing.homeserver ?? 'https://matrix.org' },
      { type: 'input', name: 'userId', message: 'User ID (@user:matrix.org):', default: existing.userId ?? '' },
      { type: 'password', name: 'accessToken', message: 'Access token:', default: existing.accessToken ? '(keep)' : '' },
    ],
    whatsapp: [],
    webchat: [],
    webhook: [{ type: 'input', name: 'path', message: 'Webhook path:', default: existing.path ?? '/webhook/inbound' }],
  };

  const questions = prompts[channel] ?? [];
  if (questions.length === 0) return { enabled: true };
  const answers = await inquirer.prompt(questions);
  // Don't overwrite secrets with "(keep)" placeholder
  for (const [k, v] of Object.entries(answers)) {
    if (v === '(keep)') answers[k] = existing[k];
  }
  return { ...existing, ...answers, enabled: true };
}

async function installDaemon() {
  const { platform } = process;
  if (platform === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.aquaclaw.gateway</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${process.argv[1]}</string><string>gateway</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(homedir(), '.aquaclaw', 'gateway.log')}</string>
  <key>StandardErrorPath</key><string>${join(homedir(), '.aquaclaw', 'gateway.error.log')}</string>
</dict></plist>`;
    const plistPath = join(homedir(), 'Library/LaunchAgents/com.aquaclaw.gateway.plist');
    writeFileSync(plistPath, plist);
    const { execFileAsync } = await import('../utils/exec.mjs');
    await execFileAsync('launchctl', ['load', plistPath]);
  } else if (platform === 'linux') {
    const unit = `[Unit]
Description=AquaClaw Gateway
After=network.target

[Service]
Type=simple
ExecStart=${process.execPath} ${process.argv[1]} gateway
Restart=always
RestartSec=5

[Install]
WantedBy=default.target`;
    const unitPath = join(homedir(), '.config/systemd/user/aquaclaw.service');
    mkdirSync(join(homedir(), '.config/systemd/user'), { recursive: true });
    writeFileSync(unitPath, unit);
    const { execFileAsync } = await import('../utils/exec.mjs');
    await execFileAsync('systemctl', ['--user', 'enable', '--now', 'aquaclaw']);
  }
}
