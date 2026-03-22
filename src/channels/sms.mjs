/**
 * AquaClaw SMS Channel via Twilio
 */
import { BaseChannel } from './router.mjs';
import { log } from '../utils/log.mjs';

export class SMSChannel extends BaseChannel {
  constructor(cfg, gateway) {
    super(cfg, gateway);
    this.accountSid = cfg.accountSid ?? process.env.TWILIO_ACCOUNT_SID;
    this.authToken = cfg.authToken ?? process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = cfg.fromNumber ?? process.env.TWILIO_FROM_NUMBER;
    this.allowFrom = cfg.allowFrom ?? [];
  }

  async start() {
    if (!this.accountSid || !this.authToken) {
      throw new Error('SMS requires Twilio accountSid and authToken');
    }
    this.connected = true;
    this.status = 'webhook-mode';
    log.success('SMS channel active (webhook mode) — set Twilio webhook to /webhook/sms');
  }

  async handleWebhook(body) {
    const from = body.From ?? 'unknown';
    const text = body.Body ?? '';
    if (!text) return;

    if (this.allowFrom.length > 0 && !this.allowFrom.includes(from) && !this.allowFrom.includes('*')) return;

    await this.gateway.channels.onInbound({
      channel: 'sms',
      from,
      text,
      sessionId: `sms:${from}`,
    });

    return { ok: true };
  }

  async send({ to, text }) {
    const chunks = this._chunk(text, 1600);
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    for (const chunk of chunks) {
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: this.fromNumber, To: to, Body: chunk }),
      });
    }
  }
}
