/**
 * AquaClaw Discord Channel
 */
import { BaseChannel } from './router.mjs';
import { log } from '../utils/log.mjs';

export class DiscordChannel extends BaseChannel {
  constructor(cfg, gateway) {
    super(cfg, gateway);
    this.token = cfg.token ?? process.env.DISCORD_BOT_TOKEN;
    this.allowFrom = cfg.allowFrom ?? [];
    this.guilds = cfg.guilds ?? null;
    this.dmPolicy = cfg.dmPolicy ?? 'pairing';
  }

  async start() {
    if (!this.token) throw new Error('Discord token not configured (channels.discord.token or DISCORD_BOT_TOKEN)');

    const { Client, GatewayIntentBits, Partials } = await import('discord.js');
    this._client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this._client.on('ready', () => {
      this.connected = true;
      this.status = 'connected';
      log.success(`Discord connected as ${this._client.user?.tag}`);
    });

    this._client.on('messageCreate', async (msg) => {
      if (msg.author.bot) return;

      const isDM = !msg.guild;
      const from = msg.author.id;
      const text = msg.content;

      // Guild allowlist
      if (msg.guild && this.guilds && !this.guilds.includes(msg.guild.id) && !this.guilds.includes('*')) return;

      // In guild: require mention
      if (msg.guild && !isDM) {
        if (!msg.mentions.has(this._client.user)) return;
      }

      const sessionId = isDM ? `discord:dm:${from}` : `discord:guild:${msg.guild.id}:${from}`;

      const cmd = this._parseCommand(text.replace(/<@\d+>/g, '').trim());
      if (cmd) {
        const handled = await this._handleCommand(cmd.command, cmd.args, sessionId, (t) => msg.reply(t));
        if (handled !== null) return;
      }

      await msg.channel.sendTyping().catch(() => {});

      await this.gateway.channels.onInbound({
        channel: 'discord',
        from,
        text: text.replace(/<@\d+>/g, '').trim(),
        sessionId,
        raw: { messageId: msg.id, channelId: msg.channel.id },
      });
    });

    await this._client.login(this.token);
  }

  async stop() {
    this._client?.destroy();
    await super.stop();
  }

  async send({ to, text }) {
    const channel = await this._client?.channels.fetch(to).catch(() => null)
      ?? await this._client?.users.fetch(to).then(u => u.createDM()).catch(() => null);
    if (!channel) throw new Error(`Discord: cannot find channel/user ${to}`);
    const chunks = this._chunk(text, 2000);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  }
}
