const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const osc = require('osc');

// Config (env overrides)
const HTTP_PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const OSC_PORT = process.env.OSC_PORT ? Number(process.env.OSC_PORT) : 9000;
const DEBOUNCE_MS = process.env.DEBOUNCE_MS ? Number(process.env.DEBOUNCE_MS) : 1500;
const WAIT_FOR_MULTIPLAY_MS = process.env.WAIT_FOR_MULTIPLAY_MS ? Number(process.env.WAIT_FOR_MULTIPLAY_MS) : 2000;
const DEBUG_LOG = (process.env.DEBUG_LOG || 'true') === 'true';
const STOP_PROMOTE_DEBOUNCE_MS = process.env.STOP_PROMOTE_DEBOUNCE_MS ? Number(process.env.STOP_PROMOTE_DEBOUNCE_MS) : 500;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// Simple in-memory admin tokens store
const crypto = require('crypto');
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const ADMIN_TOKEN_TTL_MS = process.env.ADMIN_TOKEN_TTL_MS ? Number(process.env.ADMIN_TOKEN_TTL_MS) : (30 * 60 * 1000);
const adminTokens = new Map(); // token -> { expiresAt }

function generateAdminToken() {
  return crypto.randomBytes(16).toString('hex');
}

function isValidAdminToken(t) {
  if (!t) return false;
  const rec = adminTokens.get(t);
  if (!rec) return false;
  if (Date.now() > rec.expiresAt) { adminTokens.delete(t); return false; }
  return true;
}

// HTTP endpoint to unlock (returns token)
app.post('/admin/unlock', (req, res) => {
  const pin = req.body && String(req.body.pin || '');
  if (pin !== ADMIN_PIN) return res.status(401).json({ ok: false, error: 'invalid_pin' });
  const token = generateAdminToken();
  adminTokens.set(token, { expiresAt: Date.now() + ADMIN_TOKEN_TTL_MS });
  if (DEBUG_LOG) console.log('[ADMIN] issued token', token);
  return res.json({ ok: true, token, ttlMs: ADMIN_TOKEN_TTL_MS });
});

// HTTP endpoint to lock (invalidate token)
app.post('/admin/lock', (req, res) => {
  const token = req.body && String(req.body.token || '');
  if (!token) return res.status(400).json({ ok: false, error: 'missing_token' });
  adminTokens.delete(token);
  if (DEBUG_LOG) console.log('[ADMIN] token invalidated', token);
  return res.json({ ok: true });
});

app.use(express.static('public'));

// State variables
let displayedArtist = 'Ingen';
let nextDisplayedArtist = 'Ingen neste';
let queuedArtist = '';
let queuedAt = 0;
let isPlaying = false; // reflects /status/go true
let isRunning = false; // timer running
let timeRemaining = '';
let lastPromotionAt = 0;
let awaitingNextUntil = 0;
let lastGoTrueAt = 0;

function nowIso() {
  return (new Date()).toISOString();
}

function logOsc(address, args) {
  if (DEBUG_LOG) console.log(`[OSC RECEIVED] ${nowIso()} ${address} -> ${JSON.stringify(args)}`);
}

function broadcast() {
  const payload = {
    currentArtist: displayedArtist,
    nextArtist: nextDisplayedArtist,
    timeRemaining,
    isRunning
  };
  console.log('[BROADCAST]', JSON.stringify(payload));
  io.emit('update', payload);
}

function parseArg(a) {
  // osc package may deliver args as objects with .value
  if (a && typeof a === 'object' && ('value' in a)) return a.value;
  return a;
}

function parseRemainingToSeconds(rem) {
  if (!rem || typeof rem !== 'string') return null;
  // Accept MM:SS.X or M:SS or HH:MM:SS
  const parts = rem.split(':').reverse();
  let seconds = 0;
  for (let i = 0; i < parts.length; i++) {
    const v = parseFloat(parts[i].replace(',', '.'));
    if (isNaN(v)) return null;
    seconds += v * Math.pow(60, i);
  }
  return seconds;
}

