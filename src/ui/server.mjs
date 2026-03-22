/**
 * AquaClaw Web UI
 * Serves:
 *  - Control dashboard (status, sessions, channels)
 *  - WebChat (browser-based chat)
 *  - Static assets
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function setupWebUI(app, gateway) {
  // API routes
  app.get('/api/status', (_, res) => res.json(gateway._status()));
  app.get('/api/sessions', async (_, res) => res.json(await gateway.sessions.list()));
  app.get('/api/channels', async (_, res) => res.json(await gateway.channels.status()));

  app.post('/api/chat', async (req, res) => {
    try {
      const { message, sessionId = 'webchat', model, thinkingLevel } = req.body;
      const result = await gateway.agent.send({ sessionId, message, model, thinkingLevel });
      res.json({ ok: true, text: result.text, usage: result.usage });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Streaming endpoint
  app.post('/api/chat/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { message, sessionId = 'webchat', model, thinkingLevel } = req.body;

    const fakeWS = {
      send: (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'stream.delta') res.write(`data: ${JSON.stringify({ type: 'delta', text: msg.text })}\n\n`);
        if (msg.type === 'stream.done') { res.write(`data: ${JSON.stringify({ type: 'done', usage: msg.usage })}\n\n`); res.end(); }
        if (msg.type === 'stream.error') { res.write(`data: ${JSON.stringify({ type: 'error', error: msg.error })}\n\n`); res.end(); }
      }
    };

    await gateway.agent.stream({ sessionId, message, model, thinkingLevel }, fakeWS);
  });

  // Serve the Web UI HTML
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/webhook')) return;
    res.setHeader('Content-Type', 'text/html');
    res.send(getWebUI(gateway));
  });
}

function getWebUI(gateway) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AquaClaw</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>
:root {
  --deep: #020b18; --ocean: #061528; --tide: #0a2240; --wave: #0d3358;
  --aqua: #00d4ff; --glow: #00ffcc; --pulse: #00a8cc; --foam: #b8f4ff;
  --text: #cce8f4; --dim: #5a8aa0; --bright: #eef8ff; --radius: 12px;
}
* { margin:0; padding:0; box-sizing:border-box; }
body { background:var(--deep); color:var(--text); font-family:'DM Sans',sans-serif; height:100vh; display:flex; flex-direction:column; overflow:hidden; }
body::before { content:''; position:fixed; inset:0; background:radial-gradient(ellipse 80% 50% at 20% 80%,rgba(0,212,255,.07) 0%,transparent 60%),radial-gradient(ellipse 60% 40% at 80% 20%,rgba(0,255,204,.05) 0%,transparent 60%); pointer-events:none; }

header { display:flex; align-items:center; gap:14px; padding:14px 24px; border-bottom:1px solid rgba(0,212,255,.12); background:rgba(2,11,24,.85); backdrop-filter:blur(16px); position:relative; z-index:10; flex-shrink:0; }
.logo { display:flex; align-items:center; gap:10px; }
.logo-icon { width:36px; height:36px; background:linear-gradient(135deg,var(--aqua),var(--glow)); border-radius:9px; display:flex; align-items:center; justify-content:center; font-size:18px; box-shadow:0 0 18px rgba(0,212,255,.4); animation:pulse 3s ease-in-out infinite; }
@keyframes pulse { 0%,100%{box-shadow:0 0 18px rgba(0,212,255,.4)}50%{box-shadow:0 0 30px rgba(0,255,204,.6)} }
.logo-name { font-family:'Syne',sans-serif; font-size:20px; font-weight:800; background:linear-gradient(90deg,var(--aqua),var(--glow)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
.logo-ver { font-size:10px; color:var(--aqua); background:rgba(0,212,255,.12); border:1px solid rgba(0,212,255,.25); padding:2px 7px; border-radius:10px; letter-spacing:1px; }
.header-status { margin-left:auto; display:flex; align-items:center; gap:8px; font-size:12px; color:var(--dim); }
.status-dot { width:7px; height:7px; border-radius:50%; background:var(--glow); animation:blink 3s infinite; }
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.header-btn { padding:6px 14px; background:rgba(0,212,255,.08); border:1px solid rgba(0,212,255,.2); border-radius:6px; color:var(--text); font-size:12px; cursor:pointer; transition:all .15s; }
.header-btn:hover { background:rgba(0,212,255,.15); color:var(--aqua); }

.tabs { display:flex; gap:2px; padding:0 24px; background:rgba(4,15,32,.6); border-bottom:1px solid rgba(0,212,255,.07); flex-shrink:0; }
.tab { padding:10px 18px; font-size:13px; color:var(--dim); cursor:pointer; border-bottom:2px solid transparent; transition:all .15s; }
.tab:hover { color:var(--text); }
.tab.active { color:var(--aqua); border-bottom-color:var(--aqua); }

.content { flex:1; overflow:hidden; display:flex; }
.panel { display:none; flex:1; overflow:hidden; }
.panel.active { display:flex; }

/* CHAT PANEL */
#panel-chat { flex-direction:column; }
.messages { flex:1; overflow-y:auto; padding:24px; display:flex; flex-direction:column; gap:20px; scrollbar-width:thin; scrollbar-color:rgba(0,212,255,.2) transparent; }
.msg { display:flex; gap:12px; animation:msgIn .25s ease; }
@keyframes msgIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.msg.user { flex-direction:row-reverse; }
.avatar { width:32px; height:32px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:15px; }
.avatar.ai { background:linear-gradient(135deg,var(--aqua),var(--glow)); box-shadow:0 0 12px rgba(0,212,255,.3); }
.avatar.user { background:linear-gradient(135deg,#7b61ff,#c86dd7); font-size:12px; color:#fff; font-weight:600; }
.bubble { max-width:72%; background:rgba(10,34,64,.7); border:1px solid rgba(0,212,255,.1); border-radius:14px; border-top-left-radius:3px; padding:12px 16px; font-size:14px; line-height:1.75; color:var(--text); }
.msg.user .bubble { background:rgba(0,212,255,.1); border-color:rgba(0,212,255,.2); border-top-right-radius:3px; border-top-left-radius:14px; }
.bubble code { background:rgba(0,212,255,.1); padding:1px 5px; border-radius:3px; font-family:monospace; font-size:12px; color:var(--glow); }
.bubble pre { background:rgba(0,0,0,.4); border:1px solid rgba(0,212,255,.15); border-radius:8px; padding:12px; margin:8px 0; overflow-x:auto; font-size:12px; color:var(--glow); }
.bubble strong { color:var(--bright); }
.thinking-bubble { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--dim); font-style:italic; }
.dots span { display:inline-block; width:5px; height:5px; border-radius:50%; background:var(--aqua); animation:dotPulse 1.4s infinite; }
.dots span:nth-child(2){animation-delay:.2s}.dots span:nth-child(3){animation-delay:.4s}
@keyframes dotPulse{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}

.input-area { padding:12px 20px 20px; border-top:1px solid rgba(0,212,255,.08); background:rgba(2,11,24,.9); flex-shrink:0; }
.toolbar { display:flex; gap:8px; margin-bottom:10px; align-items:center; }
.tool-btn { padding:4px 12px; background:rgba(0,212,255,.06); border:1px solid rgba(0,212,255,.12); border-radius:5px; color:var(--dim); font-size:12px; cursor:pointer; transition:all .15s; }
.tool-btn:hover,.tool-btn.on { background:rgba(0,212,255,.14); color:var(--aqua); border-color:rgba(0,212,255,.3); }
.model-sel { background:rgba(0,212,255,.06); border:1px solid rgba(0,212,255,.15); color:var(--text); font-size:12px; padding:4px 10px; border-radius:5px; cursor:pointer; margin-left:auto; outline:none; }
.model-sel option { background:var(--ocean); }
.input-row { display:flex; gap:10px; background:rgba(10,34,64,.6); border:1px solid rgba(0,212,255,.18); border-radius:12px; padding:10px 12px; transition:all .2s; }
.input-row:focus-within { border-color:rgba(0,212,255,.4); box-shadow:0 0 0 3px rgba(0,212,255,.07); }
#chat-input { flex:1; background:none; border:none; outline:none; color:var(--bright); font-family:'DM Sans',sans-serif; font-size:14px; resize:none; max-height:150px; scrollbar-width:thin; }
#chat-input::placeholder { color:var(--dim); }
.voice-btn,.send-btn { width:36px; height:36px; border-radius:50%; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; transition:all .2s; }
.voice-btn { background:rgba(0,212,255,.1); color:var(--aqua); border:1px solid rgba(0,212,255,.25); }
.voice-btn:hover { background:rgba(0,212,255,.2); }
.voice-btn.active { background:rgba(255,100,100,.2); border-color:rgba(255,100,100,.4); animation:recPulse 1s infinite; }
@keyframes recPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,100,100,.3)}50%{box-shadow:0 0 0 8px rgba(255,100,100,0)}}
.send-btn { background:linear-gradient(135deg,var(--aqua),var(--glow)); box-shadow:0 0 14px rgba(0,212,255,.3); }
.send-btn:hover { transform:scale(1.08); box-shadow:0 0 22px rgba(0,212,255,.5); }
.send-btn:disabled { opacity:.4; cursor:not-allowed; transform:none; }
.input-hint { text-align:center; font-size:11px; color:var(--dim); margin-top:8px; }
kbd { background:rgba(0,212,255,.1); border:1px solid rgba(0,212,255,.2); border-radius:3px; padding:1px 5px; font-size:10px; color:var(--aqua); }

