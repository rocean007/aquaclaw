# 🦈 AquaClaw — Personal AI Agent

**Your personal AI agent. Any OS. Any platform. The shark way.**

AquaClaw is a local-first personal AI agent that:
- Runs as a background daemon on your machine
- Connects to all your messaging platforms (Telegram, Discord, Slack, WhatsApp, Matrix, IRC, Signal, SMS, Email, and more)
- Speaks and listens via voice (wake word, push-to-talk, continuous talk)
- Executes tasks autonomously with bash, browser, file system, web search, and more
- Serves a beautiful web UI + WebChat at `http://localhost:18790`
- Supports multiple AI models: Claude, GPT-4, o3, and any Ollama local model

---

## Quick start

**Requirements: Node.js ≥22.16**

```bash
npm install -g aquaclaw@latest
# or: pnpm add -g aquaclaw@latest

aquaclaw onboard --install-daemon
```

`aquaclaw onboard` walks you through model setup, channel connections, and voice configuration. `--install-daemon` installs AquaClaw as a launchd (macOS) or systemd (Linux) service that starts on login.

---

## Install from source

```bash
git clone https://github.com/aquaclaw/aquaclaw.git
cd aquaclaw

pnpm install
pnpm build

pnpm aquaclaw onboard --install-daemon

# Dev loop (auto-reload on changes)
pnpm gateway:watch
```

---

## CLI reference

```bash
aquaclaw onboard            # Interactive setup wizard
aquaclaw gateway            # Start the gateway daemon
aquaclaw gateway --port 18790 --verbose

aquaclaw agent -m "Ship a summary of my inbox"
aquaclaw agent --stream -m "Write a Python web scraper"
aquaclaw chat               # Interactive REPL
aquaclaw voice              # Voice input/output loop

aquaclaw status             # Show gateway health
aquaclaw doctor             # Diagnose issues

aquaclaw sessions list
aquaclaw sessions reset main

aquaclaw skills list
aquaclaw skills install coding
aquaclaw skills search writing

aquaclaw channels list
aquaclaw channels login telegram

aquaclaw pairing list
aquaclaw pairing approve telegram ABC123

aquaclaw config --show
aquaclaw update --channel stable
```

---

## Chat commands

Send these in any channel (Telegram, Discord, Slack, etc.):

| Command | Effect |
|---------|--------|
| `/status` | Session status, model, token usage |
| `/reset` or `/new` | Reset session history |
| `/compact` | Summarize old context to save tokens |
| `/think <level>` | Set thinking level: off/low/medium/high/max |
| `/model <name>` | Switch model for this session |
| `/voice on\|off` | Enable/disable voice readback |
| `/help` | List all commands |

---

## Channels

AquaClaw connects to all major messaging platforms:

| Channel | Status | Notes |
|---------|--------|-------|
| WebChat | ✅ Built-in | Always on at localhost:18790 |
| Telegram | ✅ Full | Bot API via grammY |
| Discord | ✅ Full | discord.js, slash commands |
| Slack | ✅ Full | Socket mode via Bolt |
| WhatsApp | ✅ Full | Baileys (no business API needed) |
| Matrix | ✅ Full | matrix-js-sdk |
| Signal | ✅ Full | signal-cli required |
| IRC | ✅ Full | irc-framework |
| Email | ✅ Full | IMAP/SMTP polling |
| SMS | ✅ Full | Twilio webhook |
| MS Teams | ✅ Webhook | Bot Framework |
| RSS | ✅ Full | Feed polling → agent |
| Webhook | ✅ Full | Generic inbound HTTP |

**DM security model:** Unknown senders receive a pairing code. Approve with `aquaclaw pairing approve <channel> <code>`. Set `dmPolicy: "open"` to allow anyone.

---

## Voice

AquaClaw has full voice support on all platforms:

**STT (Speech-to-Text):**
- `whisper` — Local Whisper.cpp or Python openai-whisper (free, private)
- `whisper-api` — OpenAI Whisper API (fast, requires OpenAI key)

**TTS (Text-to-Speech):**
- `system` — macOS `say`, Linux `espeak`/`festival`, Windows PowerShell (free)
- `elevenlabs` — ElevenLabs (best quality, requires API key)
- `openai` — OpenAI TTS (requires API key)
- `coqui` — Coqui TTS (free, local)

**Wake words:** Configure `voice.wakeWords` to trigger AquaClaw hands-free.

```json
{
  "voice": {
    "enabled": true,
    "stt": "whisper",
    "tts": "elevenlabs",
    "elevenLabsApiKey": "...",
    "wakeWords": ["hey shark", "aquaclaw"],
    "wakeWord": { "enabled": true }
  }
}
```

---

## Models

AquaClaw supports all major AI providers with automatic failover:

