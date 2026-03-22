#!/usr/bin/env node
/**
 * AquaClaw CLI
 *
 * aquaclaw onboard            — interactive setup wizard
 * aquaclaw gateway            — start the gateway
 * aquaclaw agent              — send a one-shot message
 * aquaclaw chat               — interactive REPL
 * aquaclaw voice              — voice input loop
 * aquaclaw skills install X   — install a skill
 * aquaclaw channels login X   — authenticate a channel
 * aquaclaw sessions           — list/manage sessions
 * aquaclaw pairing approve    — approve a DM pairing code
 * aquaclaw config             — view/edit config
 * aquaclaw doctor             — diagnose issues
 * aquaclaw update             — update AquaClaw
 * aquaclaw status             — gateway status
 */

import { Command } from 'commander';
import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';

const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url)));
const program = new Command();

// ── Shared helpers ──────────────────────────────────────────────────────────

const GATEWAY_URL = process.env.AQUACLAW_GATEWAY ?? 'ws://127.0.0.1:18790/aquaclaw';
const CONFIG_DIR = join(homedir(), '.aquaclaw');

function shark(msg) { process.stdout.write(chalk.cyan('🦈 ') + msg + '\n'); }
function ok(msg) { process.stdout.write(chalk.green('✓ ') + msg + '\n'); }
function err(msg) { process.stderr.write(chalk.red('✗ ') + msg + '\n'); }
function warn(msg) { process.stdout.write(chalk.yellow('⚠ ') + msg + '\n'); }

async function wsCall(method, params = {}) {
  const { WebSocket } = await import('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL);
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Gateway timeout. Is it running? Try: aquaclaw gateway')); }, 10000);

    ws.on('open', () => ws.send(JSON.stringify({ method, id, params })));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.close();
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        }
      } catch {}
    });
    ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

// ── CLI setup ───────────────────────────────────────────────────────────────

program
  .name('aquaclaw')
  .description(chalk.cyan('🦈 AquaClaw') + ' — Your personal AI agent')
  .version(pkg.version, '-V, --version')
  .addHelpText('before', chalk.cyan(`
   █████╗  ██████╗ ██╗   ██╗ █████╗  ██████╗██╗      █████╗ ██╗    ██╗
  ██╔══██╗██╔═══██╗██║   ██║██╔══██╗██╔════╝██║     ██╔══██╗██║    ██║
  ███████║██║   ██║██║   ██║███████║██║     ██║     ███████║██║ █╗ ██║
  ██╔══██║██║▄▄ ██║██║   ██║██╔══██║██║     ██║     ██╔══██║██║███╗██║
  ██║  ██║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗██║  ██║╚███╔███╔╝
  ╚═╝  ╚═╝ ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
`));

// ── aquaclaw onboard ─────────────────────────────────────────────────────────
program
  .command('onboard')
  .description('Interactive setup wizard — start here!')
  .option('--install-daemon', 'Install as a background service (launchd/systemd)')
  .option('--force', 'Re-run onboarding even if already configured')
  .action(async (opts) => {
    const { runOnboard } = await import('../onboard/wizard.mjs');
    await runOnboard(opts);
  });

// ── aquaclaw gateway ─────────────────────────────────────────────────────────
program
  .command('gateway')
  .description('Start the AquaClaw gateway')
  .option('-p, --port <port>', 'Port to listen on', '18790')
  .option('-v, --verbose', 'Verbose logging')
  .option('--bind <bind>', 'Bind address (loopback|all)', 'loopback')
  .option('--no-ui', 'Disable Web UI')
  .action(async (opts) => {
    shark(`Starting AquaClaw Gateway v${pkg.version}...`);
    const { Gateway } = await import('../../src/gateway/index.mjs');
    const gw = new Gateway({ port: parseInt(opts.port), verbose: opts.verbose, bind: opts.bind });
    process.on('SIGINT', () => gw.stop().then(() => process.exit(0)));
    process.on('SIGTERM', () => gw.stop().then(() => process.exit(0)));
    await gw.start();
  });

