/**
 * AquaClaw Voice Manager
 *
 * Wake word detection (priority order):
 *  1. Porcupine (Picovoice) — best, ~1% CPU, free API key at picovoice.ai
 *  2. Vosk keyword spotting — fully offline, no key needed
 *  3. Whisper polling via sox — universal fallback, higher CPU
 *
 * STT:  whisper-local (whisper.cpp / openai-whisper) | whisper-api (OpenAI)
 * TTS:  system (say/espeak) | elevenlabs | openai | coqui
 */

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { log } from '../utils/log.mjs';

const execFileAsync = promisify(execFile);

export class VoiceManager {
  constructor(cfg, gateway) {
    this.config = cfg;
    this.gateway = gateway;
    this._listening = false;
    this._ttsQueue = [];
    this._ttsRunning = false;
    this._wakeWordActive = false;
    this._wakeProcess = null;
    this._state = 'idle'; // idle | wake_detected | recording | transcribing

    this.wakeWords = cfg.voice?.wakeWords ?? ['hey shark', 'aquaclaw', 'hey aquaclaw'];
    this.ttsProvider = cfg.voice?.tts ?? 'system';
    this.sttProvider = cfg.voice?.stt ?? 'whisper';
    this.language = cfg.voice?.language ?? 'en';
    this.voiceId = cfg.voice?.voiceId ?? null;
    this.sessionId = cfg.voice?.sessionId ?? 'main';
  }

  available() {
    return { stt: this.sttProvider, tts: this.ttsProvider, platform: process.platform };
  }

  status() {
    return {
      listening: this._listening, wakeWordActive: this._wakeWordActive,
      state: this._state, ttsQueue: this._ttsQueue.length,
      provider: { stt: this.sttProvider, tts: this.ttsProvider },
      wakeWords: this.wakeWords,
    };
  }

  async start(params = {}) {
    if (this._listening) return { already: true };
    this._listening = true;
    this._state = 'idle';
    log.info(`🎤 Voice | STT: ${this.sttProvider} | TTS: ${this.ttsProvider}`);
    if (this.config.voice?.wakeWord?.enabled !== false) this._startWakeWordLoop();
    this.gateway.broadcast({ type: 'voice.started', status: this.status() });
    return { ok: true };
  }

  async stop() {
    this._listening = false;
    this._wakeWordActive = false;
    this._state = 'idle';
    this._killWakeProcess();
    this.gateway.broadcast({ type: 'voice.stopped' });
    log.info('Voice stopped');
    return { ok: true };
  }

  // ── Wake word loop ──────────────────────────────────────────────────────────

  async _startWakeWordLoop() {
    this._wakeWordActive = true;
    log.info(`🔊 Listening for: [${this.wakeWords.join(', ')}]`);
    this.gateway.broadcast({ type: 'voice.wakeword.active', words: this.wakeWords });

    const started =
      await this._tryPorcupine().catch(() => false) ||
      await this._tryVosk().catch(() => false) ||
      await this._startWhisperPolling().catch(() => false);

    if (!started) {
      log.warn('No wake word engine available.');
      log.warn('Options:');
      log.warn('  1. Porcupine (best): npm i @picovoice/porcupine-node @picovoice/pvrecorder-node + set voice.picovoiceKey');
      log.warn('  2. Vosk (offline):   pip install vosk + download model to ~/.aquaclaw/voice/vosk-model');
      log.warn('  3. Whisper fallback: pip install openai-whisper + brew install sox');
    }
  }

