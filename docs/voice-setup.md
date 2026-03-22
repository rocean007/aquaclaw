# Voice Setup Guide 🎤

AquaClaw supports always-on wake word detection so you can say **"hey shark"** or **"aquaclaw"**
and it wakes up, listens, and responds — hands free.

---

## Quick setup (recommended path)

### Step 1: Install sox (audio capture, required)

```bash
# macOS
brew install sox

# Linux (Debian/Ubuntu)
sudo apt install sox

# Windows (WSL2)
sudo apt install sox
```

### Step 2: Install a Whisper engine (STT)

Pick one:

```bash
# Option A: openai-whisper (most compatible)
pip install openai-whisper

# Option B: faster-whisper (much faster, lower memory)
pip install faster-whisper

# Option C: whisper.cpp (fastest, C binary)
brew install whisper-cpp   # macOS
# then download a model:
mkdir -p ~/.aquaclaw/voice
curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin \
  -o ~/.aquaclaw/voice/ggml-base.en.bin
```

### Step 3: Choose a wake word engine

**Option A: Porcupine (best — ~1% CPU, highly accurate)**

1. Get a free access key at https://picovoice.ai (no credit card)
2. Install: `npm install -g @picovoice/porcupine-node @picovoice/pvrecorder-node`
3. Generate custom keyword models for "hey shark" and "aquaclaw":
   - Go to https://console.picovoice.ai
   - Create keyword → type "hey shark" → download `.ppn` file
   - Place at: `~/.aquaclaw/voice/hey_shark.ppn`
   - Repeat for "aquaclaw" → `~/.aquaclaw/voice/aquaclaw.ppn`
4. Add to `~/.aquaclaw/aquaclaw.json`:
   ```json
   {
     "voice": {
       "picovoiceKey": "your-access-key-here",
       "wakeWords": ["hey shark", "aquaclaw"],
       "wakeWord": { "enabled": true }
     }
   }
   ```

**Option B: Vosk (offline, no API key, ~5% CPU)**

```bash
# Install vosk
pip install vosk

# Download a small English model (~50MB)
mkdir -p ~/.aquaclaw/voice
curl -L https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip -o /tmp/vosk.zip
unzip /tmp/vosk.zip -d /tmp/
mv /tmp/vosk-model-small-en-us-0.15 ~/.aquaclaw/voice/vosk-model
```

Config:
```json
{
  "voice": {
    "wakeWords": ["hey shark", "aquaclaw"],
    "wakeWord": { "enabled": true }
  }
}
```

**Option C: Whisper polling (universal fallback, ~15-30% CPU when active)**

No extra install needed beyond sox + whisper. Works everywhere.
AquaClaw records 3-second chunks and transcribes each one.

```json
{
  "voice": {
    "wakeWords": ["hey shark", "aquaclaw"],
    "wakeWord": { "enabled": true },
    "stt": "whisper"
  }
}
```

### Step 4: Enable voice in config

```json
{
  "voice": {
    "enabled": true,
    "stt": "whisper",
    "tts": "system",
    "wakeWords": ["hey shark", "aquaclaw", "hey aquaclaw"],
    "wakeWord": { "enabled": true },
    "sessionId": "main",
    "thinkingLevel": "medium"
  }
}
```

### Step 5: Start the gateway

```bash
aquaclaw gateway
```

You'll see:
```
🔊 Listening for: [hey shark, aquaclaw, hey aquaclaw]
🔊 Porcupine active — listening for: [hey shark, aquaclaw]
```

Now say **"hey shark"** — you'll hear a beep, then speak your command.

---

## TTS setup (text-to-speech)

### System TTS (free, always works)

- **macOS**: `say` command — built in, no setup
- **Linux**: `sudo apt install espeak-ng`
- **Windows**: PowerShell built-in

### ElevenLabs (best quality, paid)

```json
{
  "voice": {
    "tts": "elevenlabs",
    "elevenLabsApiKey": "your-key",
    "voiceId": "EXAVITQu4vr4xnSDxMaL"
  }
}
```

Browse voices at https://elevenlabs.io/voice-library

### OpenAI TTS (good quality)

```json
{
  "voice": {
    "tts": "openai"
  }
}
```

Uses your `models.openaiApiKey`. Voice options: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`.

---

## Troubleshooting

**"No wake word engine available"**
→ Install sox + whisper: `brew install sox && pip install faster-whisper`

**"Porcupine installed but no PICOVOICE_ACCESS_KEY"**
→ Get a free key at https://picovoice.ai and add `voice.picovoiceKey` to config

**"No Porcupine models matched your wake words"**
→ Either use a built-in keyword (`computer`, `jarvis`, `bumblebee`) or generate a custom `.ppn` file

**Wake word triggers but no response**
→ Check STT: run `whisper --help` or `faster-whisper --help` in your terminal

**No audio output**
→ macOS: `afplay /System/Library/Sounds/Ping.aiff` (should play)
→ Linux: install mpv: `sudo apt install mpv`

**"sox: no default audio device"**
→ macOS: grant microphone permission to Terminal in System Settings → Privacy
→ Linux: `sudo apt install pulseaudio` and run `pulseaudio --start`

---

## Voice commands

Once wake word is active, you can say anything you'd type:

- *"Hey shark, what's the weather in Kathmandu?"*
- *"Aquaclaw, write a Python script to rename all my files"*
- *"Hey shark, send a Telegram message to Alice saying I'll be late"*
- *"Aquaclaw, read my last three emails and summarize them"*
- *"Hey shark, set a reminder in 30 minutes to take a break"*

The agent has access to all the same tools as in text mode: bash, files, web search, memory, and all connected channels.
