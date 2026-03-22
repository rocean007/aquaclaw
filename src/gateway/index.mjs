/**
 * AquaClaw Gateway — Local-first AI agent control plane
 * The Gateway is the heart of AquaClaw. It:
 *  - Runs as a local daemon (launchd/systemd)
 *  - Manages all channel connections (Telegram, Discord, Slack, WhatsApp, etc.)
 *  - Routes messages to the agent loop
 *  - Serves the Web UI + WebChat
 *  - Handles voice wake / Talk mode
 *  - Manages sessions, tools, skills, and cron
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import express from 'express';
import { config } from './config.mjs';
import { SessionManager } from './sessions.mjs';
import { ChannelRouter } from '../channels/router.mjs';
import { AgentRunner } from '../agent/runner.mjs';
import { SkillRegistry } from '../skills/registry.mjs';
import { ToolRegistry } from '../tools/registry.mjs';
import { VoiceManager } from '../voice/manager.mjs';
import { CronManager } from './cron.mjs';
import { setupWebUI } from '../ui/server.mjs';
import { log } from '../utils/log.mjs';
import { AQUACLAW_VERSION, GATEWAY_WS_PATH } from '../constants.mjs';

export class Gateway {
  constructor(opts = {}) {
    this.port = opts.port ?? config.gateway?.port ?? 18790;
    this.bind = opts.bind ?? config.gateway?.bind ?? 'loopback';
    this.verbose = opts.verbose ?? false;

    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: GATEWAY_WS_PATH });

    this.sessions = new SessionManager(config);
    this.skills = new SkillRegistry(config);
    this.tools = new ToolRegistry(config);
    this.channels = new ChannelRouter(config, this);
    this.agent = new AgentRunner(config, this);
    this.voice = new VoiceManager(config, this);
    this.cron = new CronManager(config, this);

    this._clients = new Set();
    this._setupWS();
    this._setupRoutes();
  }

  /** Wire up the WebSocket control plane */
  _setupWS() {
    this.wss.on('connection', (ws, req) => {
      const clientId = crypto.randomUUID();
      this._clients.add({ id: clientId, ws, type: 'unknown' });
      log.info(`WS client connected: ${clientId} from ${req.socket.remoteAddress}`);

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          await this._handleWSMessage(clientId, ws, msg);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', error: e.message }));
        }
      });

      ws.on('close', () => {
        this._clients.delete([...this._clients].find(c => c.id === clientId));
        log.info(`WS client disconnected: ${clientId}`);
      });

      // Send hello
      ws.send(JSON.stringify({
        type: 'hello',
        version: AQUACLAW_VERSION,
        sessionCount: this.sessions.count(),
        capabilities: this._capabilities(),
      }));
    });
  }

  async _handleWSMessage(clientId, ws, msg) {
    const { method, id, params } = msg;
    const reply = (result) => ws.send(JSON.stringify({ id, result }));
    const error = (e) => ws.send(JSON.stringify({ id, error: String(e) }));

    try {
      switch (method) {
        // Session management
        case 'sessions.list':      return reply(await this.sessions.list());
        case 'sessions.get':       return reply(await this.sessions.get(params.sessionId));
        case 'sessions.create':    return reply(await this.sessions.create(params));
        case 'sessions.patch':     return reply(await this.sessions.patch(params.sessionId, params.patch));
        case 'sessions.delete':    return reply(await this.sessions.delete(params.sessionId));
        case 'sessions.reset':     return reply(await this.sessions.reset(params.sessionId));
        case 'sessions.compact':   return reply(await this.sessions.compact(params.sessionId));
        case 'sessions.history':   return reply(await this.sessions.history(params.sessionId, params.opts));
        case 'sessions.send':      return reply(await this.sessions.send(params));

        // Agent
        case 'agent.send':         return reply(await this.agent.send(params));
        case 'agent.stream':       return this.agent.stream(params, ws);
        case 'agent.stop':         return reply(await this.agent.stop(params.sessionId));

        // Skills
        case 'skills.list':        return reply(await this.skills.list());
        case 'skills.install':     return reply(await this.skills.install(params.name));
        case 'skills.uninstall':   return reply(await this.skills.uninstall(params.name));
        case 'skills.search':      return reply(await this.skills.search(params.query));

        // Tools
        case 'tools.list':         return reply(await this.tools.list());
        case 'tools.invoke':       return reply(await this.tools.invoke(params));

        // Channels
        case 'channels.list':      return reply(await this.channels.list());
        case 'channels.status':    return reply(await this.channels.status());
        case 'channels.connect':   return reply(await this.channels.connect(params.channel));
        case 'channels.disconnect':return reply(await this.channels.disconnect(params.channel));

        // Voice
        case 'voice.start':        return reply(await this.voice.start(params));
        case 'voice.stop':         return reply(await this.voice.stop());
        case 'voice.tts':          return reply(await this.voice.tts(params));
        case 'voice.status':       return reply(await this.voice.status());

        // Cron
        case 'cron.list':          return reply(await this.cron.list());
        case 'cron.add':           return reply(await this.cron.add(params));
        case 'cron.remove':        return reply(await this.cron.remove(params.id));

        // Gateway
        case 'gateway.status':     return reply(this._status());
        case 'gateway.restart':    return this._restart();
        case 'gateway.version':    return reply({ version: AQUACLAW_VERSION });

        // Pairing
        case 'pairing.list':       return reply(await this.sessions.pairingList());
        case 'pairing.approve':    return reply(await this.sessions.pairingApprove(params));
        case 'pairing.deny':       return reply(await this.sessions.pairingDeny(params));

        default:
          error(`Unknown method: ${method}`);
      }
    } catch (e) {
      error(e.message);
    }
  }

  _setupRoutes() {
    this.app.use(express.json({ limit: '50mb' }));

    // Health check
    this.app.get('/health', (_, res) => res.json({
      status: 'ok',
      version: AQUACLAW_VERSION,
      uptime: process.uptime(),
    }));

    // Webhook endpoints for channels
    this.app.post('/webhook/:channel', async (req, res) => {
      try {
        await this.channels.handleWebhook(req.params.channel, req.body, req.headers);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // REST API (mirrors WS methods for HTTP access)
    this.app.post('/api/:method', async (req, res) => {
      const method = req.params.method.replace('-', '.');
      try {
        const result = await this._dispatchREST(method, req.body);
        res.json({ ok: true, result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    // Serve Web UI
    setupWebUI(this.app, this);
  }

  async _dispatchREST(method, params) {
    // Reuse WS handler logic via a fake reply
    return new Promise((resolve, reject) => {
      const fakeWS = { send: (raw) => {
        const msg = JSON.parse(raw);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.result);
      }};
      this._handleWSMessage('rest', fakeWS, { method, id: 'rest', params })
        .catch(reject);
    });
  }

  _capabilities() {
    return {
      voice: this.voice.available(),
      channels: this.channels.available(),
      tools: this.tools.available(),
      skills: this.skills.list(),
    };
  }

  _status() {
    return {
      version: AQUACLAW_VERSION,
      uptime: process.uptime(),
      sessions: this.sessions.count(),
      channels: this.channels.status(),
      voice: this.voice.status(),
      memory: process.memoryUsage(),
    };
  }

  /** Broadcast an event to all connected WS clients */
  broadcast(event) {
    const raw = JSON.stringify(event);
    for (const client of this._clients) {
      if (client.ws.readyState === 1) {
        client.ws.send(raw);
      }
    }
  }

  async start() {
    const host = this.bind === 'loopback' ? '127.0.0.1' : '0.0.0.0';

    // Load skills & tools
    await this.skills.load();
    await this.tools.load();

    // Start channels
    await this.channels.startAll();

    // Start voice if configured
    if (config.voice?.enabled) await this.voice.start();

    // Start cron
    await this.cron.start();

    return new Promise((resolve) => {
      this.server.listen(this.port, host, () => {
        log.success(`🦈 AquaClaw Gateway v${AQUACLAW_VERSION} running on ws://${host}:${this.port}`);
        log.info(`   Web UI: http://${host}:${this.port}`);
        log.info(`   Health: http://${host}:${this.port}/health`);
        resolve(this);
      });
    });
  }

  async stop() {
    await this.channels.stopAll();
    await this.voice.stop();
    this.cron.stop();
    this.server.close();
    log.info('Gateway stopped.');
  }

  _restart() {
    log.info('Restarting gateway...');
    setTimeout(() => process.exit(0), 500);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const { parseArgs } = await import('node:util');
  const { values } = parseArgs({
    options: {
      port: { type: 'string' },
      verbose: { type: 'boolean', short: 'v' },
      bind: { type: 'string' },
    }
  });

  const gw = new Gateway({
    port: values.port ? parseInt(values.port) : undefined,
    verbose: values.verbose,
    bind: values.bind,
  });

  process.on('SIGINT', () => gw.stop().then(() => process.exit(0)));
  process.on('SIGTERM', () => gw.stop().then(() => process.exit(0)));

  await gw.start();
}
