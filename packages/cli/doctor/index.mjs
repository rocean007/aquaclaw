/**
 * AquaClaw Doctor
 * Diagnoses configuration, connectivity, and dependency issues
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';

const execFileAsync = promisify(execFile);
const CONFIG_PATH = join(homedir(), '.aquaclaw', 'aquaclaw.json');

function pass(msg) { console.log(chalk.green('  ✓ ') + msg); }
function fail(msg) { console.log(chalk.red('  ✗ ') + msg); }
function warn(msg) { console.log(chalk.yellow('  ⚠ ') + msg); }
function info(msg) { console.log(chalk.dim('  · ') + msg); }
function section(title) { console.log('\n' + chalk.bold.cyan(title)); }

export async function runDoctor() {
  console.log(chalk.cyan('\n🦈 AquaClaw Doctor\n'));

  let issues = 0;

  // ── Node version ──────────────────────────────────────────────────────────
  section('Runtime');
  const nodeVer = process.version;
  const nodeMajor = parseInt(nodeVer.slice(1));
  if (nodeMajor >= 22) {
    pass(`Node.js ${nodeVer} (required: >=22.16)`);
  } else {
    fail(`Node.js ${nodeVer} — need >=22.16. Install: https://nodejs.org`);
    issues++;
  }

  // ── Config file ───────────────────────────────────────────────────────────
  section('Configuration');
  if (existsSync(CONFIG_PATH)) {
    pass(`Config found: ${CONFIG_PATH}`);
    try {
      const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));

      // API keys
      if (cfg.models?.anthropicApiKey) pass('Anthropic API key set');
      else warn('Anthropic API key not set — Claude models unavailable');

      if (cfg.models?.openaiApiKey) pass('OpenAI API key set');
      else info('OpenAI API key not set (optional)');

      // Agent model
      const model = cfg.agent?.model ?? 'not set';
      info(`Default model: ${model}`);

      // Channels
      const channels = Object.keys(cfg.channels ?? {});
      if (channels.length > 0) pass(`Channels configured: ${channels.join(', ')}`);
      else warn('No channels configured — run: aquaclaw onboard');

      // Gateway port
      info(`Gateway port: ${cfg.gateway?.port ?? 18790}`);

    } catch (e) {
      fail(`Config parse error: ${e.message}`);
      issues++;
    }
  } else {
    fail(`No config at ${CONFIG_PATH} — run: aquaclaw onboard`);
    issues++;
  }

  // ── Gateway connectivity ──────────────────────────────────────────────────
  section('Gateway');
  try {
    const res = await fetch('http://127.0.0.1:18790/health', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      pass(`Gateway running — v${data.version}, uptime: ${Math.round(data.uptime)}s`);
    } else {
      warn(`Gateway responded with ${res.status}`);
    }
  } catch {
    warn('Gateway not running — start with: aquaclaw gateway');
  }

  // ── Voice dependencies ────────────────────────────────────────────────────
  section('Voice');
  await checkBin('whisper', ['--version'], 'Whisper STT (local)', 'pip install openai-whisper');
  await checkBin(process.platform === 'darwin' ? 'say' : 'espeak', ['--version'], 'System TTS',
    process.platform === 'linux' ? 'sudo apt install espeak' : null);

  // ── Optional tools ────────────────────────────────────────────────────────
  section('Optional tools');
  await checkBin('ffmpeg', ['-version'], 'ffmpeg (audio processing)', 'brew install ffmpeg / apt install ffmpeg');
  await checkBin('git', ['--version'], 'git', null);
  if (process.platform === 'linux') {
    await checkBin('scrot', ['--version'], 'scrot (screenshots)', 'apt install scrot');
    await checkBin('notify-send', ['--version'], 'notify-send (notifications)', 'apt install libnotify-bin');
  }

  // ── Workspace ─────────────────────────────────────────────────────────────
  section('Workspace');
  const workspaceDir = join(homedir(), '.aquaclaw', 'workspace');
  if (existsSync(workspaceDir)) {
    pass(`Workspace: ${workspaceDir}`);
    for (const f of ['AGENTS.md', 'SOUL.md']) {
      const p = join(workspaceDir, f);
      if (existsSync(p)) pass(`  ${f} found`);
      else warn(`  ${f} missing — will use defaults`);
    }
  } else {
    warn(`Workspace not found at ${workspaceDir} — run: aquaclaw onboard`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('');
  if (issues === 0) {
    console.log(chalk.green('✓ All checks passed — AquaClaw is healthy 🦈'));
  } else {
    console.log(chalk.yellow(`⚠ ${issues} issue(s) found — see above for fixes`));
  }
  console.log('');
}

async function checkBin(bin, args, label, installHint) {
  try {
    const { stdout } = await execFileAsync(bin, args, { timeout: 3000 });
    const ver = stdout.split('\n')[0].slice(0, 40);
    pass(`${label}: ${ver}`);
  } catch {
    if (installHint) warn(`${label} not found — install: ${installHint}`);
    else info(`${label} not found (optional)`);
  }
}
