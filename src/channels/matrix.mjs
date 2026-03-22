/**
 * AquaClaw Matrix Channel
 */
import { BaseChannel } from './router.mjs';
import { log } from '../utils/log.mjs';

export class MatrixChannel extends BaseChannel {
  constructor(cfg, gateway) {
    super(cfg, gateway);
    this.homeserver = cfg.homeserver;
    this.userId = cfg.userId;
    this.accessToken = cfg.accessToken;
    this.allowFrom = cfg.allowFrom ?? [];
  }

  async start() {
    if (!this.homeserver || !this.accessToken) {
      throw new Error('Matrix requires homeserver and accessToken');
    }

    const sdk = await import('matrix-js-sdk');
    this._client = sdk.createClient({
      baseUrl: this.homeserver,
      accessToken: this.accessToken,
      userId: this.userId,
    });

    this._client.on('Room.timeline', async (event, room) => {
      if (event.getType() !== 'm.room.message') return;
      if (event.getSender() === this.userId) return;

      const from = event.getSender();
      const text = event.getContent().body ?? '';
      if (!text) return;

      if (this.allowFrom.length > 0 && !this.allowFrom.includes(from) && !this.allowFrom.includes('*')) return;

      const sessionId = `matrix:${room.roomId}:${from}`;

      await this.gateway.channels.onInbound({
        channel: 'matrix',
        from,
        text,
        sessionId,
        raw: { roomId: room.roomId, eventId: event.getId() },
      });
    });

    await this._client.startClient({ initialSyncLimit: 0 });
    this.connected = true;
    this.status = 'connected';
    log.success(`Matrix connected as ${this.userId}`);
  }

  async stop() {
    this._client?.stopClient();
    await super.stop();
  }

  async send({ to, text }) {
    const chunks = this._chunk(text, 4000);
    for (const chunk of chunks) {
      await this._client.sendTextMessage(to, chunk);
    }
  }
}
