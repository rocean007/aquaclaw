/**
 * AquaClaw Channel Router
 *
 * Supported channels:
 *  - Telegram (grammY)
 *  - Discord (discord.js)
 *  - Slack (Bolt)
 *  - WhatsApp (Baileys)
 *  - Matrix (matrix-js-sdk)
 *  - IRC
 *  - WebChat (built-in)
 *  - Signal (signal-cli)
 *  - Microsoft Teams
 *  - Webhook (generic inbound)
 *  - Email (IMAP/SMTP)
 *  - SMS (Twilio)
 *  - RSS (poll + notify)
 *
 * Each channel:
 *  - Authenticates and connects
 *  - Routes inbound messages → agent
 *  - Sends agent responses back
 *  - Handles media (images, audio, files)
 *  - Supports DM pairing security model
 *  - Supports group mention gating
 */

import { log } from '../utils/log.mjs';

export class ChannelRouter {
  constructor(cfg, gateway) {
    this.config = cfg;
    this.gateway = gateway;
    this._channels = new Map();
    this._handlers = {};
  }

  available() {
    return Object.keys(this.config.channels ?? {}).filter(k => this.config.channels[k]?.enabled !== false);
  }

  async list() {
    return [...this._channels.entries()].map(([name, ch]) => ({
      name,
      status: ch.status ?? 'unknown',
      connected: ch.connected ?? false,
    }));
  }

  async status() {
    const result = {};
    for (const [name, ch] of this._channels) {
      result[name] = { connected: ch.connected ?? false, status: ch.status };
    }
    return result;
  }

  async startAll() {
    const channelCfg = this.config.channels ?? {};
    const starts = [];
    for (const [name, cfg] of Object.entries(channelCfg)) {
      if (cfg?.enabled === false) continue;
      starts.push(this.connect(name).catch(e => log.warn(`Channel ${name} failed to start: ${e.message}`)));
    }
    await Promise.allSettled(starts);
  }

  async stopAll() {
    for (const [name, ch] of this._channels) {
      try { await ch.stop?.(); } catch {}
    }
    this._channels.clear();
  }

  async connect(channel) {
    const cfg = this.config.channels?.[channel];
    if (!cfg) throw new Error(`Channel not configured: ${channel}`);

    const handler = await this._loadHandler(channel, cfg);
    await handler.start();
    this._channels.set(channel, handler);
    log.success(`✓ Channel connected: ${channel}`);
    this.gateway.broadcast({ type: 'channel.connected', channel });
    return { ok: true };
  }

  async disconnect(channel) {
    const ch = this._channels.get(channel);
    if (!ch) throw new Error(`Channel not connected: ${channel}`);
    await ch.stop?.();
    this._channels.delete(channel);
    this.gateway.broadcast({ type: 'channel.disconnected', channel });
    return { ok: true };
  }

  async handleWebhook(channel, body, headers) {
    const ch = this._channels.get(channel);
    if (!ch?.handleWebhook) throw new Error(`Channel ${channel} does not support webhooks`);
    return ch.handleWebhook(body, headers);
  }

  async _loadHandler(channel, cfg) {
    const channelMap = {
      telegram: () => import('./telegram.mjs').then(m => new m.TelegramChannel(cfg, this.gateway)),
      discord:  () => import('./discord.mjs').then(m => new m.DiscordChannel(cfg, this.gateway)),
      slack:    () => import('./slack.mjs').then(m => new m.SlackChannel(cfg, this.gateway)),
      whatsapp: () => import('./whatsapp.mjs').then(m => new m.WhatsAppChannel(cfg, this.gateway)),
      matrix:   () => import('./matrix.mjs').then(m => new m.MatrixChannel(cfg, this.gateway)),
      irc:      () => import('./irc.mjs').then(m => new m.IRCChannel(cfg, this.gateway)),
      signal:   () => import('./signal.mjs').then(m => new m.SignalChannel(cfg, this.gateway)),
      msteams:  () => import('./msteams.mjs').then(m => new m.MSTeamsChannel(cfg, this.gateway)),
      sms:      () => import('./sms.mjs').then(m => new m.SMSChannel(cfg, this.gateway)),
      email:    () => import('./email.mjs').then(m => new m.EmailChannel(cfg, this.gateway)),
      rss:      () => import('./rss.mjs').then(m => new m.RSSChannel(cfg, this.gateway)),
      webhook:  () => import('./webhook.mjs').then(m => new m.WebhookChannel(cfg, this.gateway)),
      webchat:  () => import('./webchat.mjs').then(m => new m.WebChatChannel(cfg, this.gateway)),
    };

    const loader = channelMap[channel];
    if (!loader) throw new Error(`Unknown channel: ${channel}. Supported: ${Object.keys(channelMap).join(', ')}`);
    return await loader();
  }

