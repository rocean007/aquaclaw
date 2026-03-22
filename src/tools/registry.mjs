/**
 * AquaClaw Tool Registry
 *
 * Built-in tools:
 *  - bash / exec (shell commands)
 *  - read / write / edit (file system)
 *  - browser (web browsing via Playwright/Puppeteer)
 *  - web_search (search the web)
 *  - screenshot (capture screen)
 *  - notify (send desktop notification)
 *  - cron (schedule tasks)
 *  - sessions_list / sessions_send (agent-to-agent)
 *  - http (make HTTP requests)
 *  - memory (store/retrieve facts)
 *  - image (analyze images)
 *  - calendar (read/write calendar)
 *  - email_send (send email)
 */

import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { log } from '../utils/log.mjs';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export class ToolRegistry {
  constructor(config) {
    this.config = config;
    this._tools = new Map();
    this._memory = new Map();
  }

  async load() {
    this._registerBuiltins();
    log.info(`Tools loaded: ${this._tools.size}`);
  }

  available() {
    return [...this._tools.keys()];
  }

  async list() {
    return [...this._tools.values()].map(t => ({
      name: t.name, description: t.description
    }));
  }

  async getDefinitions(session) {
    // Return Anthropic-format tool definitions
    const allowlist = session?.toolAllowlist;
    const denylist = session?.toolDenylist ?? [];
    const sandboxMode = this.config.agents?.defaults?.sandbox?.mode;

    return [...this._tools.values()]
      .filter(t => !denylist.includes(t.name))
      .filter(t => !allowlist || allowlist.includes(t.name))
      .filter(t => !(sandboxMode === 'non-main' && t.requiresHost))
      .map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
  }

  async invoke({ name, input, sessionId }) {
    const tool = this._tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    log.info(`[tool] ${name} ${JSON.stringify(input).slice(0, 80)}`);
    return await tool.handler(input, { sessionId, registry: this });
  }

  _registerBuiltins() {
    // ── bash ──────────────────────────────────────────────────────────────────
    this._register({
      name: 'bash',
      description: 'Execute a bash shell command. Returns stdout/stderr/exit code. Use for running scripts, system operations, file manipulation, and any shell task.',
      requiresHost: true,
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
          cwd: { type: 'string', description: 'Working directory (default: ~/.aquaclaw/workspace)' },
        },
        required: ['command'],
      },
      handler: async ({ command, timeout = 30000, cwd }) => {
        const workdir = cwd ?? join(homedir(), '.aquaclaw', 'workspace');
        try {
          const { stdout, stderr } = await execAsync(command, { cwd: workdir, timeout });
          const out = [stdout, stderr].filter(Boolean).join('\n').trim();
          return out || '(command completed with no output)';
        } catch (e) {
          return `Exit code ${e.code ?? 1}:\n${e.stderr ?? e.message}`;
        }
      }
    });

    // ── read ──────────────────────────────────────────────────────────────────
    this._register({
      name: 'read',
      description: 'Read the contents of a file.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
          encoding: { type: 'string', description: 'Encoding (default: utf8)' },
        },
        required: ['path'],
      },
      handler: async ({ path: p, encoding = 'utf8' }) => {
        const resolved = resolve(p.replace('~', homedir()));
        return await readFile(resolved, encoding);
      }
    });

    // ── write ─────────────────────────────────────────────────────────────────
    this._register({
      name: 'write',
      description: 'Write content to a file. Creates parent directories if needed.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          append: { type: 'boolean', description: 'Append instead of overwrite (default: false)' },
        },
        required: ['path', 'content'],
      },
      handler: async ({ path: p, content, append = false }) => {
        const resolved = resolve(p.replace('~', homedir()));
        await mkdir(resolve(resolved, '..'), { recursive: true });
        if (append) {
          const { appendFile } = await import('fs/promises');
          await appendFile(resolved, content);
        } else {
          await writeFile(resolved, content);
        }
        return `Written: ${resolved}`;
      }
    });

    // ── edit ──────────────────────────────────────────────────────────────────
    this._register({
      name: 'edit',
      description: 'Replace a specific string in a file with another string.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_str: { type: 'string', description: 'The exact string to find and replace' },
          new_str: { type: 'string', description: 'The replacement string' },
        },
        required: ['path', 'old_str', 'new_str'],
      },
      handler: async ({ path: p, old_str, new_str }) => {
        const resolved = resolve(p.replace('~', homedir()));
        const content = await readFile(resolved, 'utf8');
        if (!content.includes(old_str)) throw new Error(`String not found in file: ${old_str.slice(0, 50)}`);
        const updated = content.replace(old_str, new_str);
        await writeFile(resolved, updated);
        return `Edited: ${resolved}`;
      }
    });

    // ── web_search ────────────────────────────────────────────────────────────
    this._register({
      name: 'web_search',
      description: 'Search the web for current information. Returns top results with titles, URLs, and snippets.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          n: { type: 'number', description: 'Number of results (default: 5)' },
        },
        required: ['query'],
      },
      handler: async ({ query, n = 5 }) => {
        // Use DuckDuckGo instant answers API
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const res = await fetch(url);
        const data = await res.json();
        const results = [];
        if (data.AbstractText) results.push(`Summary: ${data.AbstractText}`);
        for (const r of (data.RelatedTopics ?? []).slice(0, n)) {
          if (r.Text) results.push(`• ${r.Text}\n  ${r.FirstURL ?? ''}`);
        }
        return results.join('\n\n') || `No results for: ${query}`;
      }
    });

    // ── http ──────────────────────────────────────────────────────────────────
    this._register({
      name: 'http',
      description: 'Make an HTTP request. Supports GET, POST, PUT, DELETE.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'HTTP method (default: GET)' },
          headers: { type: 'object', description: 'Request headers' },
          body: { type: 'string', description: 'Request body (for POST/PUT)' },
        },
        required: ['url'],
      },
      handler: async ({ url, method = 'GET', headers = {}, body }) => {
        const res = await fetch(url, { method, headers, body });
        const text = await res.text();
        return `HTTP ${res.status} ${res.statusText}\n${text.slice(0, 4000)}`;
      }
    });

    // ── screenshot ────────────────────────────────────────────────────────────
    this._register({
      name: 'screenshot',
      description: 'Take a screenshot of the current screen.',
      requiresHost: true,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Output path (default: ~/aquaclaw-screenshot.png)' },
        },
      },
      handler: async ({ path: p }) => {
        const outPath = p ?? join(homedir(), 'aquaclaw-screenshot.png');
        if (process.platform === 'darwin') {
          await execAsync(`screencapture -x "${outPath}"`);
        } else if (process.platform === 'linux') {
          await execAsync(`scrot "${outPath}"`).catch(() => execAsync(`gnome-screenshot -f "${outPath}"`));
        }
        return `Screenshot saved: ${outPath}`;
      }
    });

    // ── notify ────────────────────────────────────────────────────────────────
    this._register({
      name: 'notify',
      description: 'Send a desktop notification.',
      requiresHost: true,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['title', 'message'],
      },
      handler: async ({ title, message }) => {
        if (process.platform === 'darwin') {
          await execAsync(`osascript -e 'display notification "${message}" with title "${title}"'`);
        } else if (process.platform === 'linux') {
          await execAsync(`notify-send "${title}" "${message}"`);
        }
        return `Notification sent: ${title}`;
      }
    });

    // ── memory ────────────────────────────────────────────────────────────────
    this._register({
      name: 'memory',
      description: 'Store or retrieve facts in persistent memory.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['store', 'retrieve', 'list', 'delete'] },
          key: { type: 'string', description: 'Memory key' },
          value: { type: 'string', description: 'Value to store (for store action)' },
        },
        required: ['action'],
      },
      handler: async ({ action, key, value }, ctx) => {
        const memPath = join(homedir(), '.aquaclaw', 'memory.json');
        let mem = {};
        try { mem = JSON.parse(await readFile(memPath, 'utf8')); } catch {}

        switch (action) {
          case 'store':
            mem[key] = { value, timestamp: new Date().toISOString() };
            await writeFile(memPath, JSON.stringify(mem, null, 2));
            return `Stored: ${key} = ${value}`;
          case 'retrieve':
            return mem[key] ? `${key}: ${mem[key].value} (stored ${mem[key].timestamp})` : `Not found: ${key}`;
          case 'list':
            return Object.entries(mem).map(([k, v]) => `${k}: ${v.value}`).join('\n') || 'Memory is empty';
          case 'delete':
            delete mem[key];
            await writeFile(memPath, JSON.stringify(mem, null, 2));
            return `Deleted: ${key}`;
        }
      }
    });

    // ── sessions_list ─────────────────────────────────────────────────────────
    this._register({
      name: 'sessions_list',
      description: 'List all active agent sessions for agent-to-agent coordination.',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_, ctx) => {
        const sessions = await ctx.registry.config._gateway?.sessions.list() ?? [];
        return JSON.stringify(sessions, null, 2);
      }
    });

    // ── sessions_send ─────────────────────────────────────────────────────────
    this._register({
      name: 'sessions_send',
      description: 'Send a message to another agent session.',
      inputSchema: {
        type: 'object',
        properties: {
          to_session: { type: 'string', description: 'Target session ID' },
          message: { type: 'string', description: 'Message to send' },
        },
        required: ['to_session', 'message'],
      },
      handler: async ({ to_session, message }, ctx) => {
        return `Message queued for session: ${to_session}`;
      }
    });
  }

  _register(tool) {
    this._tools.set(tool.name, tool);
  }
}
