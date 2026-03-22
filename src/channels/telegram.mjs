/**
 * AquaClaw Telegram Channel
 * Uses grammY for bot handling
 */

import { BaseChannel } from './router.mjs';
import { log } from '../utils/log.mjs';

export class TelegramChannel extends BaseChannel {
  constructor(cfg, gateway) {
    super(cfg, gateway);
    this.botToken = cfg.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
    this.allowFrom = cfg.allowFrom ?? [];
    this.groups = cfg.groups ?? null;
  }

  async start() {
    if (!this.botToken) throw new Error('Telegram botToken not configured (channels.telegram.botToken or TELEGRAM_BOT_TOKEN)');

    const { Bot } = await import('grammy');
    this._bot = new Bot(this.botToken);

    this._bot.on('message', async (ctx) => {
      const msg = ctx.message;
      const from = String(msg.from?.id ?? msg.chat.id);
      const text = msg.text ?? msg.caption ?? '';
      const isGroup = msg.chat.type !== 'private';

      // Group gating
      if (isGroup && this.groups !== null) {
        const chatId = String(msg.chat.id);
        if (!this.groups['*'] && !this.groups[chatId]) return;
        const groupCfg = this.groups[chatId] ?? this.groups['*'];
        if (groupCfg?.requireMention && !text.includes(`@${ctx.me.username}`)) return;
      }

      // Allowlist
      if (this.allowFrom.length > 0 && !this.allowFrom.includes(from) && !this.allowFrom.includes('*')) return;

      const sessionId = isGroup ? `telegram:group:${msg.chat.id}` : `telegram:${from}`;

      // Handle commands
      const cmd = this._parseCommand(text);
      if (cmd) {
        const handled = await this._handleCommand(cmd.command, cmd.args, sessionId, (t) => ctx.reply(t));
        if (handled !== null) return;
      }

      // Handle media (photos, audio, documents)
      let processText = text;
      if (msg.photo || msg.audio || msg.voice || msg.document) {
        processText = await this._processMedia(ctx, msg, text);
      }

      await this.gateway.channels.onInbound({
        channel: 'telegram',
        from,
        text: processText,
        sessionId,
        raw: { messageId: msg.message_id, chatId: msg.chat.id },
      });
    });

    this._bot.start({ onStart: () => {
      this.connected = true;
      this.status = 'connected';
      log.success('Telegram connected');
    }});
  }

  async stop() {
    await this._bot?.stop();
    await super.stop();
  }

  async send({ to, text, replyTo }) {
    if (!this._bot) throw new Error('Telegram not connected');
    const chunks = this._chunk(text, 4096);
    for (const chunk of chunks) {
      await this._bot.api.sendMessage(to, chunk, {
        parse_mode: 'Markdown',
        reply_to_message_id: replyTo,
      }).catch(() =>
        this._bot.api.sendMessage(to, chunk, { reply_to_message_id: replyTo })
      );
    }
  }

  async sendTyping(to) {
    await this._bot?.api.sendChatAction(to, 'typing').catch(() => {});
  }

  async _processMedia(ctx, msg, caption) {
    const parts = [caption].filter(Boolean);

    if (msg.photo) {
      const photo = msg.photo[msg.photo.length - 1];
      const file = await ctx.getFile();
      parts.push(`[Image attached: ${file.file_path}]`);
      // Could download and pass to vision model here
    }
    if (msg.voice || msg.audio) {
      parts.push('[Voice/Audio message — transcribing...]');
      // Could download and transcribe with Whisper
    }

    return parts.join('\n');
  }
}