// ── aquaclaw agent ────────────────────────────────────────────────────────────
program
  .command('agent')
  .description('Send a message to the agent')
  .option('-m, --message <message>', 'Message to send')
  .option('-s, --session <id>', 'Session ID', 'main')
  .option('--model <model>', 'Model to use')
  .option('--thinking <level>', 'Thinking level (off/low/medium/high/max)', 'medium')
  .option('--stream', 'Stream the response')
  .action(async (opts) => {
    let message = opts.message;
    if (!message) {
      const { createInterface } = await import('readline');
      const rl = createInterface({ input: process.stdin });
      message = await new Promise(r => { let d = ''; rl.on('line', l => d += l + '\n'); rl.on('close', () => r(d.trim())); });
    }
    if (!message) { err('No message provided'); process.exit(1); }

    try {
      if (opts.stream) {
        const { WebSocket } = await import('ws');
        const ws = new WebSocket(GATEWAY_URL);
        ws.on('open', () => ws.send(JSON.stringify({ method: 'agent.stream', id: '1', params: { sessionId: opts.session, message, model: opts.model, thinkingLevel: opts.thinking } })));
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'stream.delta') process.stdout.write(msg.text);
          if (msg.type === 'stream.done') { console.log(); ws.close(); }
          if (msg.type === 'stream.error') { err(msg.error); ws.close(); }
        });
      } else {
        const result = await wsCall('agent.send', { sessionId: opts.session, message, model: opts.model, thinkingLevel: opts.thinking });
        console.log(result.text);
      }
    } catch (e) {
      err(e.message);
      process.exit(1);
    }
  });

// ── aquaclaw chat (interactive REPL) ─────────────────────────────────────────
program
  .command('chat')
  .description('Interactive chat REPL')
  .option('-s, --session <id>', 'Session ID', 'main')
  .option('--model <model>', 'Model to use')
  .option('--thinking <level>', 'Thinking level', 'medium')
  .action(async (opts) => {
    const { createInterface } = await import('readline');
    const ora = (await import('ora')).default;

    shark(`Chat session: ${opts.session} | Model: ${opts.model ?? 'default'} | /help for commands`);
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    const ask = () => rl.question(chalk.cyan('\nYou: '), async (input) => {
      const text = input.trim();
      if (!text) return ask();
      if (text === '/exit' || text === '/quit') { ok('Goodbye! 🦈'); rl.close(); return; }
      if (text === '/clear') { process.stdout.write('\x1Bc'); return ask(); }

      const spinner = ora({ text: chalk.dim('AquaClaw is thinking...'), color: 'cyan' }).start();
      try {
        const result = await wsCall('agent.send', { sessionId: opts.session, message: text, model: opts.model, thinkingLevel: opts.thinking });
        spinner.stop();
        console.log(chalk.cyan('\n🦈 AquaClaw: ') + result.text);
        if (result.usage) console.log(chalk.dim(`   [${result.usage.input_tokens}↑ ${result.usage.output_tokens}↓ tokens]`));
      } catch (e) {
        spinner.fail(chalk.red(e.message));
      }
      ask();
    });
    ask();
  });

// ── aquaclaw voice ────────────────────────────────────────────────────────────
program
  .command('voice')
  .description('Voice input/output loop')
  .option('--wake-word <word>', 'Custom wake word')
  .action(async (opts) => {
    shark('Voice mode — speak to AquaClaw. Press Ctrl+C to stop.');
    try {
      const result = await wsCall('voice.start', { wakeWord: opts.wakeWord });
      ok(`Voice active: ${JSON.stringify(result)}`);
      await new Promise(() => {}); // keep alive
    } catch (e) {
      err(e.message);
    }
  });

// ── aquaclaw status ───────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show gateway status')
  .action(async () => {
    try {
      const s = await wsCall('gateway.status');
      shark(`AquaClaw v${s.version}`);
      ok(`Uptime: ${Math.round(s.uptime / 60)}m | Sessions: ${s.sessions}`);
      ok(`Memory: ${Math.round(s.memory.rss / 1024 / 1024)}MB`);
      for (const [ch, info] of Object.entries(s.channels ?? {})) {
        const icon = info.connected ? chalk.green('●') : chalk.red('○');
        console.log(`  ${icon} ${ch}: ${info.status}`);
      }
      ok(`Voice: ${s.voice?.listening ? 'listening' : 'idle'}`);
    } catch (e) {
      err(e.message);
      shark('Is the gateway running? Try: aquaclaw gateway');
    }
  });