  // Engine 1: Porcupine (Picovoice) -------------------------------------------
  async _tryPorcupine() {
    let Porcupine, BuiltinKeyword, PvRecorder;
    try {
      ({ Porcupine, BuiltinKeyword } = await import('@picovoice/porcupine-node'));
      ({ PvRecorder } = await import('@picovoice/pvrecorder-node'));
    } catch { return false; }

    const accessKey = this.config.voice?.picovoiceKey ?? process.env.PICOVOICE_ACCESS_KEY;
    if (!accessKey) {
      log.info('Porcupine installed but no PICOVOICE_ACCESS_KEY (free at picovoice.ai) — skipping');
      return false;
    }

    // Custom .ppn keyword files take precedence; fall back to built-ins
    const builtinMap = {
      'alexa': BuiltinKeyword.ALEXA,
      'computer': BuiltinKeyword.COMPUTER,
      'jarvis': BuiltinKeyword.JARVIS,
      'bumblebee': BuiltinKeyword.BUMBLEBEE,
    };

    const keywordsToUse = [];
    const wordLabels = [];
    for (const w of this.wakeWords) {
      const ppnPath = join(homedir(), '.aquaclaw', 'voice', `${w.replace(/\s+/g, '_')}.ppn`);
      if (existsSync(ppnPath)) {
        keywordsToUse.push(ppnPath);
        wordLabels.push(w);
      } else if (builtinMap[w.toLowerCase()] !== undefined) {
        keywordsToUse.push(builtinMap[w.toLowerCase()]);
        wordLabels.push(w);
      }
    }

    if (keywordsToUse.length === 0) {
      log.info('No Porcupine models matched your wake words.');
      log.info('Generate custom .ppn files at console.picovoice.ai → place in ~/.aquaclaw/voice/');
      log.info('Example: ~/.aquaclaw/voice/hey_shark.ppn for wake word "hey shark"');
      return false;
    }

    const sensitivities = new Array(keywordsToUse.length).fill(0.5);
    const porcupine = new Porcupine(accessKey, keywordsToUse, sensitivities);
    const recorder = new PvRecorder(porcupine.frameLength, -1);
    recorder.start();
    this._wakeProcess = recorder;
    log.success(`🔊 Porcupine active — listening for: [${wordLabels.join(', ')}]`);

    const loop = async () => {
      if (!this._listening) {
        try { recorder.stop(); recorder.release(); porcupine.release(); } catch {}
        return;
      }
      try {
        const pcm = await recorder.read();
        const idx = porcupine.process(pcm);
        if (idx >= 0) await this._onWakeWord(wordLabels[idx] ?? 'wake');
      } catch {}
      setImmediate(loop);
    };
    loop();
    return true;
  }

