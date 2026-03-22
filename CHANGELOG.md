# Changelog

## v1.0.0 — 2026-03-22

### Added
- Gateway WebSocket control plane with full RPC API
- Agent runner with multi-provider support (Claude, GPT, Ollama) and automatic failover
- Extended thinking support (off/minimal/low/medium/high/max)
- Streaming responses via WebSocket and HTTP SSE
- Channels: Telegram, Discord, Slack, WhatsApp, Matrix, IRC, Signal, Email, SMS, Webhook, RSS, WebChat
- DM pairing security model with `aquaclaw pairing approve`
- Voice manager: Whisper STT (local + API), ElevenLabs/OpenAI/system/Coqui TTS
- Wake word detection support
- Built-in tools: bash, read, write, edit, web_search, http, screenshot, notify, memory, sessions_list, sessions_send
- Skill registry with AGENTS.md/SOUL.md/TOOLS.md injection
- Built-in skills: coding, research, writing, personal
- Session manager with persistence, pruning, compaction, and agent-to-agent send
- Cron manager with simple "every Nh/m/s" schedule syntax
- Web UI with WebChat, streaming chat, voice input, and dashboard
- CLI: onboard, gateway, agent, chat, voice, status, doctor, skills, sessions, pairing, config, update, channels
- Interactive onboarding wizard with launchd (macOS) and systemd (Linux) daemon install
- `aquaclaw doctor` diagnostics
- Docker + docker-compose support
- Configuration via `~/.aquaclaw/aquaclaw.json` or env vars

### Improvements over OpenClaw
- Multi-model failover: Claude → GPT → Ollama, automatic
- Built-in `web_search` tool (no skill install needed)
- Built-in `memory` tool for persistent key-value facts
- Built-in `screenshot` tool (cross-platform)
- Built-in `notify` tool (desktop notifications)
- Streaming HTTP endpoint `/api/chat/stream` for Web UI
- Cron "every Nh" shorthand syntax
- RSS channel (feed polling → agent)
- SMS channel via Twilio
- Full IMAP/SMTP email channel (vs Gmail Pub/Sub only)
- Rebuilt Web UI with streaming, voice input, and live dashboard
- `aquaclaw chat` interactive REPL with spinner and token count
