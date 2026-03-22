/**
 * AquaClaw Email Channel
 * Polls IMAP for new emails and sends via SMTP/nodemailer.
 */
import { BaseChannel } from './router.mjs';
import { log } from '../utils/log.mjs';

export class EmailChannel extends BaseChannel {
  constructor(cfg, gateway) {
    super(cfg, gateway);
    this.imapHost = cfg.imapHost ?? 'imap.gmail.com';
    this.smtpHost = cfg.smtpHost ?? 'smtp.gmail.com';
    this.user = cfg.user;
    this.password = cfg.password;
    this.pollInterval = cfg.pollInterval ?? 60000; // 1 min
    this._lastUid = 0;
    this._pollTimer = null;
  }

  async start() {
    if (!this.user || !this.password) throw new Error('Email requires user and password');
    this.connected = true;
    this.status = 'connected';
    log.success(`Email channel active — polling ${this.user} every ${this.pollInterval / 1000}s`);
    this._pollTimer = setInterval(() => this._poll(), this.pollInterval);
    await this._poll(); // immediate first poll
  }

  async stop() {
    clearInterval(this._pollTimer);
    await super.stop();
  }

  async _poll() {
    try {
      const { ImapFlow } = await import('imapflow');
      const client = new ImapFlow({
        host: this.imapHost, port: 993, secure: true,
        auth: { user: this.user, pass: this.password },
        logger: false,
      });

      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        for await (const msg of client.fetch({ since: new Date(Date.now() - this.pollInterval * 2) }, { envelope: true, bodyStructure: true, source: true })) {
          if (msg.uid <= this._lastUid) continue;
          this._lastUid = msg.uid;

          const from = msg.envelope.from?.[0]?.address ?? 'unknown';
          const subject = msg.envelope.subject ?? '(no subject)';
          const text = `Subject: ${subject}\n\n${msg.source?.toString().slice(0, 2000) ?? ''}`;

          await this.gateway.channels.onInbound({
            channel: 'email',
            from,
            text,
            sessionId: `email:${from}`,
          });
        }
      } finally {
        lock.release();
        await client.logout();
      }
    } catch (e) {
      log.warn(`Email poll error: ${e.message}`);
    }
  }

  async send({ to, text }) {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: this.smtpHost, port: 587, secure: false,
      auth: { user: this.user, pass: this.password },
    });

    await transport.sendMail({
      from: this.user, to,
      subject: 'AquaClaw',
      text,
    });
  }
}
