/**
 * AquaClaw Signal Channel (via signal-cli)
 * Requires signal-cli installed and registered: https://github.com/AsamK/signal-cli
 */
import { BaseChannel } from './router.mjs';
import { spawn } from 'child_process';
import { log } from '../utils/log.mjs';

export class SignalChannel extends BaseChannel {
  constructor(cfg, gateway) {
    super(cfg, gateway);
    this.phoneNumber = cfg.phoneNumber;
    this.signalCli = cfg.signalCliBin ?? 'signal-cli';
    this.allowFrom = cfg.allowFrom ?? [];
    this._proc = null;
  }

  async start() {
    if (!this.phoneNumber) throw new Error('Signal requires phoneNumber');

    this._proc = spawn(this.signalCli, ['-u', this.phoneNumber, 'daemon', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    this._proc.stdout.on('data', async (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          await this._handleLine(JSON.parse(line));
        } catch {}
      }
    });

    this._proc.on('spawn', () => {
      this.connected = true;
      this.status = 'connected';
      log.success(`Signal connected as ${this.phoneNumber}`);
    });

    this._proc.on('close', (code) => {
      this.connected = false;
      this.status = 'disconnected';
      if (code !== 0) {
        log.warn(`Signal process exited (${code}) — retrying in 10s`);
        setTimeout(() => this.start(), 10000);
      }
    });
  }

  async _handleLine(msg) {
    const envelope = msg?.envelope;
    if (!envelope?.dataMessage) return;
    const from = envelope.source;
    const text = envelope.dataMessage.message ?? '';
    if (!text) return;
    if (this.allowFrom.length > 0 && !this.allowFrom.includes(from) && !this.allowFrom.includes('*')) return;
    await this.gateway.channels.onInbound({ channel: 'signal', from, text, sessionId: `signal:${from}` });
  }

  async stop() {
    this._proc?.kill();
    await super.stop();
  }

  async send({ to, text }) {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const chunks = this._chunk(text, 4000);
    for (const chunk of chunks) {
      await execFileAsync(this.signalCli, ['-u', this.phoneNumber, 'send', '-m', chunk, to]);
    }
  }
}
