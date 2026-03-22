/**
 * AquaClaw Microsoft Teams Channel
 * Uses Bot Framework adapter.
 */
import { BaseChannel } from './router.mjs';
import { log } from '../utils/log.mjs';

export class MSTeamsChannel extends BaseChannel {
  constructor(cfg, gateway) {
    super(cfg, gateway);
    this.appId = cfg.appId ?? process.env.MSTEAMS_APP_ID;
    this.appPassword = cfg.appPassword ?? process.env.MSTEAMS_APP_PASSWORD;
    this.allowFrom = cfg.allowFrom ?? [];
  }

  async start() {
    if (!this.appId || !this.appPassword) {
      throw new Error('MS Teams requires appId and appPassword. See: https://docs.aquaclaw.ai/channels/msteams');
    }
    // Bot Framework adapter setup would go here
    // For now mark as connected via webhook mode
    this.connected = true;
    this.status = 'webhook-mode';
    log.success('MS Teams channel configured (webhook mode) — set bot endpoint to /webhook/msteams');
  }

  async handleWebhook(body) {
    const from = body.from?.id ?? 'unknown';
    const text = body.text ?? '';
    if (!text) return;

    await this.gateway.channels.onInbound({
      channel: 'msteams',
      from,
      text,
      sessionId: `msteams:${body.conversation?.id ?? from}`,
    });
    return { type: 'message', text: '...' };
  }

  async send({ to, text }) {
    // Would POST to Teams conversation API
    log.warn(`MS Teams send not implemented for ${to}: ${text.slice(0, 50)}`);
  }
}
