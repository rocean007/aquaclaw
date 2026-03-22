import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { log } from '../utils/log.mjs';

const SESSIONS_DIR = join(homedir(), '.aquaclaw', 'sessions');

export class SessionManager {
  constructor(config) {
    this.config = config;
    this._sessions = new Map();
    mkdirSync(SESSIONS_DIR, { recursive: true });
    this._loadPersisted();
  }

  count() { return this._sessions.size; }

  async list() {
    return [...this._sessions.values()].map(s => ({
      id: s.id,
      messageCount: s.messages.length,
      model: s.model,
      thinkingLevel: s.thinkingLevel,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  async get(sessionId) {
    const s = this._sessions.get(sessionId);
    if (!s) throw new Error(`Session not found: ${sessionId}`);
    return { id: s.id, messageCount: s.messages.length, model: s.model };
  }

  async getOrCreate(sessionId) {
    if (!this._sessions.has(sessionId)) {
      await this.create({ sessionId });
    }
    return this._sessions.get(sessionId);
  }

  async create(params = {}) {
    const id = params.sessionId ?? `session-${Date.now()}`;
    const session = {
      id,
      messages: [],
      model: params.model ?? null,
      thinkingLevel: params.thinkingLevel ?? 'medium',
      persona: params.persona ?? null,
      approved: params.approved ?? (id === 'main' || id === 'webchat'),
      voiceReply: false,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._sessions.set(id, session);
    return session;
  }

  async patch(sessionId, patch) {
    const s = await this.getOrCreate(sessionId);
    Object.assign(s, patch, { updatedAt: new Date().toISOString() });
    this._persist(s);
    return s;
  }

  async delete(sessionId) {
    this._sessions.delete(sessionId);
    return { deleted: true };
  }

  async reset(sessionId) {
    const s = this._sessions.get(sessionId);
    if (s) {
      s.messages = [];
      s.updatedAt = new Date().toISOString();
      this._persist(s);
    }
    return { reset: true };
  }

  async compact(sessionId) {
    const s = this._sessions.get(sessionId);
    if (!s || s.messages.length < 4) return { compacted: false };
    // Summarize old messages (keep last 4)
    const kept = s.messages.slice(-4);
    const summary = `[Previous conversation context: ${s.messages.length - 4} messages summarized]`;
    s.messages = [{ role: 'user', content: summary }, ...kept];
    s.updatedAt = new Date().toISOString();
    this._persist(s);
    return { compacted: true, keptMessages: s.messages.length };
  }

  async history(sessionId, opts = {}) {
    const s = this._sessions.get(sessionId);
    if (!s) return [];
    const limit = opts.limit ?? 50;
    return s.messages.slice(-limit);
  }

  async send(params) {
    // Send a message to another session (agent-to-agent)
    const { fromSession, toSession, message, replyBack } = params;
    const target = await this.getOrCreate(toSession);
    target.messages.push({ role: 'user', content: `[From session ${fromSession}]: ${message}` });
    return { queued: true, toSession };
  }

  async trackUsage(sessionId, usage) {
    const s = this._sessions.get(sessionId);
    if (!s) return;
    s.totalInputTokens += usage?.input_tokens ?? 0;
    s.totalOutputTokens += usage?.output_tokens ?? 0;
    s.updatedAt = new Date().toISOString();
  }

  async pairingList() {
    return [...this._sessions.values()]
      .filter(s => s.pairingCode && !s.approved)
      .map(s => ({ channel: s.id.split(':')[0], from: s.id.split(':')[1], code: s.pairingCode, status: 'pending' }));
  }

  async pairingApprove({ channel, code }) {
    for (const s of this._sessions.values()) {
      if (s.pairingCode === code) {
        s.approved = true;
        delete s.pairingCode;
        this._persist(s);
        return { approved: true, sessionId: s.id };
      }
    }
    throw new Error(`No pending pairing for code: ${code}`);
  }

  async pairingDeny({ channel, code }) {
    for (const s of this._sessions.values()) {
      if (s.pairingCode === code) {
        this._sessions.delete(s.id);
        return { denied: true };
      }
    }
    throw new Error(`No pending pairing for code: ${code}`);
  }

  _persist(session) {
    try {
      const path = join(SESSIONS_DIR, `${session.id.replace(/[:/]/g, '_')}.json`);
      writeFileSync(path, JSON.stringify(session, null, 2));
    } catch {}
  }

  _loadPersisted() {
    if (!existsSync(SESSIONS_DIR)) return;
    try {
      const { readdirSync } = require('fs');
      for (const file of readdirSync(SESSIONS_DIR)) {
        if (!file.endsWith('.json')) continue;
        try {
          const s = JSON.parse(readFileSync(join(SESSIONS_DIR, file), 'utf8'));
          this._sessions.set(s.id, s);
        } catch {}
      }
    } catch {}
  }
}
