/**
 * AquaClaw WebChat Channel
 * Built into the gateway — no external auth needed.
 * Accessible at http://localhost:18790
 */
import { BaseChannel } from './router.mjs';
import { log } from '../utils/log.mjs';

export class WebChatChannel extends BaseChannel {
  constructor(cfg, gateway) {
    super(cfg, gateway);
  }

  async start() {
    this.connected = true;
    this.status = 'connected';
    log.success('WebChat channel active — http://localhost:18790');
  }

  async send({ to, text }) {
    // Broadcast to all WS clients watching this session
    this.gateway.broadcast({ type: 'message.outbound', channel: 'webchat', sessionId: to, text });
  }
}