/* DASHBOARD PANEL */
#panel-dashboard { flex-direction:column; overflow-y:auto; padding:24px; gap:20px; scrollbar-width:thin; scrollbar-color:rgba(0,212,255,.2) transparent; }
.section-title { font-family:'Syne',sans-serif; font-size:14px; font-weight:700; color:var(--aqua); margin-bottom:14px; display:flex; align-items:center; gap:8px; }
.card-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:12px; margin-bottom:20px; }
.stat-card { background:rgba(0,212,255,.05); border:1px solid rgba(0,212,255,.1); border-radius:10px; padding:16px; }
.stat-label { font-size:11px; color:var(--dim); letter-spacing:.5px; text-transform:uppercase; margin-bottom:6px; }
.stat-value { font-size:24px; font-weight:600; color:var(--bright); font-family:'Syne',sans-serif; }
.stat-sub { font-size:11px; color:var(--dim); margin-top:4px; }
.channels-list { display:flex; flex-direction:column; gap:8px; }
.channel-row { display:flex; align-items:center; gap:12px; padding:10px 14px; background:rgba(0,212,255,.04); border:1px solid rgba(0,212,255,.1); border-radius:8px; }
.ch-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.ch-dot.on { background:var(--glow); box-shadow:0 0 6px rgba(0,255,204,.5); }
.ch-dot.off { background:rgba(255,100,100,.7); }
.ch-name { font-size:13px; font-weight:500; }
.ch-status { font-size:12px; color:var(--dim); margin-left:auto; }