```json
{
  "agent": { "model": "claude-opus-4-6" },
  "models": {
    "anthropicApiKey": "sk-ant-...",
    "openaiApiKey": "sk-...",
    "ollamaBaseUrl": "http://localhost:11434"
  }
}
```

Supported model strings:
- `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`
- `gpt-4o`, `gpt-4o-mini`, `o1`, `o3`
- `ollama/llama3.3`, `ollama/gemma3`, `ollama/mistral`, `ollama/qwen2.5`

---

## Tools

The agent can use these tools autonomously:

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands |
| `read` | Read file contents |
| `write` | Write/create files |
| `edit` | Find-and-replace in files |
| `web_search` | Search the web |
| `http` | Make HTTP requests |
| `screenshot` | Capture screen |
| `notify` | Desktop notifications |
| `memory` | Persistent key-value memory |
| `sessions_list` | List agent sessions |
| `sessions_send` | Message another agent session |

---

## Skills

Skills inject personality and instructions into the agent's system prompt. Install from AquaHub or create your own in `~/.aquaclaw/workspace/skills/<name>/SKILL.md`.

```bash
aquaclaw skills install coding    # Expert software engineer persona
aquaclaw skills install research  # Deep research mode
aquaclaw skills install writing   # Professional writing
aquaclaw skills install personal  # Personal assistant with memory
```

---

## Workspace files

The agent reads these files from `~/.aquaclaw/workspace/` on every request:

| File | Purpose |
|------|---------|
| `AGENTS.md` | Core agent instructions and behaviors |
| `SOUL.md` | Personality and communication style |
| `TOOLS.md` | Custom tool documentation |
| `skills/<n>/SKILL.md` | Installed skill prompts |

---

## Cron jobs

Schedule recurring tasks:

```json
{
  "cron": [
    {
      "id": "morning-briefing",
      "schedule": "every 24h",
      "message": "Give me a morning briefing: weather, news headlines, and my top 3 priorities",
      "sessionId": "telegram:12345678"
    },
    {
      "id": "inbox-check",
      "schedule": "every 2h",
      "message": "Check my email for anything urgent and summarize"
    }
  ]
}
```

---

## Security

- **Default:** Gateway binds to `127.0.0.1` (loopback only)
- **DM pairing:** Unknown senders require approval
- **Sandbox mode:** Set `agents.defaults.sandbox.mode: "non-main"` to run non-main sessions in Docker
- **Tailscale:** Configure `gateway.tailscale.mode: "serve"` for secure remote access

Run `aquaclaw doctor` to surface security misconfigurations.

---

## Architecture

```
Telegram / Discord / Slack / WhatsApp / Matrix / IRC / Signal / Email / SMS / WebChat
                              │
                              ▼
            ┌─────────────────────────────────┐
            │         AquaClaw Gateway         │
            │      ws://127.0.0.1:18790        │
            │  ┌──────────────────────────┐   │
            │  │     Channel Router        │   │
            │  │  (DM pairing / routing)   │   │
            │  └───────────┬──────────────┘   │
            │              │                   │
            │  ┌───────────▼──────────────┐   │
            │  │       Agent Runner        │   │
            │  │  (tool use / streaming)   │   │
            │  └───────────┬──────────────┘   │
            │              │                   │
            │  ┌───────────▼──────────────┐   │
            │  │      Tool Registry        │   │
            │  │  bash/read/write/search   │   │
            │  └──────────────────────────┘   │
            │                                  │
            │  Sessions │ Skills │ Voice │ Cron │
            └─────────────────────────────────┘
                              │
                    ┌─────────┴──────────┐
                    │                    │
               CLI (aquaclaw)     Web UI :18790
```

---

## Compared to OpenClaw

| Feature | OpenClaw | AquaClaw |
|---------|----------|----------|
| Multi-model | Claude, GPT | + Ollama (any local model) |
| Web search | Via skill | Built-in tool |
| Persistent memory | External skill | Built-in `memory` tool |
| TTS providers | ElevenLabs, system | + OpenAI, Coqui |
| Screenshot tool | No | Yes (cross-platform) |
| Streaming HTTP | No | Yes (`/api/chat/stream`) |
| Cron syntax | Full cron | + simple "every 1h" |
| Web UI | Yes | Rebuilt — faster, cleaner |
| RSS channel | No | Yes |
| SMS channel | No | Yes (Twilio) |
| Email channel | Gmail Pub/Sub | Full IMAP/SMTP |

---

## Community

- Discord: [discord.gg/aquaclaw](https://discord.gg/aquaclaw)
- Docs: [docs.aquaclaw.ai](https://docs.aquaclaw.ai)
- Issues: [github.com/aquaclaw/aquaclaw/issues](https://github.com/aquaclaw/aquaclaw/issues)

---

## License

MIT © AquaClaw Contributors