  // Engine 2: Vosk offline keyword spotting ------------------------------------
  async _tryVosk() {
    let vosk;
    try { vosk = await import('vosk'); } catch { return false; }

    const modelPath = this.config.voice?.voskModel ??
      join(homedir(), '.aquaclaw', 'voice', 'vosk-model');
    if (!existsSync(modelPath)) {
      log.info(`Vosk model not found at ${modelPath}`);
      log.info('Download a model from https://alphacephei.com/vosk/models');
      log.info(`Extract to ${modelPath}`);
      return false;
    }

    const { Model, Recognizer } = vosk;
    vosk.setLogLevel(-1);
    const model = new Model(modelPath);
    const rec = new Recognizer({ model, sampleRate: 16000 });
    rec.setGrammar(JSON.stringify([...this.wakeWords, '[unk]']));

    if (!(await this._checkSox())) {
      log.info('Vosk available but sox not found — needed for audio capture');
      log.info('Install: brew install sox  /  apt install sox');
      return false;
    }

    const soxProc = spawn('sox', [
      '-d', '-r', '16000', '-e', 'signed-integer', '-b', '16', '-c', '1', '-t', 'raw', '-'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    this._wakeProcess = soxProc;
    log.success(`🔊 Vosk keyword spotting active — [${this.wakeWords.join(', ')}]`);

    soxProc.stdout.on('data', async (chunk) => {
      if (!this._listening || this._state !== 'idle') return;
      if (rec.acceptWaveform(chunk)) {
        const result = JSON.parse(rec.result());
        const text = (result.text ?? '').toLowerCase();
        const matched = this.wakeWords.find(w => text.includes(w.toLowerCase()));
        if (matched) await this._onWakeWord(matched);
      } else {
        const partial = JSON.parse(rec.partialResult());
        const text = (partial.partial ?? '').toLowerCase();
        const matched = this.wakeWords.find(w => text.includes(w.toLowerCase()));
        if (matched) await this._onWakeWord(matched);
      }
    });

    soxProc.on('close', () => {
      if (this._listening) {
        log.warn('Vosk recorder closed — restarting in 2s');
        setTimeout(() => this._startWakeWordLoop(), 2000);
      }
    });

    return true;
  }

  // Engine 3: Whisper polling (universal fallback) -----------------------------
  async _startWhisperPolling() {
    if (!(await this._checkSox())) return false;

    log.success(`🔊 Whisper polling active (3s chunks) — [${this.wakeWords.join(', ')}]`);
    log.info('  Higher CPU than Porcupine/Vosk. Consider installing those for always-on use.');

    const poll = async () => {
      if (!this._listening) return;
      if (this._state !== 'idle') { setTimeout(poll, 1000); return; }

      const tmpWav = join(tmpdir(), `aquaclaw-wake-${Date.now()}.wav`);
      try {
        await this._recordSeconds(tmpWav, 3);
        const text = (await this.transcribe(null, { path: tmpWav })).toLowerCase();
        await unlink(tmpWav).catch(() => {});

        const matched = this.wakeWords.find(w => text.includes(w.toLowerCase()));
        if (matched) {
          await this._onWakeWord(matched);
          return; // _onWakeWord reschedules
        }
      } catch {
        await unlink(tmpWav).catch(() => {});
      }
      if (this._listening) setTimeout(poll, 300);
    };

    poll();
    return true;
  }

  // ── Wake word triggered ─────────────────────────────────────────────────────

  async _onWakeWord(word) {
    if (this._state !== 'idle') return;
    this._state = 'wake_detected';

    log.info(`🦈 Wake word: "${word}"`);
    this.gateway.broadcast({ type: 'voice.wake', word });

    // Audible confirmation beep
    await this._playBeep().catch(() => {});

    // Record user command
    this._state = 'recording';
    const tmpWav = join(tmpdir(), `aquaclaw-cmd-${Date.now()}.wav`);

    try {
      await this._recordUntilSilence(tmpWav, { maxSeconds: 15, silenceSeconds: 1.5 });
      this._state = 'transcribing';
      this.gateway.broadcast({ type: 'voice.recording.done' });

      const text = (await this.transcribe(null, { path: tmpWav })).trim();
      await unlink(tmpWav).catch(() => {});

      if (!text) {
        log.info('No speech after wake word — returning to idle');
        this._state = 'idle';
        if (this._listening) setTimeout(() => this._startWakeWordLoop(), 100);
        return;
      }

      log.info(`🎤 "${text}"`);
      this.gateway.broadcast({ type: 'voice.transcript', text });

      this._state = 'idle';

      const result = await this.gateway.agent.send({
        sessionId: this.sessionId,
        message: text,
        thinkingLevel: this.config.voice?.thinkingLevel ?? 'medium',
      });

      this.gateway.broadcast({ type: 'voice.response', text: result.text });
      await this.tts({ text: result.text, blocking: true });

    } catch (e) {
      log.warn(`Voice error: ${e.message}`);
      await unlink(tmpWav).catch(() => {});
    }

    this._state = 'idle';
    if (this._listening) setTimeout(() => this._startWakeWordLoop(), 200);
  }

  // ── Audio helpers ───────────────────────────────────────────────────────────

  async _recordSeconds(outPath, seconds) {
    await execFileAsync('sox', [
      '-d', '-r', '16000', '-c', '1', '-b', '16', '-e', 'signed-integer',
      outPath, 'trim', '0', String(seconds)
    ], { timeout: (seconds + 5) * 1000 });
  }

  async _recordUntilSilence(outPath, { maxSeconds = 15, silenceSeconds = 1.5, silenceThreshold = '1%' } = {}) {
    return new Promise((resolve, reject) => {
      const proc = spawn('sox', [
        '-d', '-r', '16000', '-c', '1', '-b', '16', '-e', 'signed-integer',
        outPath,
        'silence', '1', '0.1', silenceThreshold,
        '1', String(silenceSeconds), silenceThreshold,
        'trim', '0', String(maxSeconds),
      ]);
      const t = setTimeout(() => { proc.kill(); resolve(); }, (maxSeconds + 5) * 1000);
      proc.on('close', () => { clearTimeout(t); resolve(); });
      proc.on('error', reject);
    });
  }

  async _checkSox() {
    try { await execFileAsync('sox', ['--version'], { timeout: 2000 }); return true; } catch { return false; }
  }

  async _playBeep() {
    if (process.platform === 'darwin') {
      await execFileAsync('afplay', ['/System/Library/Sounds/Tink.aiff']).catch(() => {});
    } else {
      spawn('sox', ['-n', '-d', 'synth', '0.08', 'sine', '880']).on('error', () => {});
    }
  }

  _killWakeProcess() {
    if (!this._wakeProcess) return;
    try {
      if (typeof this._wakeProcess.stop === 'function') this._wakeProcess.stop();
      else this._wakeProcess.kill?.();
    } catch {}
    this._wakeProcess = null;
  }

  // ── STT ────────────────────────────────────────────────────────────────────

  async transcribe(audioBuffer, opts = {}) {
    const lang = opts.language ?? this.language;
    let filePath = opts.path ?? null;
    const ownFile = !filePath;

    if (!filePath && audioBuffer) {
      filePath = join(tmpdir(), `aquaclaw-stt-${Date.now()}.wav`);
      await writeFile(filePath, audioBuffer);
    }
    if (!filePath) throw new Error('transcribe: provide audioBuffer or opts.path');

    try {
      if (this.sttProvider === 'whisper-api') return await this._sttWhisperAPI(filePath, lang);
      return await this._sttLocal(filePath, lang);
    } finally {
      if (ownFile) await unlink(filePath).catch(() => {});
    }
  }

  async _sttLocal(filePath, lang) {
    // Try whisper.cpp
    const model = this.config.voice?.whisperModel ??
      join(homedir(), '.aquaclaw', 'voice', 'ggml-base.en.bin');
    if (existsSync(model)) {
      const bin = this.config.voice?.whisperBin ?? 'whisper-cpp';
      try {
        const { stdout } = await execFileAsync(bin,
          ['-m', model, '-l', lang, '-f', filePath, '--no-timestamps', '-nt'],
          { timeout: 30000 });
        return stdout.trim();
      } catch {}
    }

    // Try openai-whisper CLI
    try {
      await execFileAsync('whisper',
        [filePath, '--language', lang, '--model', 'base', '--output_format', 'txt', '--output_dir', tmpdir()],
        { timeout: 60000 });
      const txtPath = filePath.replace(/\.[^.]+$/, '.txt');
      const text = await readFile(txtPath, 'utf8').catch(() => '');
      await unlink(txtPath).catch(() => {});
      if (text.trim()) return text.trim();
    } catch {}

    // Try faster-whisper
    try {
      const { stdout } = await execFileAsync('python3', ['-c',
        `from faster_whisper import WhisperModel; m=WhisperModel("base",compute_type="int8"); segs,_=m.transcribe("${filePath}",language="${lang}"); print(" ".join(s.text.strip() for s in segs))`
      ], { timeout: 30000 });
      return stdout.trim();
    } catch {}

    throw new Error([
      'No Whisper engine found. Install one:',
      '  pip install openai-whisper',
      '  pip install faster-whisper',
      '  brew install whisper-cpp (then download model)',
    ].join('\n'));
  }

  async _sttWhisperAPI(filePath, lang) {
    const key = this.config.models?.openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OpenAI API key required for whisper-api');
    const { default: OpenAI } = await import('openai');
    const { createReadStream } = await import('fs');
    const client = new OpenAI({ apiKey: key });
    const res = await client.audio.transcriptions.create({
      model: 'whisper-1', file: createReadStream(filePath), language: lang,
    });
    return res.text;
  }

  // ── TTS ────────────────────────────────────────────────────────────────────

  async tts(params = {}) {
    const { text, voice, speed = 1.0, blocking = false } = params;
    if (!text?.trim()) return { ok: false };
    if (blocking) return this._playTTS(text, voice, speed);
    this._ttsQueue.push({ text, voice, speed });
    this._drainTTSQueue();
    return { ok: true, queued: true };
  }

  async _drainTTSQueue() {
    if (this._ttsRunning || this._ttsQueue.length === 0) return;
    this._ttsRunning = true;
    while (this._ttsQueue.length > 0) {
      const item = this._ttsQueue.shift();
      try { await this._playTTS(item.text, item.voice, item.speed); } catch (e) { log.warn(`TTS: ${e.message}`); }
    }
    this._ttsRunning = false;
  }

  async _playTTS(text, voice, speed = 1.0) {
    const clean = text.replace(/<[^>]+>/g, '').replace(/[#*`_~[\]()]/g, '').slice(0, 1500);
    switch (this.ttsProvider) {
      case 'elevenlabs': return this._ttsElevenLabs(clean, voice ?? this.voiceId, speed);
      case 'openai':     return this._ttsOpenAI(clean, voice, speed);
      case 'coqui':      return this._ttsCoqui(clean, voice);
      default:           return this._ttsSystem(clean, speed);
    }
  }

  async _ttsSystem(text, speed) {
    const wpm = String(Math.round(speed * 175));
    if (process.platform === 'darwin') {
      await execFileAsync('say', ['-r', wpm, text], { timeout: 120000 });
      return { ok: true };
    }
    if (process.platform === 'linux') {
      for (const [cmd, args] of [
        ['espeak-ng', ['-s', wpm, text]],
        ['espeak',    ['-s', wpm, text]],
        ['pico2wave', ['-w', '/tmp/tts.wav', text]],
      ]) {
        try { await execFileAsync(cmd, args, { timeout: 60000 }); return { ok: true }; } catch {}
      }
      throw new Error('No TTS. Install: sudo apt install espeak-ng');
    }
    // Windows
    const ps = text.replace(/['"]/g, '');
    await execFileAsync('powershell', ['-NoProfile', '-Command',
      `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=${Math.round((speed-1)*5)}; $s.Speak('${ps}')`
    ], { timeout: 120000 });
    return { ok: true };
  }

  async _ttsElevenLabs(text, voiceId, speed) {
    const apiKey = this.config.voice?.elevenLabsApiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');
    const vid = voiceId ?? 'EXAVITQu4vr4xnSDxMaL';
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}/stream`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_turbo_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75, speed } }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
    await this._playAudioBuffer(Buffer.from(await res.arrayBuffer()), 'mp3');
    return { ok: true };
  }

  async _ttsOpenAI(text, voice, speed) {
    const key = this.config.models?.openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not set');
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: key });
    const mp3 = await client.audio.speech.create({ model: 'tts-1', voice: voice ?? 'nova', input: text, speed });
    await this._playAudioBuffer(Buffer.from(await mp3.arrayBuffer()), 'mp3');
    return { ok: true };
  }

  async _ttsCoqui(text, voice) {
    await execFileAsync('tts', ['--text', text, '--out_path', '/tmp/aquaclaw-coqui.wav',
      ...(voice ? ['--model_name', voice] : [])], { timeout: 60000 });
    await this._playAudioFile('/tmp/aquaclaw-coqui.wav');
    return { ok: true };
  }

  async _playAudioBuffer(buf, ext) {
    const f = join(tmpdir(), `aquaclaw-tts-${Date.now()}.${ext}`);
    await writeFile(f, buf);
    try { await this._playAudioFile(f); } finally { await unlink(f).catch(() => {}); }
  }

  async _playAudioFile(path) {
    if (process.platform === 'darwin') {
      await execFileAsync('afplay', [path], { timeout: 120000 }); return;
    }
    for (const [cmd, args] of [
      ['mpv',    ['--no-video', '--really-quiet', path]],
      ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', path]],
      ['mplayer',['-really-quiet', path]],
      ['aplay',  [path]],
    ]) {
      try { await execFileAsync(cmd, args, { timeout: 120000 }); return; } catch {}
    }
    log.warn('No audio player. Install: apt install mpv  /  brew install mpv');
  }
}