/* VOICE OVERLAY */
.voice-overlay { display:none; position:fixed; inset:0; z-index:100; background:rgba(2,11,24,.94); backdrop-filter:blur(20px); flex-direction:column; align-items:center; justify-content:center; gap:20px; }
.voice-overlay.show { display:flex; animation:fadeIn .3s ease; }
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.voice-rings { position:relative; width:130px; height:130px; display:flex; align-items:center; justify-content:center; }
.ring { position:absolute; border-radius:50%; border:2px solid rgba(0,212,255,.3); animation:ringPulse 2s ease-in-out infinite; }
.ring:nth-child(1){width:76px;height:76px}.ring:nth-child(2){width:104px;height:104px;animation-delay:.3s;border-color:rgba(0,212,255,.2)}.ring:nth-child(3){width:130px;height:130px;animation-delay:.6s;border-color:rgba(0,212,255,.1)}
@keyframes ringPulse{0%,100%{transform:scale(.95);opacity:1}50%{transform:scale(1.05);opacity:.4}}
.voice-core { width:60px; height:60px; border-radius:50%; background:radial-gradient(circle at 35% 35%,var(--glow),var(--aqua)); box-shadow:0 0 35px rgba(0,212,255,.6); display:flex; align-items:center; justify-content:center; font-size:26px; position:relative; z-index:1; animation:corePulse 1s ease-in-out infinite; }
@keyframes corePulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
.voice-text { font-size:16px; color:var(--bright); min-height:28px; }
.voice-transcript { font-size:18px; color:var(--bright); font-style:italic; max-width:380px; text-align:center; min-height:30px; }
.voice-stop { padding:10px 28px; border-radius:24px; background:rgba(255,100,100,.15); border:1px solid rgba(255,100,100,.3); color:#ff8080; cursor:pointer; font-size:14px; transition:all .2s; }
.voice-stop:hover { background:rgba(255,100,100,.25); }
</style>
</head>
<body>
<header>
  <div class="logo">
    <div class="logo-icon">🦈</div>
    <div class="logo-name">AquaClaw</div>
    <div class="logo-ver">v1.0</div>
  </div>
  <div class="header-status">
    <div class="status-dot"></div>
    <span id="hdr-status">Gateway online</span>
  </div>
  <button class="header-btn" onclick="clearChat()">Clear</button>
  <button class="header-btn" onclick="switchTab('dashboard')">Dashboard</button>
</header>

<div class="tabs">
  <div class="tab active" id="tab-chat" onclick="switchTab('chat')">💬 Chat</div>
  <div class="tab" id="tab-dashboard" onclick="switchTab('dashboard')">📊 Dashboard</div>
</div>

<div class="content">
  <!-- CHAT PANEL -->
  <div class="panel active" id="panel-chat">
    <div class="messages" id="messages">
      <div class="msg">
        <div class="avatar ai">🦈</div>
        <div>
          <div class="bubble">Hey! I'm <strong>AquaClaw</strong> — your personal AI agent running locally. Ask me anything, give me tasks to complete, or say "help" to see what I can do. 🦈</div>
        </div>
      </div>
    </div>
    <div class="input-area">
      <div class="toolbar">
        <button class="tool-btn" onclick="insertText('/reset')">↺ Reset</button>
        <button class="tool-btn" onclick="insertText('/compact')">✂ Compact</button>
        <button class="tool-btn" id="stream-btn" onclick="toggleStream()" title="Stream responses">⚡ Stream</button>
        <select class="model-sel" id="model-sel">
          <option value="">Default model</option>
          <option value="claude-opus-4-6">Claude Opus 4.6</option>
          <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
          <option value="gpt-4o">GPT-4o</option>
          <option value="ollama/llama3.3">Llama 3.3 (local)</option>
        </select>
      </div>
      <div class="input-row">
        <textarea id="chat-input" rows="1" placeholder="Ask anything… or press 🎤 to speak" oninput="autoResize(this)" onkeydown="handleKey(event)"></textarea>
        <button class="voice-btn" id="voice-btn" onclick="startVoice()" title="Voice input">🎤</button>
        <button class="send-btn" id="send-btn" onclick="sendMessage()">➤</button>
      </div>
      <div class="input-hint"><kbd>Enter</kbd> send &nbsp;·&nbsp; <kbd>Shift+Enter</kbd> new line</div>
    </div>
  </div>

  <!-- DASHBOARD PANEL -->
  <div class="panel" id="panel-dashboard">
    <div class="section-title">📊 Gateway Status</div>
    <div class="card-grid" id="stat-cards">
      <div class="stat-card"><div class="stat-label">Status</div><div class="stat-value" style="font-size:16px;color:var(--glow)">Online ✓</div></div>
      <div class="stat-card"><div class="stat-label">Sessions</div><div class="stat-value" id="d-sessions">—</div></div>
      <div class="stat-card"><div class="stat-label">Uptime</div><div class="stat-value" id="d-uptime">—</div></div>
      <div class="stat-card"><div class="stat-label">Memory</div><div class="stat-value" id="d-mem">—</div></div>
    </div>
    <div class="section-title">📡 Channels</div>
    <div class="channels-list" id="channels-list"><div style="color:var(--dim);font-size:13px">Loading...</div></div>
  </div>
</div>

<!-- Voice overlay -->
<div class="voice-overlay" id="voice-overlay">
  <div class="voice-rings"><div class="ring"></div><div class="ring"></div><div class="ring"></div><div class="voice-core">🦈</div></div>
  <div class="voice-text" id="voice-label">Listening…</div>
  <div class="voice-transcript" id="voice-transcript">Speak now</div>
  <button class="voice-stop" onclick="stopVoice()">Stop</button>
</div>

<script>
let streamMode = false;
let voiceActive = false;
let recognition = null;
let sessionId = 'webchat';

function switchTab(tab) {
  document.querySelectorAll('.tab,.panel').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  document.getElementById('panel-'+tab).classList.add('active');
  if (tab === 'dashboard') loadDashboard();
}

function toggleStream() {
  streamMode = !streamMode;
  document.getElementById('stream-btn').classList.toggle('on', streamMode);
}

function autoResize(el) {
  el.style.height='auto';
  el.style.height=Math.min(el.scrollHeight,150)+'px';
}

function handleKey(e) {
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}
}

