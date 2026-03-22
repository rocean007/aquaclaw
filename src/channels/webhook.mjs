/**
 * AquaClaw Webhook Channel
 * Accepts inbound HTTP POST requests and routes them to the agent.
 */
import { BaseChannel } from './router.mjs';
import { log } from '../utils/log.mjs';

export class WebhookChannel extends BaseChannel {
  constructor(cfg, gateway) {
    super(cfg, gateway);
    this.path = cfg.path ?? '/webhook/inbound';
    this.secret = cfg.secret ?? null;
    this.sessionId = cfg.sessionId ?? 'webhook';
  }

  async start() {
    this.connected = true;
    this.status = 'connected';
    log.success(`Webhook channel active — POST ${this.path}`);
  }

  async handleWebhook(body, headers) {
    // Verify secret if configured
    if (this.secret) {
      const sig = headers['x-aquaclaw-signature'] ?? headers['x-hub-signature-256'];
      if (!sig || !sig.includes(this.secret)) {
        throw new Error('Webhook signature mismatch');
      }
    }

    const text = body.text ?? body.message ?? body.content ?? JSON.stringify(body);
    const from = body.from ?? body.user ?? 'webhook';

    await this.gateway.channels.onInbound({
      channel: 'webhook',
      from,
      text,
      sessionId: body.sessionId ?? this.sessionId,
    });

    return { ok: true };
  }

  async send({ to, text }) {
    // For webhooks, we can optionally POST to a callback URL
    if (this.cfg?.callbackUrl) {
      await fetch(this.cfg.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, to, timestamp: new Date().toISOString() }),
      }).catch(() => {});
    }
    this.gateway.broadcast({ type: 'message.outbound', channel: 'webhook', text });
  }
}