function promoteIfNeeded() {
  if (nextDisplayedArtist && nextDisplayedArtist !== 'Ingen neste') {
    displayedArtist = nextDisplayedArtist;
    nextDisplayedArtist = 'Ingen neste';
    queuedArtist = '';
    lastPromotionAt = Date.now();
    isRunning = false;
    isPlaying = false;
    broadcast();
  } else {
    // No next - keep displayedArtist, but stop running/playing
    isRunning = false;
    isPlaying = false;
    broadcast();
  }
}

// Setup OSC UDP listener
const udp = new osc.UDPPort({
  localAddress: '0.0.0.0',
  localPort: OSC_PORT,
  metadata: true
});

udp.on('ready', () => {
  console.log(`OSC listening on port ${OSC_PORT}`);
});

udp.on('message', (msg, timeTag, info) => {
  const address = msg.address || (Array.isArray(msg) && msg[0]);
  const rawArgs = msg.args || (Array.isArray(msg) ? msg.slice(1) : []);
  const args = rawArgs.map(parseArg);
  logOsc(address, args);

  if (!address) return;

  if (address === '/status/current/qdesc') {
    const value = args[0] || '';
    const now = Date.now();
    // If we're within the awaiting window after GO, treat this qdesc as NEXT
    if (!isPlaying && awaitingNextUntil && now <= awaitingNextUntil) {
      // treat as NEXT even though isPlaying flag hasn't flipped yet (message ordering)
      if (value && value !== displayedArtist) {
        nextDisplayedArtist = value;
        if (DEBUG_LOG) console.log(`[STATE] nextDisplayedArtist set => "${nextDisplayedArtist}" (reason: awaitingNextUntil qdesc)`);
      }
      if (DEBUG_LOG) console.log('Treated qdesc as NEXT due to awaitingNextUntil');
      broadcast();
      return;
    }

    if (!isPlaying) {
      // operator has selected/armed cue while paused
      // If operator just selected a queuedArtist very recently, and a different qdesc
      // arrives shortly after, treat that incoming qdesc as NEXT (Multiplay) rather
      // than overwriting the displayedArtist.
      const QUEUED_PERSIST_MS = 3000;
      if (queuedAt && (now - queuedAt) < QUEUED_PERSIST_MS && value && value !== queuedArtist) {
        if (DEBUG_LOG) console.log('Incoming qdesc different from recent queuedArtist — treating as NEXT');
        nextDisplayedArtist = value;
        if (DEBUG_LOG) console.log(`[STATE] nextDisplayedArtist set => "${nextDisplayedArtist}" (reason: incoming qdesc != recent queuedArtist)`);
        broadcast();
        return;
      }

      queuedArtist = value;
      queuedAt = Date.now();
      displayedArtist = value;
      if (DEBUG_LOG) console.log(`[STATE] displayedArtist set => "${displayedArtist}" (reason: operator queued while paused)`);
      nextDisplayedArtist = 'Ingen neste';
      broadcast();
    } else {
      // While playing, Multiplay is authoritative for NEXT
      const sincePromotion = Date.now() - lastPromotionAt;
      // If Multiplay reports the same qdesc as current, ignore for NEXT.
      if (value && value === displayedArtist) {
        if (DEBUG_LOG) console.log('Received qdesc equal to current — ignoring for NEXT');
        return;
      }

      const now = Date.now();
      // If we're within the awaiting window after GO, prefer the first non-current qdesc
      // from Multiplay and set it as NEXT. Outside that window, also accept Multiplay
      // updates since Multiplay remains authoritative for NEXT while playing.
      if (awaitingNextUntil && now <= awaitingNextUntil) {
        if (DEBUG_LOG) console.log(`Within WAIT_FOR_MULTIPLAY_MS — accepting NEXT from Multiplay: ${value}`);
        if (value && value !== displayedArtist) {
          nextDisplayedArtist = value;
          if (DEBUG_LOG) console.log(`[STATE] nextDisplayedArtist set => "${nextDisplayedArtist}" (reason: awaiting window while playing)`);
        }
        broadcast();
        return;
      }

      // Outside the special window: accept Multiplay's reported NEXT as authoritative
      if (value && value !== displayedArtist) {
        nextDisplayedArtist = value;
        if (DEBUG_LOG) console.log(`[STATE] nextDisplayedArtist set => "${nextDisplayedArtist}" (reason: Multiplay update while playing)`);
      }
      broadcast();
    }
    return;
  }

  if (address === '/status/go') {
    const val = args[0];
    const goOn = (val === true || val === 'true' || val === 1 || val === '1');
    const previousPlaying = isPlaying;
    isPlaying = goOn;

    if (!previousPlaying && isPlaying) {
      // false -> true
      isRunning = true;
      lastGoTrueAt = Date.now();
      // After GO, give Multiplay a short window to report the authoritative NEXT cue
      awaitingNextUntil = Date.now() + WAIT_FOR_MULTIPLAY_MS;
      if (DEBUG_LOG) console.log(`[STATE] awaitingNextUntil set => ${awaitingNextUntil} (now + ${WAIT_FOR_MULTIPLAY_MS}ms)`);
      // If no NEXT from Multiplay yet, fallback to queuedArtist
      if (!nextDisplayedArtist || nextDisplayedArtist === 'Ingen neste') {
        if (queuedArtist && queuedArtist !== displayedArtist) {
          nextDisplayedArtist = queuedArtist;
          if (DEBUG_LOG) console.log(`[STATE] nextDisplayedArtist set => "${nextDisplayedArtist}" (reason: fallback queuedArtist on GO)`);
        }
      }
      broadcast();
    } else if (previousPlaying && !isPlaying) {
      // true -> false (stop)
      const now = Date.now();
      if (lastGoTrueAt && (now - lastGoTrueAt) < STOP_PROMOTE_DEBOUNCE_MS) {
        if (DEBUG_LOG) console.log(`[STATE] Ignoring quick GO false (${now - lastGoTrueAt}ms since GO true) within STOP_PROMOTE_DEBOUNCE_MS=${STOP_PROMOTE_DEBOUNCE_MS}`);
        // revert isPlaying to previousPlaying to avoid transient flip
        isPlaying = previousPlaying;
        broadcast();
        return;
      }
      promoteIfNeeded();
    } else {
      // no state change, but still broadcast time/status
      broadcast();
    }
    return;
  }

  if (address === '/status/remaining') {
    const rem = args[0] || '';
    timeRemaining = rem;
    const secs = parseRemainingToSeconds(rem);
    if (secs !== null && secs <= 0) {
      // Timer finished
      promoteIfNeeded();
    } else {
      // update only
      broadcast();
    }
    return;
  }

  if (address === '/status/elapsed') {
    // we don't rely on elapsed for logic, but update broadcast
    broadcast();
    return;
  }

  if (address === '/status/stopall' || address === '/status/fadeall') {
    const val = args[0];
    const triggered = (val === true || val === 'true' || val === 1 || val === '1');
    if (triggered) {
      promoteIfNeeded();
    }
    return;
  }

  // Handle operator select signals — if operator selects next while playing,
  // treat queuedArtist as fallback NEXT (useful when Multiplay doesn't send qdesc)
  if (address === '/status/select/next' || address === '/status/select/prev') {
    const val = args[0];
    const selected = (val === true || val === 'true' || val === 1 || val === '1');
    if (selected && isPlaying) {
      if (queuedArtist && queuedArtist !== displayedArtist) {
        nextDisplayedArtist = queuedArtist;
        broadcast();
      }
    }
    return;
  }
});

