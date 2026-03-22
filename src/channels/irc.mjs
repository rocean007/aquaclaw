/**
 * AquaClaw IRC Channel
 */
import { BaseChannel } from './router.mjs';
import { log } from '../utils/log.mjs';

export class IRCChannel extends BaseChannel {
  constructor(cfg, gateway) {
    super(cfg, gateway);
    this.server = cfg.server ?? 'irc.libera.chat';
    this.port = cfg.port ?? 6697;
    this.nick = cfg.nick ?? 'AquaClaw';
    this.channels = cfg.channels ?? [];
    this.allowFrom = cfg.allowFrom ?? [];
    this.password = cfg.password ?? null;
    this.tls = cfg.tls ?? true;
  }

  async start() {
    const { default: irc } = await import('irc-framework');
    this._client = new irc.Client();

    this._client.connect({
      host: this.server,
      port: this.port,
      nick: this.nick,
      tls: this.tls,
      password: this.password,
    });

    this._client.on('registered', () => {
      this.connected = true;
      this.status = 'connected';
      log.success(`IRC connected to ${this.server} as ${this.nick}`);
      for (const ch of this.channels) {
        this._client.join(ch);
      }
    });

    this._client.on('privmsg', async ({ nick, target, message }) => {
      const isChannel = target.startsWith('#');
      if (isChannel && !message.includes(this.nick)) return; // require mention in channels

      if (this.allowFrom.length > 0 && !this.allowFrom.includes(nick) && !this.allowFrom.includes('*')) return;

      const sessionId = isChannel ? `irc:${target}:${nick}` : `irc:${nick}`;
      const replyTo = isChannel ? target : nick;
      this._replyTargets = this._replyTargets ?? new Map();
      this._replyTargets.set(sessionId, replyTo);

      const text = message.replace(new RegExp(`${this.nick}[,:]?\\s*`, 'i'), '').trim();

      await this.gateway.channels.onInbound({ channel: 'irc', from: nick, text, sessionId });
    });
  }

  async stop() {
    this._client?.quit('AquaClaw shutting down');
    await super.stop();
  }

  async send({ to, text }) {
    const replyTo = this._replyTargets?.get(to) ?? to;
    const chunks = this._chunk(text, 400);
    for (const chunk of chunks) {
      this._client.say(replyTo, chunk);
    }
  }
}