// ── aquaclaw skills ───────────────────────────────────────────────────────────
const skills = program.command('skills').description('Manage skills');
skills.command('list').action(async () => {
  const list = await wsCall('skills.list');
  shark('Installed skills:');
  for (const s of list) console.log(`  • ${s.name} — ${s.description}`);
});
skills.command('install <name>').action(async (name) => {
  const spinner = (await import('ora')).default(`Installing ${name}...`).start();
  try { await wsCall('skills.install', { name }); spinner.succeed(`Installed: ${name}`); }
  catch (e) { spinner.fail(e.message); }
});
skills.command('search <query>').action(async (query) => {
  const results = await wsCall('skills.search', { query });
  for (const r of results) console.log(`  • ${r.name} — ${r.description}`);
});

// ── aquaclaw sessions ─────────────────────────────────────────────────────────
const sessions = program.command('sessions').description('Manage sessions');
sessions.command('list').action(async () => {
  const list = await wsCall('sessions.list');
  shark(`${list.length} sessions:`);
  for (const s of list) console.log(`  ${s.id} — ${s.messageCount} messages | model: ${s.model ?? 'default'}`);
});
sessions.command('reset <id>').action(async (id) => {
  await wsCall('sessions.reset', { sessionId: id });
  ok(`Session reset: ${id}`);
});

// ── aquaclaw pairing ──────────────────────────────────────────────────────────
const pairing = program.command('pairing').description('Manage DM pairing');
pairing.command('list').action(async () => {
  const list = await wsCall('pairing.list');
  for (const p of list) console.log(`  ${p.channel} ${p.from} — ${p.status}`);
});
pairing.command('approve <channel> <code>').action(async (channel, code) => {
  await wsCall('pairing.approve', { channel, code });
  ok(`Approved: ${channel} ${code}`);
});

// ── aquaclaw doctor ───────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Diagnose configuration and connectivity issues')
  .action(async () => {
    const { runDoctor } = await import('../doctor/index.mjs');
    await runDoctor();
  });

// ── aquaclaw config ───────────────────────────────────────────────────────────
program
  .command('config')
  .description('View or edit configuration')
  .option('--show', 'Print current config')
  .option('--path', 'Print config file path')
  .action(async (opts) => {
    const cfgPath = join(CONFIG_DIR, 'aquaclaw.json');
    if (opts.path) { console.log(cfgPath); return; }
    if (opts.show || !opts.path) {
      if (existsSync(cfgPath)) {
        const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
        const safe = JSON.parse(JSON.stringify(cfg));
        // Redact secrets
        if (safe.models?.anthropicApiKey) safe.models.anthropicApiKey = '***';
        if (safe.models?.openaiApiKey) safe.models.openaiApiKey = '***';
        console.log(JSON.stringify(safe, null, 2));
      } else {
        warn(`No config at ${cfgPath}. Run: aquaclaw onboard`);
      }
    }
  });

// ── aquaclaw update ───────────────────────────────────────────────────────────
program
  .command('update')
  .description('Update AquaClaw to the latest version')
  .option('--channel <channel>', 'Release channel (stable/beta/dev)', 'stable')
  .action(async (opts) => {
    const { execFileAsync } = await import('../utils/exec.mjs');
    const tag = opts.channel === 'stable' ? 'latest' : opts.channel;
    shark(`Updating AquaClaw to @${tag}...`);
    try {
      await execFileAsync('npm', ['install', '-g', `aquaclaw@${tag}`]);
      ok('Updated! Restart the gateway to apply.');
    } catch (e) {
      err(e.message);
    }
  });

// ── aquaclaw channels ─────────────────────────────────────────────────────────
const channels = program.command('channels').description('Manage channel connections');
channels.command('list').action(async () => {
  const list = await wsCall('channels.list');
  for (const ch of list) {
    const icon = ch.connected ? chalk.green('●') : chalk.red('○');
    console.log(`  ${icon} ${ch.name}: ${ch.status}`);
  }
});
channels.command('login <channel>').description('Authenticate a channel').action(async (channel) => {
  shark(`Authenticating ${channel}...`);
  await wsCall('channels.connect', { channel });
  ok(`${channel} connected`);
});

// ── Parse ─────────────────────────────────────────────────────────────────────
program.parse();