udp.on('error', (err) => {
  console.error('OSC error', err);
});

udp.open();

const udpSender = new osc.UDPPort({
  remoteAddress: "127.0.0.1",  // IP til MultiPlay
  remotePort: 8000,             // port MultiPlay lytter på
  metadata: true
});
app.get("/stop", (req, res) => {
  udpSender.send({
    address: "/stopall", // riktig OSC-melding for stop
    args: []               // ingen argumenter
  });
  console.log("[OSC SENT] /stopall");
  res.json({ ok: true });
});

udpSender.open();

app.get("/go", (req, res) => {
  udpSender.send({
    address: "/go",   // riktig OSC-melding for MultiPlay
    args: []
  });
  console.log("[OSC SENT] /go");
  res.json({ ok: true });
});
app.get("/fadeall", (req, res) => {
  udpSender.send({
    address: "/fadeall",
    args: []
  });
  console.log("[OSC SENT] /fadeall");
  res.json({ ok: true });
});


// Socket.IO connections
io.on('connection', (socket) => {
  if (DEBUG_LOG) console.log('Client connected');
  // track live connections
  if (!globalThis.liveConnections) globalThis.liveConnections = 0;
  globalThis.liveConnections += 1;
  io.emit('stats', { connections: globalThis.liveConnections });
  // Send current state immediately
  socket.emit('update', {
    currentArtist: displayedArtist,
    nextArtist: nextDisplayedArtist,
    timeRemaining,
    isRunning
  });

  // Send any active admin message to new clients
  if (globalThis.adminMessage && globalThis.adminMessage.text) {
    socket.emit('admin_message', globalThis.adminMessage);
  }

  // Admin messages from admin page
  socket.on('admin_message', (msg, cb) => {
    // Require a valid admin token with the message
    const token = msg && msg.token;
    if (!isValidAdminToken(token)) {
      if (typeof cb === 'function') cb({ ok: false, error: 'unauthorized' });
      if (DEBUG_LOG) console.log('[ADMIN] rejected admin_message - invalid token');
      return;
    }

    const m = {
      text: (msg && msg.text) ? String(msg.text) : '',
      durationMs: (msg && msg.durationMs) ? Number(msg.durationMs) : 10000,
      flash: !!(msg && msg.flash),
      color: (msg && msg.color) ? String(msg.color) : 'white',
      bold: !!(msg && msg.bold),
      uppercase: !!(msg && msg.uppercase),
      ts: Date.now()
    };
    // store globally so new clients receive it
    globalThis.adminMessage = m;
    io.emit('admin_message', m);
    if (typeof cb === 'function') cb({ ok: true });
    if (DEBUG_LOG) console.log(`[ADMIN] broadcast message: "${m.text}" dur=${m.durationMs}`);
    // Clear after duration
    setTimeout(() => {
      if (globalThis.adminMessage && globalThis.adminMessage.ts === m.ts) {
          globalThis.adminMessage = null;
          io.emit('admin_message', { text: '', durationMs: 0, flash: false, color: 'white', bold: false, uppercase: false, ts: Date.now() });
        }
    }, m.durationMs);
  });

  // admin actions (blackout / focus / flash shortcuts)
  socket.on('admin_action', (act, cb) => {
    const token = act && act.token;
    if (!isValidAdminToken(token)) {
      if (typeof cb === 'function') cb({ ok: false, error: 'unauthorized' });
      return;
    }
    const type = act && act.type;
    if (type === 'blackout') {
      const on = !!act.on;
      io.emit('action', { type: 'blackout', on });
      if (typeof cb === 'function') cb({ ok: true });
      return;
    }
    if (type === 'focus') {
      const on = !!act.on;
      io.emit('action', { type: 'focus', on });
      if (typeof cb === 'function') cb({ ok: true });
      return;
    }
    if (type === 'flash') {
      // Flash action: pulse the message on clients without removing it afterwards.
      const text = act.text || '';
      const dur = act.durationMs || 3000;
      // If a text is provided and no persistent adminMessage exists, set it as the persistent message
      if (text) {
        const m = { text: String(text), durationMs: (act.durationMs || 10000), flash: false, color: act.color || 'white', bold: !!act.bold, uppercase: !!act.uppercase, ts: Date.now() };
        globalThis.adminMessage = m;
        io.emit('admin_message', m);
      }
      // Emit a flash action so clients pulse the (current) stage message or other target
      const actionPayload = { type: 'flash', text, durationMs: dur };
      if (act && act.target) actionPayload.target = act.target;
      io.emit('action', actionPayload);
      if (typeof cb === 'function') cb({ ok: true });
      return;
    }
    if (typeof cb === 'function') cb({ ok: false, error: 'unknown_action' });
  });

  socket.on('disconnect', () => {
    if (DEBUG_LOG) console.log('Client disconnected');
    if (globalThis.liveConnections) globalThis.liveConnections -= 1;
    io.emit('stats', { connections: globalThis.liveConnections || 0 });
  });
});

server.listen(HTTP_PORT, () => {
  console.log(`HTTP server listening on port ${HTTP_PORT}`);
  console.log('Open your browser to http://localhost:' + HTTP_PORT);
});

// Graceful shutdown
process.on('SIGINT', () => process.exit());