  /** Send a message back to a specific channel/peer */
  async send({ channel, to, text, media, replyTo }) {
    const ch = this._channels.get(channel);
    if (!ch) throw new Error(`Channel not connected: ${channel}`);
    return ch.send({ to, text, media, replyTo });
  }

  /** Called by channel handlers when an inbound message arrives */
  async onInbound({ channel, from, text, media, sessionId, raw }) {
    log.info(`📨 [${channel}] ${from}: ${text?.slice(0, 80) ?? '[media]'}`);

    const session = await this.gateway.sessions.getOrCreate(sessionId ?? `${channel}:${from}`);

    // Check DM pairing policy
    const policy = this.config.channels?.[channel]?.dmPolicy ?? 'pairing';
    if (policy === 'pairing' && !session.approved) {
      const code = session.pairingCode ?? this._generateCode();
      session.pairingCode = code;
      await this.send({ channel, to: from, text: `🦈 AquaClaw pairing code: \`${code}\`\nRun: \`aquaclaw pairing approve ${channel} ${code}\`` });
      return;
    }

    // Notify WS clients
    this.gateway.broadcast({ type: 'message.inbound', channel, from, text, sessionId: session.id });

    // Typing indicator
    await this._sendTyping(channel, from);

    // Run agent
    try {
      const result = await this.gateway.agent.send({
        sessionId: session.id,
        message: text,
        model: session.model ?? this.config.agent?.model,
        thinkingLevel: session.thinkingLevel ?? 'medium',
      });

      await this.send({ channel, to: from, text: result.text, replyTo: raw?.messageId });

      // TTS if voice enabled for this session
      if (session.voiceReply && this.gateway.voice._listening) {
        await this.gateway.voice.tts({ text: result.text });
      }
    } catch (e) {
      log.error(`Agent error for ${session.id}: ${e.message}`);
      await this.send({ channel, to: from, text: `⚠️ Error: ${e.message}` });
    }
  }

  async _sendTyping(channel, to) {
    const ch = this._channels.get(channel);
    try { await ch?.sendTyping?.(to); } catch {}
  }

  _generateCode() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }
}

/**
 * Base class for all channel handlers
 */
export class BaseChannel {
  constructor(cfg, gateway) {
    this.cfg = cfg;
    this.gateway = gateway;
    this.connected = false;
    this.status = 'disconnected';
  }

  async start() { throw new Error('Not implemented'); }
  async stop() { this.connected = false; this.status = 'disconnected'; }
  async send({ to, text }) { throw new Error('Not implemented'); }
  async sendTyping(to) {}

  /** Helper: chunk long messages */
  _chunk(text, maxLen = 4000) {
    if (text.length <= maxLen) return [text];
    const chunks = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + maxLen));
      i += maxLen;
    }
    return chunks;
  }

  /** Parse /commands from message text */
  _parseCommand(text) {
    const match = text.match(/^\/(\w+)\s*(.*)?$/);
    if (!match) return null;
    return { command: match[1].toLowerCase(), args: match[2]?.trim() ?? '' };
  }

  /** Handle built-in /commands */
  async _handleCommand(command, args, sessionId, replyFn) {
    const session = await this.gateway.sessions.getOrCreate(sessionId);
    switch (command) {
      case 'status': {
        const s = await this.gateway._status();
        return replyFn(`🦈 AquaClaw v${s.version} | Sessions: ${s.sessions} | Uptime: ${Math.round(s.uptime/60)}m`);
      }
      case 'new':
      case 'reset':
        await this.gateway.sessions.reset(sessionId);
        return replyFn('✓ Session reset');
      case 'compact':
        await this.gateway.sessions.compact(sessionId);
        return replyFn('✓ Context compacted');
      case 'think':
        session.thinkingLevel = args || 'medium';
        return replyFn(`✓ Thinking level: ${session.thinkingLevel}`);
      case 'model':
        if (args) { session.model = args; return replyFn(`✓ Model: ${args}`); }
        return replyFn(`Current model: ${session.model ?? this.gateway.config.agent?.model ?? 'default'}`);
      case 'voice':
        session.voiceReply = args === 'on';
        return replyFn(`✓ Voice reply: ${session.voiceReply ? 'on' : 'off'}`);
      case 'help':
        return replyFn(`🦈 AquaClaw commands:\n/status /reset /compact /think [level] /model [name] /voice [on|off] /help`);
      default:
        return null;
    }
  }
}
