// ...existing code...
const WS_URL = 'wss://caverned-sorcery-jj5qp54pv7gxc595.github.dev'

let ws = null;
let myId = null;
let token = localStorage.getItem('token') || null;

// DOM
const logEl = document.getElementById('log');
const msgInput = document.getElementById('msg');
const sendButton = document.getElementById('send');
const privateToInput = document.getElementById('privateTo');
const privateMsgInput = document.getElementById('privateMsg');
const sendPrivateButton = document.getElementById('sendPrivate');
const userListEl = document.getElementById('userList');

const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const registerBtn = document.getElementById('register');
const loginBtn = document.getElementById('login');
const wsAuthBtn = document.getElementById('wsAuth');
const becomeGuestBtn = document.getElementById('becomeGuest');
const logoutBtn = document.getElementById('logout');

function appendNode(node) {
  logEl.appendChild(node);
  logEl.scrollTop = logEl.scrollHeight;
}

function addMessage({ type, from, content, ts, to, message, userId }) {
  const el = document.createElement('div');
  el.className = 'msg';

  if (type === 'welcome' || type === 'auth_ok') {
    myId = userId || myId;
    el.className = 'meta';
    el.textContent = `System: ${message || 'Connected'}${myId ? ` — you: ${myId}` : ''}`;
    appendNode(el);
    return;
  }

  if (type === 'system' || type === 'connected' || type === 'info') {
    el.className = 'meta';
    el.textContent = `${message || content || type}`;
    appendNode(el);
    return;
  }

  if (type === 'presence') {
    // presence handled elsewhere
    return;
  }

  if (type === 'chat') {
    el.textContent = `${from}: ${content}`;
    if (myId && from === myId) el.classList.add('me');
    appendNode(el);
    return;
  }

  if (type === 'private') {
    el.textContent = `(private) ${from} → ${to}: ${content}`;
    el.classList.add('private');
    if (myId && from === myId) el.classList.add('me');
    appendNode(el);
    return;
  }

  // error / fallback
  if (type === 'error' || type === 'auth_failed') {
    el.className = 'meta';
    el.style.color = 'salmon';
    el.textContent = `${type}: ${message || content || ''}`;
    appendNode(el);
    return;
  }

  // raw fallback
  el.textContent = JSON.stringify({ type, from, content, to, ts, message, userId });
  appendNode(el);
}

function renderPresence(users) {
  if (!userListEl) return;
  userListEl.innerHTML = '';
  if (!users || users.length === 0) {
    userListEl.textContent = 'No one online';
    return;
  }
  users.forEach(u => {
    const d = document.createElement('div');
    d.textContent = u;
    if (myId && u === myId) d.className = 'me';
    userListEl.appendChild(d);
  });
}

function notifyVoice(userId) {
  try {
    if (!userId) return;
    if (window.setVoiceUserId) window.setVoiceUserId(userId);
    window.dispatchEvent(new CustomEvent('user-authenticated', { detail: { userId } }));
    console.log('[CLIENT] notified voice.js of userId', userId);
  } catch (e) {
    console.warn('[CLIENT] notifyVoice error', e);
  }
}

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  ws = new WebSocket(WS_URL);
  // expose for voice layer
  window.clientSocket = ws;

  ws.addEventListener('open', () => {
    addMessage({ type: 'system', message: 'connected' });
    if (token) {
      ws.send(JSON.stringify({ type: 'auth_token', token }));
    }
  });

  ws.addEventListener('message', (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch (e) {
      addMessage({ type: 'system', message: ev.data });
      return;
    }

    if (data.type === 'presence') {
      renderPresence(data.users || []);
      // pass to voice if needed
      if (window.voiceHandleServerMessage) window.voiceHandleServerMessage(data);
      return;
    }

    // pass parsed message to voice layer (so voice signaling can use same socket)
    if (window.voiceHandleServerMessage) {
      try { window.voiceHandleServerMessage(data); } catch (e) { console.warn('[CLIENT] voice handler error', e); }
    }

    addMessage(data);

    // notify voice after auth / welcome so voice has the user id
    if (data.type === 'auth_ok' || data.type === 'welcome') {
      notifyVoice(data.userId || data.userId);
    }
  });

  ws.addEventListener('close', () => {
    addMessage({ type: 'system', message: 'disconnected' });
    // cleanup exposure
    try { if (window.clientSocket === ws) window.clientSocket = null; } catch {}
    // simple reconnect attempt for resilience
    setTimeout(connect, 1500);
  });

  ws.addEventListener('error', (err) => {
    console.error('ws error', err);
  });
}