function insertText(t) {
  document.getElementById('chat-input').value = t;
  sendMessage();
}

function clearChat() {
  document.getElementById('messages').innerHTML = '<div class="msg"><div class="avatar ai">🦈</div><div><div class="bubble">Session cleared. How can I help?</div></div></div>';
  fetch('/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'/reset',sessionId})});
}

async function sendMessage() {
  const ta = document.getElementById('chat-input');
  const text = ta.value.trim();
  if(!text) return;
  ta.value=''; autoResize(ta);

  appendMsg('user', text);

  const model = document.getElementById('model-sel').value || undefined;
  const thinkId = appendThinking();

  if (streamMode) {
    const res = await fetch('/api/chat/stream', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:text, sessionId, model})
    });
    removeThinking(thinkId);
    const bubble = appendMsg('ai', '');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    while(true) {
      const {done,value} = await reader.read();
      if(done) break;
      const chunk = decoder.decode(value);
      for(const line of chunk.split('\n')) {
        if(!line.startsWith('data:')) continue;
        try {
          const d = JSON.parse(line.slice(5));
          if(d.type==='delta') { full+=d.text; bubble.innerHTML = formatText(full); scrollBottom(); }
        } catch {}
      }
    }
  } else {
    try {
      const res = await fetch('/api/chat', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({message:text, sessionId, model})
      });
      const data = await res.json();
      removeThinking(thinkId);
      if(data.ok) appendMsg('ai', data.text);
      else appendMsg('ai', '⚠️ '+data.error);
    } catch(e) {
      removeThinking(thinkId);
      appendMsg('ai','⚠️ '+e.message);
    }
  }
}

