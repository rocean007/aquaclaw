/**
 * AquaClaw Slack Channel
 */
import { BaseChannel } from './router.mjs';
import { log } from '../utils/log.mjs';

export class SlackChannel extends BaseChannel {
  constructor(cfg, gateway) {
    super(cfg, gateway);
    this.botToken = cfg.botToken ?? process.env.SLACK_BOT_TOKEN;
    this.appToken = cfg.appToken ?? process.env.SLACK_APP_TOKEN;
    this.allowFrom = cfg.allowFrom ?? [];
    this.dmPolicy = cfg.dmPolicy ?? 'pairing';
  }

  async start() {
    if (!this.botToken) throw new Error('Slack botToken not configured');
    if (!this.appToken) throw new Error('Slack appToken not configured (xapp-... socket mode token)');

    const { App } = await import('@slack/bolt');
    this._app = new App({
      token: this.botToken,
      appToken: this.appToken,
      socketMode: true,
    });

    this._app.message(async ({ message, say }) => {
      if (message.subtype) return; // skip bot messages, edits, etc.
      const from = message.user;
      const text = message.text ?? '';
      const isDM = message.channel_type === 'im';

      if (this.allowFrom.length > 0 && !this.allowFrom.includes(from) && !this.allowFrom.includes('*')) return;

      const sessionId = isDM ? `slack:dm:${from}` : `slack:channel:${message.channel}:${from}`;

      const cmd = this._parseCommand(text);
      if (cmd) {
        const handled = await this._handleCommand(cmd.command, cmd.args, sessionId, (t) => say(t));
        if (handled !== null) return;
      }

      await this.gateway.channels.onInbound({
        channel: 'slack',
        from,
        text,
        sessionId,
        raw: { channelId: message.channel, ts: message.ts },
      });
    });

    await this._app.start();
    this.connected = true;
    this.status = 'connected';
    log.success('Slack connected (socket mode)');
  }

  async stop() {
    await this._app?.stop();
    await super.stop();
  }

  async send({ to, text }) {
    if (!this._app) throw new Error('Slack not connected');
    const chunks = this._chunk(text, 3000);
    for (const chunk of chunks) {
      await this._app.client.chat.postMessage({ channel: to, text: chunk });
    }
  }

  async sendTyping(to) {
    // Slack doesn't have a typing indicator via Web API in socket mode
  }
}