function sendTypedMessage() {
  const text = (msgInput && msgInput.value || '').trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  const target = (privateToInput && privateToInput.value || '').trim();
  if (target) {
    ws.send(JSON.stringify({ type: 'private', to: target, content: text }));
  } else {
    ws.send(JSON.stringify({ type: 'chat', content: text }));
  }
  msgInput.value = '';
}

function sendPrivateFromFields() {
  const to = (privateToInput && privateToInput.value || '').trim();
  const content = (privateMsgInput && privateMsgInput.value || '').trim();
  if (!to || !content || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'private', to, content }));
  privateMsgInput.value = '';
}

// keyboard: Enter to send (no shift)
if (msgInput) {
  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTypedMessage();
    }
  });
}

// click handlers
if (sendButton) sendButton.addEventListener('click', sendTypedMessage);
if (sendPrivateButton) sendPrivateButton.addEventListener('click', sendPrivateFromFields);

// auth / register / login via REST
async function apiRegister() {
  const username = (usernameInput && usernameInput.value || '').trim();
  const password = (passwordInput && passwordInput.value || '').trim();
  if (!username || !password) return addMessage({ type: 'system', message: 'username & password required' });
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const j = await res.json();
    if (res.ok && j.token) {
      token = j.token;
      localStorage.setItem('token', token);
      addMessage({ type: 'system', message: 'Registered and token saved' });
      try { ws && ws.close(); } catch {}
      connect();
      return;
    }
    addMessage({ type: 'system', message: JSON.stringify(j) });
  } catch (err) {
    addMessage({ type: 'system', message: 'register error' });
  }
}

async function apiLogin() {
  const username = (usernameInput && usernameInput.value || '').trim();
  const password = (passwordInput && passwordInput.value || '').trim();
  if (!username || !password) return addMessage({ type: 'system', message: 'username & password required' });
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const j = await res.json();
    if (res.ok && j.token) {
      token = j.token;
      localStorage.setItem('token', token);
      addMessage({ type: 'system', message: 'Login ok, token saved' });
      try { ws && ws.close(); } catch {}
      connect();
      return;
    }
    addMessage({ type: 'system', message: JSON.stringify(j) });
  } catch (err) {
    addMessage({ type: 'system', message: 'login error' });
  }
}

// ws auth (username/password over WS)
function wsAuth() {
  const username = (usernameInput && usernameInput.value || '').trim();
  const password = (passwordInput && passwordInput.value || '').trim();
  if (!username || !password) return addMessage({ type: 'system', message: 'username & password required' });
  if (!ws || ws.readyState !== WebSocket.OPEN) return addMessage({ type: 'system', message: 'Socket not ready' });
  ws.send(JSON.stringify({ type: 'auth', username, password }));
}

// become guest explicitly
function becomeGuest() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return addMessage({ type: 'system', message: 'Socket not ready' });
  ws.send(JSON.stringify({ type: 'create_guest' }));
}

// logout
function logout() {
  token = null;
  localStorage.removeItem('token');
  addMessage({ type: 'system', message: 'Logged out (token cleared)' });
  try { ws && ws.close(); } catch {}
  connect();
}

// hook up auth buttons
if (registerBtn) registerBtn.addEventListener('click', apiRegister);
if (loginBtn) loginBtn.addEventListener('click', apiLogin);
if (wsAuthBtn) wsAuthBtn.addEventListener('click', wsAuth);
if (becomeGuestBtn) becomeGuestBtn.addEventListener('click', becomeGuest);
if (logoutBtn) logoutBtn.addEventListener('click', logout);

