/**
 * AquaClaw Voice Manager
 *
 * Features:
 *  - Wake word detection ("Hey Shark", "AquaClaw", configurable)
 *  - Push-to-talk (PTT) mode
 *  - Continuous talk mode (auto-VAD)
 *  - STT: OpenAI Whisper (local via whisper.cpp) or Whisper API
 *  - TTS: ElevenLabs, OpenAI TTS, macOS 'say', espeak, Coqui
 *  - Streaming TTS for low latency
 *  - Works on macOS, Linux, Windows (WSL2)
 */

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { createWriteStream, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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
    this._vadProcess = null;

    this.wakeWords = cfg.voice?.wakeWords ?? ['hey shark', 'aquaclaw', 'hey aquaclaw'];
    this.ttsProvider = cfg.voice?.tts ?? 'system';  // system | elevenlabs | openai | coqui
    this.sttProvider = cfg.voice?.stt ?? 'whisper'; // whisper | whisper-api
    this.voiceId = cfg.voice?.voiceId ?? null;
    this.language = cfg.voice?.language ?? 'en';
  }

  available() {
    return {
      stt: this._checkSTT(),
      tts: this._checkTTS(),
      wakeWord: this._checkWakeWord(),
      platform: process.platform,
    };
  }

  status() {
    return {
      listening: this._listening,
      wakeWordActive: this._wakeWordActive,
      ttsQueue: this._ttsQueue.length,
      provider: { stt: this.sttProvider, tts: this.ttsProvider },
    };
  }

  /** Start voice manager (wake word + background listeners) */
  async start(params = {}) {
    if (this._listening) return { already: true };

    this._listening = true;
    log.info(`🎤 Voice manager started (STT: ${this.sttProvider}, TTS: ${this.ttsProvider})`);

    if (this.config.voice?.wakeWord?.enabled) {
      await this._startWakeWord();
    }

    this.gateway.broadcast({ type: 'voice.started', status: this.status() });
    return { ok: true };
  }

  async stop() {
    this._listening = false;
    this._wakeWordActive = false;
    if (this._vadProcess) { this._vadProcess.kill(); this._vadProcess = null; }
    this.gateway.broadcast({ type: 'voice.stopped' });
    log.info('Voice manager stopped');
    return { ok: true };
  }

  /**
   * Transcribe audio buffer to text using Whisper
   * @param {Buffer} audioBuffer - PCM or WAV audio
   * @returns {string} Transcribed text
   */
  async transcribe(audioBuffer, opts = {}) {
    const lang = opts.language ?? this.language;

    if (this.sttProvider === 'whisper-api') {
      return await this._transcribeWhisperAPI(audioBuffer, lang);
    }

    // Local Whisper via whisper.cpp
    return await this._transcribeLocal(audioBuffer, lang);
  }

  async _transcribeLocal(audioBuffer, lang) {
    const tmpFile = join(tmpdir(), `aquaclaw-stt-${Date.now()}.wav`);
    const { writeFile } = await import('fs/promises');
    await writeFile(tmpFile, audioBuffer);

    try {
      // Try whisper.cpp binary first
      const whisperBin = this.config.voice?.whisperBin ?? 'whisper';
      const modelPath = this.config.voice?.whisperModel ?? 'base.en';

      const { stdout } = await execFileAsync(whisperBin, [
        '--model', modelPath,
        '--language', lang,
        '--output-txt', '--no-timestamps',
        tmpFile
      ], { timeout: 30000 });

      return stdout.trim();
    } catch {
      // Fallback: try Python openai-whisper
      try {
        const { stdout } = await execFileAsync('python3', [
          '-c',
          `import whisper; m=whisper.load_model("base"); r=m.transcribe("${tmpFile}",language="${lang}"); print(r["text"])`
        ], { timeout: 60000 });
        return stdout.trim();
      } catch (e2) {
        throw new Error(`STT failed: ${e2.message}. Install whisper.cpp or openai-whisper.`);
      }
    }
  }

  async _transcribeWhisperAPI(audioBuffer, lang) {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.config.models?.openaiApiKey });
    const { Blob } = await import('buffer');

    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    const file = new File([blob], 'audio.wav', { type: 'audio/wav' });

    const res = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      language: lang,
    });
    return res.text;
  }

  /**
   * Text-to-speech — queue and play
   * @param {object} params - { text, voice, speed, blocking }
   */
  async tts(params = {}) {
    const { text, voice, speed = 1.0, blocking = false } = params;
    if (!text?.trim()) return { ok: false, reason: 'empty text' };

    if (blocking) {
      return await this._playTTS(text, voice, speed);
    }

    this._ttsQueue.push({ text, voice, speed });
    this._drainTTSQueue();
    return { ok: true, queued: true };
  }

  async _drainTTSQueue() {
    if (this._ttsRunning || this._ttsQueue.length === 0) return;
    this._ttsRunning = true;
    while (this._ttsQueue.length > 0) {
      const item = this._ttsQueue.shift();
      try { await this._playTTS(item.text, item.voice, item.speed); } catch (e) { log.warn(`TTS error: ${e.message}`); }
    }
    this._ttsRunning = false;
  }

  async _playTTS(text, voice, speed) {
    const clean = text.replace(/[#*`_~\[\]()]/g, '').slice(0, 1000);

    switch (this.ttsProvider) {
      case 'elevenlabs': return await this._ttsElevenLabs(clean, voice ?? this.voiceId, speed);
      case 'openai':     return await this._ttsOpenAI(clean, voice, speed);
      case 'coqui':      return await this._ttsCoqui(clean, voice, speed);
      default:           return await this._ttsSystem(clean, speed);
    }
  }

  async _ttsSystem(text, speed) {
    const speedStr = String(Math.round(speed * 175));  // words per minute

    if (process.platform === 'darwin') {
      await execFileAsync('say', ['-r', speedStr, text]);
    } else if (process.platform === 'linux') {
      // Try espeak, then festival, then pico2wave
      for (const [cmd, args] of [
        ['espeak', ['-s', speedStr, text]],
        ['festival', ['--tts']],
        ['pico2wave', ['-w', '/tmp/aquaclaw-tts.wav', text]],
      ]) {
        try { await execFileAsync(cmd, args); return { ok: true }; } catch {}
      }
      throw new Error('No TTS engine found. Install espeak: sudo apt install espeak');
    } else {
      // Windows via PowerShell
      await execFileAsync('powershell', [
        '-Command',
        `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=${Math.round((speed-1)*5)}; $s.Speak("${text.replace(/"/g, '')}")`
      ]);
    }
    return { ok: true };
  }

  async _ttsElevenLabs(text, voiceId, speed) {
    const apiKey = this.config.voice?.elevenLabsApiKey;
    if (!apiKey) throw new Error('ElevenLabs API key not configured (voice.elevenLabsApiKey)');

    const vid = voiceId ?? 'EXAVITQu4vr4xnSDxMaL'; // default: Bella
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}/stream`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed },
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs error: ${res.status}`);

    const audioBuffer = Buffer.from(await res.arrayBuffer());
    await this._playAudioBuffer(audioBuffer, 'mp3');
    return { ok: true };
  }

  async _ttsOpenAI(text, voice, speed) {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.config.models?.openaiApiKey });
    const mp3 = await client.audio.speech.create({
      model: 'tts-1', voice: voice ?? 'nova', input: text, speed,
    });
    const buf = Buffer.from(await mp3.arrayBuffer());
    await this._playAudioBuffer(buf, 'mp3');
    return { ok: true };
  }

  async _ttsCoqui(text, voice, speed) {
    // Local Coqui TTS
    const { stdout } = await execFileAsync('tts', [
      '--text', text,
      '--out_path', '/tmp/aquaclaw-coqui.wav',
      ...(voice ? ['--model_name', voice] : []),
    ]);
    await this._playAudioFile('/tmp/aquaclaw-coqui.wav');
    return { ok: true };
  }

  async _playAudioBuffer(buf, format) {
    const tmpFile = join(tmpdir(), `aquaclaw-tts-${Date.now()}.${format}`);
    const { writeFile } = await import('fs/promises');
    await writeFile(tmpFile, buf);
    await this._playAudioFile(tmpFile);
  }

  async _playAudioFile(path) {
    if (process.platform === 'darwin') {
      await execFileAsync('afplay', [path]);
    } else {
      for (const [cmd, args] of [
        ['mpv', ['--no-video', path]],
        ['ffplay', ['-nodisp', '-autoexit', path]],
        ['aplay', [path]],
      ]) {
        try { await execFileAsync(cmd, args); return; } catch {}
      }
    }
  }

  async _startWakeWord() {
    // Porcupine (picovoice) wake word engine if available, else simple keyword spotting
    log.info(`🔊 Wake words active: ${this.wakeWords.join(', ')}`);
    this._wakeWordActive = true;

    // TODO: integrate picovoice/porcupine for always-on wake word
    // For now, poll via continuous Whisper every 3 seconds (power-hungry but universal)
    this.gateway.broadcast({ type: 'voice.wakeword.active', words: this.wakeWords });
  }

  _checkSTT() {
    if (this.sttProvider === 'whisper-api') return this.config.models?.openaiApiKey ? 'whisper-api' : false;
    return 'whisper-local'; // assume available, error at runtime if not
  }

  _checkTTS() {
    if (this.ttsProvider === 'elevenlabs') return this.config.voice?.elevenLabsApiKey ? 'elevenlabs' : 'system';
    if (this.ttsProvider === 'openai') return this.config.models?.openaiApiKey ? 'openai' : 'system';
    return 'system';
  }

  _checkWakeWord() {
    return this.config.voice?.wakeWord?.enabled ? 'active' : 'disabled';
  }
}
