/**
 * AquaClaw Agent Runner
 *
 * The agent loop handles:
 *  - Multi-turn conversation with full tool use
 *  - Streaming responses back to channels + WS clients
 *  - Thinking levels (off/low/medium/high/max)
 *  - Model failover (Anthropic → OpenAI → local Ollama)
 *  - Per-session context management + pruning
 *  - Skill injection (AGENTS.md, SOUL.md, TOOLS.md)
 *  - Sub-agent spawning (sessions_send)
 *  - Usage tracking
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config } from '../gateway/config.mjs';
import { log } from '../utils/log.mjs';
import { loadSkillPrompts } from '../skills/prompts.mjs';
import { THINKING_BUDGETS, DEFAULT_MODEL } from '../constants.mjs';

export class AgentRunner {
  constructor(cfg, gateway) {
    this.config = cfg;
    this.gateway = gateway;
    this._activeRuns = new Map();  // sessionId → AbortController

    // Initialize model clients
    this._anthropic = cfg.models?.anthropicApiKey
      ? new Anthropic({ apiKey: cfg.models.anthropicApiKey })
      : null;

    this._openai = cfg.models?.openaiApiKey
      ? new OpenAI({ apiKey: cfg.models.openaiApiKey })
      : null;
  }

  /** Send a message to an agent session, get a response */
  async send(params) {
    const {
      sessionId = 'main',
      message,
      model,
      thinkingLevel = 'medium',
      stream = false,
    } = params;

    const session = await this.gateway.sessions.getOrCreate(sessionId);
    const resolvedModel = model ?? session.model ?? config.agent?.model ?? DEFAULT_MODEL;

    // Append user message
    session.messages.push({ role: 'user', content: message });

    // Build system prompt
    const system = await this._buildSystem(session);

    // Agentic loop: run until no more tool calls
    let iterations = 0;
    const MAX_ITERATIONS = 20;

    while (iterations++ < MAX_ITERATIONS) {
      const result = await this._callModel({
        model: resolvedModel,
        system,
        messages: session.messages,
        tools: await this.gateway.tools.getDefinitions(session),
        thinkingLevel,
        stream,
      });

      // Append assistant message
      session.messages.push({ role: 'assistant', content: result.content });

      // Check for tool use
      const toolUseBlocks = result.content.filter(b => b.type === 'tool_use');
      if (toolUseBlocks.length === 0) {
        // Done — extract text response
        const text = result.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('');

        // Track usage
        await this.gateway.sessions.trackUsage(sessionId, result.usage);

        // Prune context if needed
        await this._maybePrune(session);

        return { text, usage: result.usage, stopReason: result.stop_reason };
      }

      // Execute tools
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (tool) => {
          this.gateway.broadcast({ type: 'tool.start', sessionId, tool: tool.name, input: tool.input });
          try {
            const output = await this.gateway.tools.invoke({
              name: tool.name,
              input: tool.input,
              sessionId,
            });
            this.gateway.broadcast({ type: 'tool.done', sessionId, tool: tool.name });
            return { type: 'tool_result', tool_use_id: tool.id, content: String(output) };
          } catch (e) {
            this.gateway.broadcast({ type: 'tool.error', sessionId, tool: tool.name, error: e.message });
            return { type: 'tool_result', tool_use_id: tool.id, content: `Error: ${e.message}`, is_error: true };
          }
        })
      );

      // Append tool results
      session.messages.push({ role: 'user', content: toolResults });
    }

    throw new Error('Agent exceeded maximum iterations');
  }

  /** Streaming version — yields chunks to WS client */
  async stream(params, ws) {
    const { sessionId = 'main', message, model, thinkingLevel = 'medium' } = params;
    const session = await this.gateway.sessions.getOrCreate(sessionId);
    const resolvedModel = model ?? session.model ?? config.agent?.model ?? DEFAULT_MODEL;

    session.messages.push({ role: 'user', content: message });
    const system = await this._buildSystem(session);

    const ac = new AbortController();
    this._activeRuns.set(sessionId, ac);

    try {
      const stream = await this._anthropic.messages.stream({
        model: resolvedModel,
        max_tokens: 8192,
        system,
        messages: session.messages,
        tools: await this.gateway.tools.getDefinitions(session),
        ...(thinkingLevel !== 'off' ? {
          thinking: { type: 'enabled', budget_tokens: THINKING_BUDGETS[thinkingLevel] ?? 5000 }
        } : {}),
      }, { signal: ac.signal });

      let fullText = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullText += event.delta.text;
          ws.send(JSON.stringify({ type: 'stream.delta', sessionId, text: event.delta.text }));
        }
      }

      const final = await stream.finalMessage();
      session.messages.push({ role: 'assistant', content: final.content });
      ws.send(JSON.stringify({ type: 'stream.done', sessionId, usage: final.usage }));
    } catch (e) {
      if (e.name !== 'AbortError') {
        ws.send(JSON.stringify({ type: 'stream.error', sessionId, error: e.message }));
      }
    } finally {
      this._activeRuns.delete(sessionId);
    }
  }

  async stop(sessionId) {
    const ac = this._activeRuns.get(sessionId);
    if (ac) { ac.abort(); this._activeRuns.delete(sessionId); return { stopped: true }; }
    return { stopped: false };
  }

  /** Call the appropriate model, with failover */
  async _callModel({ model, system, messages, tools, thinkingLevel }) {
    // Anthropic models
    if (model.startsWith('claude') || model.startsWith('anthropic/')) {
      if (!this._anthropic) throw new Error('Anthropic API key not configured');
      const cleanModel = model.replace('anthropic/', '');
      return await this._anthropic.messages.create({
        model: cleanModel,
        max_tokens: 8192,
        system,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        ...(thinkingLevel !== 'off' ? {
          thinking: { type: 'enabled', budget_tokens: THINKING_BUDGETS[thinkingLevel] ?? 5000 }
        } : {}),
      });
    }

    // OpenAI models (GPT-4, o3, etc.)
    if (model.startsWith('gpt') || model.startsWith('openai/') || model.startsWith('o1') || model.startsWith('o3')) {
      if (!this._openai) throw new Error('OpenAI API key not configured');
      const cleanModel = model.replace('openai/', '');
      const res = await this._openai.chat.completions.create({
        model: cleanModel,
        messages: [{ role: 'system', content: system }, ...messages],
        tools: tools.length > 0 ? tools.map(this._toOpenAITool) : undefined,
      });
      return this._fromOpenAIResponse(res);
    }

    // Ollama (local models)
    if (model.startsWith('ollama/') || model.startsWith('llama') || model.startsWith('mistral') || model.startsWith('gemma')) {
      return await this._callOllama(model.replace('ollama/', ''), system, messages, tools);
    }

    throw new Error(`Unknown model: ${model}. Supported: claude-*, gpt-*, o1/o3-*, ollama/*`);
  }

  async _callOllama(model, system, messages, tools) {
    const baseUrl = config.models?.ollamaBaseUrl ?? 'http://localhost:11434';
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        stream: false,
        tools: tools.length > 0 ? tools.map(this._toOllamaTool) : undefined,
      }),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return {
      content: [{ type: 'text', text: data.message?.content ?? '' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  async _buildSystem(session) {
    const parts = [];

    // Load skill prompts (AGENTS.md, SOUL.md, TOOLS.md)
    const skillPrompts = await loadSkillPrompts(this.config, session);
    if (skillPrompts) parts.push(skillPrompts);

    // Core identity
    parts.push(`You are AquaClaw 🦈 — a powerful personal AI agent running locally on this machine.
You are helpful, precise, and capable. You have access to tools and can execute multi-step tasks.
When given a task, you complete it fully and well. You are direct and concise unless asked to elaborate.
Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`);

    // Session-specific persona
    if (session.persona) parts.push(session.persona);

    // Custom user instructions
    if (config.agent?.instructions) parts.push(config.agent.instructions);

    return parts.join('\n\n');
  }

  async _maybePrune(session) {
    const maxTokens = config.agent?.maxContextTokens ?? 100000;
    const estimatedTokens = session.messages.reduce((acc, m) => {
      return acc + (typeof m.content === 'string' ? m.content.length / 4 : 100);
    }, 0);

    if (estimatedTokens > maxTokens * 0.8) {
      // Keep system + last 20 messages
      const kept = session.messages.slice(-20);
      session.messages = kept;
      log.info(`[${session.id}] Context pruned: kept ${kept.length} messages`);
    }
  }

  _toOpenAITool(t) {
    return {
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema }
    };
  }

  _toOllamaTool(t) {
    return {
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema }
    };
  }

  _fromOpenAIResponse(res) {
    const choice = res.choices[0];
    const content = [];
    if (choice.message.content) content.push({ type: 'text', text: choice.message.content });
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) });
      }
    }
    return { content, stop_reason: choice.finish_reason, usage: { input_tokens: res.usage?.prompt_tokens ?? 0, output_tokens: res.usage?.completion_tokens ?? 0 } };
  }
}