// start
connect();

// --- merged voice logic (uses same socket if present) ---
(() => {
  const audioDevicesSelect = document.getElementById('audioDevices');
  const joinBtn = document.getElementById('joinVoice');
  const leaveBtn = document.getElementById('leaveVoice');
  const muteBtn = document.getElementById('muteVoice');
  const remoteAudios = document.getElementById('remoteAudios');
  const volumeSlider = document.getElementById('remoteVolume');

  const pcs = new Map(); // peerId -> RTCPeerConnection
  const remoteAudioEls = new Map(); // peerId -> <audio>
  let localStream = null;
  let clientId = null;            // authenticated userId (set by client)
  let inVoice = false;
  let muted = false;

  // prefer main client socket for signaling
  function getSendSocket() {
    if (window.clientSocket && window.clientSocket.readyState === WebSocket.OPEN) return window.clientSocket;
    return null;
  }

  // fallback: open own signaling WS only if main socket not available
  let fallbackSignal = null;
  (function openFallbackSignaling() {
    if (window.clientSocket) return;
    try {
      fallbackSignal = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/signal');
      fallbackSignal.addEventListener('open', () => {
        console.log('[VOICE] fallback signaling WS open');
        try { fallbackSignal.send(JSON.stringify({ type: 'identify' })); } catch (e) {}
      });
      fallbackSignal.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          handleSignalMessage(msg);
        } catch (e) { console.warn('[VOICE] fallback parse error', e); }
      });
    } catch (e) {
      fallbackSignal = null;
    }
  })();

  // expose setter so client code can provide the authenticated user id
  function setClientId(id) {
    clientId = id || null;
    console.log('[VOICE] clientId set to', clientId);
  }

  window.addEventListener('user-authenticated', (ev) => {
    try {
      const id = ev && ev.detail && ev.detail.userId;
      if (id) setClientId(id);
    } catch (e) {}
  });

  window.setVoiceUserId = setClientId;
  window.getVoiceUserId = () => clientId;

  // allow main client message handler to forward messages here
  window.voiceHandleServerMessage = function(msg) {
    try { handleSignalMessage(msg); } catch (e) { console.warn('[VOICE] handler error', e); }
  };

  function sendSignal(obj) {
    try {
      const sock = getSendSocket() || fallbackSignal;
      if (!sock || sock.readyState !== WebSocket.OPEN) {
        console.warn('[VOICE] no signaling websocket open to send', obj && obj.type);
        return;
      }
      sock.send(JSON.stringify(obj));
    } catch (e) {
      console.warn('[VOICE] sendSignal error', e);
    }
  }

  async function handleSignalMessage(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'identify':
        if (msg.id) setClientId(msg.id);
        break;
      case 'voice-join':
        if (msg.from === clientId) return;
        await createPeerAndOffer(msg.from);
        break;
      case 'voice-offer':
        if (msg.to && msg.to !== clientId) return;
        await handleOffer(msg.from, msg.sdp);
        break;
      case 'voice-answer':
        if (msg.to && msg.to !== clientId) return;
        await handleAnswer(msg.from, msg.sdp);
        break;
      case 'voice-ice':
        if (msg.to && msg.to !== clientId) return;
        {
          const pc = pcs.get(msg.from);
          if (pc && msg.candidate) {
            try { await pc.addIceCandidate(msg.candidate); } catch (e) { console.warn(e); }
          }
        }
        break;
      case 'voice-leave':
        cleanupPeer(msg.from);
        break;
      default:
        // ignore other messages
    }
  }

  async function ensureLocalStream(deviceId) {
    if (localStream) return localStream;
    const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    const aud = document.createElement('audio');
    aud.autoplay = true;
    aud.muted = true;
    aud.srcObject = localStream;
    aud.style.display = 'none';
    document.body.appendChild(aud);
    return localStream;
  }

  async function createPeerAndOffer(targetId) {
    if (pcs.has(targetId)) return;
    const pc = makePeerConnection(targetId);
    pcs.set(targetId, pc);
    const stream = await ensureLocalStream(audioDevicesSelect.value || null);
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal({ type: 'voice-offer', from: clientId, to: targetId, sdp: pc.localDescription });
  }

  async function handleOffer(fromId, sdp) {
    if (pcs.has(fromId)) return;
    const pc = makePeerConnection(fromId);
    pcs.set(fromId, pc);
    const stream = await ensureLocalStream(audioDevicesSelect.value || null);
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal({ type: 'voice-answer', from: clientId, to: fromId, sdp: pc.localDescription });
  }

  async function handleAnswer(fromId, sdp) {
    const pc = pcs.get(fromId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  function makePeerConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal({ type: 'voice-ice', from: clientId, to: peerId, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      let aud = remoteAudioEls.get(peerId);
      if (!aud) {
        aud = document.createElement('audio');
        aud.autoplay = true;
        aud.controls = true;
        aud.dataset.peer = peerId;
        remoteAudios.appendChild(aud);
        remoteAudioEls.set(peerId, aud);
        aud.volume = parseFloat(volumeSlider.value || 1);
      }
      aud.srcObject = e.streams[0];
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        cleanupPeer(peerId);
      }
    };
    return pc;
  }

  function cleanupPeer(peerId) {
    const pc = pcs.get(peerId);
    if (pc) {
      try { pc.close(); } catch (e) {}
      pcs.delete(peerId);
    }
    const aud = remoteAudioEls.get(peerId);
    if (aud) {
      aud.remove();
      remoteAudioEls.delete(peerId);
    }
  }

  async function joinVoice() {
    if (inVoice) return;
    await populateAudioDevices();
    await ensureLocalStream(audioDevicesSelect.value || null);
    inVoice = true;
    joinBtn.disabled = true;
    leaveBtn.disabled = false;
    muteBtn.disabled = false;
    sendSignal({ type: 'voice-join', from: clientId });
  }

  function leaveVoice() {
    if (!inVoice) return;
    for (const peerId of Array.from(pcs.keys())) {
      sendSignal({ type: 'voice-leave', from: clientId, to: peerId });
      cleanupPeer(peerId);
    }
    if (localStream) {
      for (const t of localStream.getTracks()) t.stop();
      localStream = null;
    }
    inVoice = false;
    joinBtn.disabled = false;
    leaveBtn.disabled = true;
    muteBtn.disabled = true;
  }

  function toggleMute() {
    if (!localStream) return;
    muted = !muted;
    for (const t of localStream.getAudioTracks()) t.enabled = !muted;
    muteBtn.textContent = muted ? 'Unmute' : 'Mute';
  }

  async function populateAudioDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    if (!audioDevicesSelect) return;
    audioDevicesSelect.innerHTML = '';
    for (const d of audioInputs) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphone ${audioDevicesSelect.length + 1}`;
      audioDevicesSelect.appendChild(opt);
    }
  }

  volumeSlider && volumeSlider.addEventListener('input', () => {
    const v = parseFloat(volumeSlider.value);
    for (const aud of remoteAudioEls.values()) aud.volume = v;
  });

  joinBtn && joinBtn.addEventListener('click', joinVoice);
  leaveBtn && leaveBtn.addEventListener('click', leaveVoice);
  muteBtn && muteBtn.addEventListener('click', toggleMute);

  navigator.mediaDevices && navigator.mediaDevices.addEventListener && navigator.mediaDevices.addEventListener('devicechange', populateAudioDevices);

  populateAudioDevices().catch(() => {});

  // expose controls for debugging
  window.voice = {
    join: joinVoice,
    leave: leaveVoice,
    muteToggle: toggleMute,
    getClientId: () => clientId,
    handleSignalMessage, // alternative call site
  };

  window.addEventListener('beforeunload', () => {
    leaveVoice();
    try { if (fallbackSignal) fallbackSignal.close(); } catch (e) {}
  });
})();
