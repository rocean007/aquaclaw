/**
 * AquaClaw WhatsApp Channel via Baileys
 */
import { BaseChannel } from './router.mjs';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import { log } from '../utils/log.mjs';

export class WhatsAppChannel extends BaseChannel {
  constructor(cfg, gateway) {
    super(cfg, gateway);
    this.allowFrom = cfg.allowFrom ?? [];
    this.groups = cfg.groups ?? null;
    this._authDir = join(homedir(), '.aquaclaw', 'credentials', 'whatsapp');
    mkdirSync(this._authDir, { recursive: true });
  }

  async start() {
    const {
      default: makeWASocket,
      DisconnectReason,
      useMultiFileAuthState,
      fetchLatestBaileysVersion,
    } = await import('@whiskeysockets/baileys');

    const { state, saveCreds } = await useMultiFileAuthState(this._authDir);
    const { version } = await fetchLatestBaileysVersion();

    this._sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      logger: { level: 'silent', child: () => ({ level: 'silent', trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {} }) },
    });

    this._sock.ev.on('creds.update', saveCreds);

    this._sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log('\n📱 Scan this QR code with WhatsApp on your phone:');
      }
      if (connection === 'open') {
        this.connected = true;
        this.status = 'connected';
        log.success('WhatsApp connected');
        this.gateway.broadcast({ type: 'channel.connected', channel: 'whatsapp' });
      }
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        this.connected = false;
        this.status = 'disconnected';
        if (shouldReconnect) {
          log.warn('WhatsApp disconnected — reconnecting...');
          setTimeout(() => this.start(), 5000);
        } else {
          log.warn('WhatsApp logged out. Re-run onboard to re-link.');
        }
      }
    });

    this._sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const text = msg.message?.conversation
          ?? msg.message?.extendedTextMessage?.text
          ?? msg.message?.imageMessage?.caption
          ?? '';

        if (!text) continue;

        // Group gating
        if (isGroup && this.groups !== null) {
          const groupId = from;
          if (!this.groups['*'] && !this.groups[groupId]) continue;
        }

        if (this.allowFrom.length > 0 && !this.allowFrom.includes(from) && !this.allowFrom.includes('*')) continue;

        const sessionId = isGroup ? `whatsapp:group:${from}` : `whatsapp:${from}`;

        const cmd = this._parseCommand(text);
        if (cmd) {
          const handled = await this._handleCommand(cmd.command, cmd.args, sessionId,
            (t) => this._sock.sendMessage(from, { text: t }));
          if (handled !== null) continue;
        }

        await this.gateway.channels.onInbound({ channel: 'whatsapp', from, text, sessionId });
      }
    });
  }

  async stop() {
    this._sock?.end();
    await super.stop();
  }

  async send({ to, text }) {
    if (!this._sock) throw new Error('WhatsApp not connected');
    const chunks = this._chunk(text, 4096);
    for (const chunk of chunks) {
      await this._sock.sendMessage(to, { text: chunk });
    }
  }

  async sendTyping(to) {
    await this._sock?.sendPresenceUpdate('composing', to).catch(() => {});
  }
}