function appendMsg(role, text) {
  const m = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg'+(role==='user'?' user':'');
  div.innerHTML = role==='ai'
    ? \`<div class="avatar ai">🦈</div><div><div class="bubble" id="b-\${Date.now()}">\${formatText(text)}</div></div>\`
    : \`<div class="avatar user">You</div><div><div class="bubble">\${escHtml(text)}</div></div>\`;
  m.appendChild(div);
  scrollBottom();
  if(role==='ai') return div.querySelector('.bubble');
}

let thinkN=0;
function appendThinking() {
  const id='think-'+(++thinkN);
  const m=document.getElementById('messages');
  const div=document.createElement('div');
  div.className='msg'; div.id=id;
  div.innerHTML='<div class="avatar ai">🦈</div><div><div class="bubble thinking-bubble"><div class="dots"><span></span><span></span><span></span></div><span>Thinking</span></div></div>';
  m.appendChild(div); scrollBottom();
  return id;
}
function removeThinking(id){document.getElementById(id)?.remove();}

function scrollBottom(){const m=document.getElementById('messages');m.scrollTop=m.scrollHeight;}

function formatText(text){
  text=text.replace(/\`\`\`(\\w*)\n([\\s\\S]*?)\`\`\`/g,(_,l,c)=>\`<pre><code>\${escHtml(c.trim())}</code></pre>\`);
  text=text.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
  text=text.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
  text=text.replace(/^### (.+)$/gm,'<h3 style="font-size:13px;color:var(--aqua);margin:10px 0 4px">$1</h3>');
  text=text.replace(/^## (.+)$/gm,'<h2 style="font-size:15px;color:var(--aqua);margin:12px 0 6px">$1</h2>');
  text=text.replace(/^[-*] (.+)$/gm,'<div style="padding:2px 0 2px 14px;position:relative"><span style="position:absolute;left:0;color:var(--aqua)">›</span>$1</div>');
  text=text.replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>');
  return text;
}
function escHtml(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// Voice
function startVoice(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){alert('Voice requires Chrome or Edge');return;}
  voiceActive=true;
  document.getElementById('voice-overlay').classList.add('show');
  document.getElementById('voice-btn').classList.add('active');
  document.getElementById('voice-transcript').textContent='Speak now…';
  recognition=new SR();
  recognition.continuous=false;recognition.interimResults=true;recognition.lang='en-US';
  recognition.onresult=e=>{
    let interim='',final='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      if(e.results[i].isFinal)final+=e.results[i][0].transcript;
      else interim+=e.results[i][0].transcript;
    }
    document.getElementById('voice-transcript').textContent=final||interim||'…';
    if(final){setTimeout(()=>{stopVoice();document.getElementById('chat-input').value=final;sendMessage();},400);}
  };
  recognition.onerror=e=>{document.getElementById('voice-label').textContent='Error: '+e.error;setTimeout(stopVoice,1500);};
  recognition.onend=()=>{if(voiceActive)stopVoice();};
  recognition.start();
}
function stopVoice(){
  voiceActive=false;
  if(recognition){try{recognition.stop();}catch{}recognition=null;}
  document.getElementById('voice-overlay').classList.remove('show');
  document.getElementById('voice-btn').classList.remove('active');
}

// Dashboard
async function loadDashboard(){
  try{
    const s=await fetch('/api/status').then(r=>r.json());
    document.getElementById('d-sessions').textContent=s.sessions??'—';
    document.getElementById('d-uptime').textContent=Math.round((s.uptime??0)/60)+'m';
    document.getElementById('d-mem').textContent=Math.round((s.memory?.rss??0)/1024/1024)+'MB';

    const channels=await fetch('/api/channels').then(r=>r.json());
    const cl=document.getElementById('channels-list');
    cl.innerHTML=Object.entries(channels).map(([n,c])=>\`
      <div class="channel-row">
        <div class="ch-dot \${c.connected?'on':'off'}"></div>
        <div class="ch-name">\${n}</div>
        <div class="ch-status">\${c.status??'unknown'}</div>
      </div>\`).join('')||'<div style="color:var(--dim);font-size:13px">No channels configured</div>';
  }catch(e){document.getElementById('hdr-status').textContent='Gateway offline';}
}

// Keyboard shortcuts
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&voiceActive)stopVoice();
});

window.speechSynthesis?.getVoices();
</script>
</body>
</html>`;
}
