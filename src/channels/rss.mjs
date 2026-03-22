/**
 * AquaClaw RSS Channel
 * Polls RSS/Atom feeds and forwards new items to the agent.
 */
import { BaseChannel } from './router.mjs';
import { log } from '../utils/log.mjs';

export class RSSChannel extends BaseChannel {
  constructor(cfg, gateway) {
    super(cfg, gateway);
    this.feeds = cfg.feeds ?? [];
    this.pollInterval = cfg.pollInterval ?? 300000; // 5 min
    this._seen = new Set();
    this._pollTimer = null;
  }

  async start() {
    if (this.feeds.length === 0) throw new Error('RSS requires at least one feed URL in channels.rss.feeds');
    this.connected = true;
    this.status = 'connected';
    log.success(`RSS channel active — ${this.feeds.length} feed(s), polling every ${this.pollInterval / 1000}s`);
    this._pollTimer = setInterval(() => this._pollAll(), this.pollInterval);
    await this._pollAll();
  }

  async stop() {
    clearInterval(this._pollTimer);
    await super.stop();
  }

  async _pollAll() {
    for (const feedCfg of this.feeds) {
      const url = typeof feedCfg === 'string' ? feedCfg : feedCfg.url;
      const sessionId = (typeof feedCfg === 'object' ? feedCfg.sessionId : null) ?? 'rss:main';
      await this._pollFeed(url, sessionId).catch(e => log.warn(`RSS poll error (${url}): ${e.message}`));
    }
  }

  async _pollFeed(url, sessionId) {
    const res = await fetch(url, { headers: { 'User-Agent': 'AquaClaw/1.0 RSS Reader' } });
    const xml = await res.text();

    // Simple XML item extraction (no deps)
    const items = [];
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = (/<title[^>]*>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      const link = (/<link[^>]*>([\s\S]*?)<\/link>/.exec(block)?.[1] ?? '').trim();
      const guid = (/<guid[^>]*>([\s\S]*?)<\/guid>/.exec(block)?.[1] ?? link).trim();
      if (guid && !this._seen.has(guid)) {
        this._seen.add(guid);
        items.push({ title, link, guid });
      }
    }

    for (const item of items.slice(0, 5)) {
      log.info(`[rss] New item: ${item.title}`);
      await this.gateway.channels.onInbound({
        channel: 'rss',
        from: url,
        text: `New RSS item from ${url}:\nTitle: ${item.title}\nLink: ${item.link}\n\nPlease summarize or take action on this if relevant.`,
        sessionId,
      });
    }
  }

  async send() {} // RSS is read-only
}
