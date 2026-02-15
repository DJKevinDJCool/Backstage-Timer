const socket = io();

const clockEl = document.getElementById('clock');
const artistEl = document.getElementById('artist');
const nextArtistEl = document.getElementById('nextArtist');
const nextLabelEl = document.getElementById('nextLabel');
const progressFill = document.getElementById('progressFill');
const progressMarker = document.getElementById('progressMarker');
const wallClockEl = document.getElementById('wallClock');
const cueFinishEl = document.getElementById('cueFinishTime');
const stageMessageEl = document.getElementById('stageMessage');
const stageTimerRoot = document.getElementById('stage-timer');
let isFocused = false;

function showStageMessage(msg, isFlash) {
  if (!stageMessageEl) return;
  if (!msg || !msg.text) {
    stageMessageEl.classList.add('hidden');
    stageMessageEl.classList.remove('flash-text');
    stageMessageEl.textContent = '';
    stageMessageEl.style.color = '';
    stageMessageEl.style.fontWeight = '';
    stageMessageEl.style.textTransform = '';
    return;
  }
  stageMessageEl.textContent = msg.text;
  stageMessageEl.style.color = (msg.color === 'green') ? '#1b8a4a' : (msg.color === 'red' ? '#d24b4b' : '#ffffff');
  stageMessageEl.style.fontWeight = msg.bold ? '700' : '400';
  stageMessageEl.style.textTransform = msg.uppercase ? 'uppercase' : 'none';
  stageMessageEl.classList.remove('hidden');
  // default or focus size
  if (isFocused) {
    stageMessageEl.classList.remove('default-pos');
    stageMessageEl.classList.add('focus-pos');
  } else {
    stageMessageEl.classList.remove('focus-pos');
    stageMessageEl.classList.add('default-pos');
  }
  if (isFlash) {
    stageMessageEl.classList.add('flash-text');
    setTimeout(() => { if (stageMessageEl) stageMessageEl.classList.remove('flash-text'); }, (msg.durationMs || 3000) + 50);
  }
}

let lastUpdate = null;
let fakeProgressStart = null;
let fakeProgressEnd = null;
let cueInitialSeconds = null;

function formatTime(t) {
  if (!t) return '--:--';
  return String(t);
}

function formatClockDate(d) {
  if (!d) return '--:--:--';
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  return `${hh}:${mm}:${ss}`;
}

function setProgress(percent, colorName) {
  percent = Math.max(0, Math.min(100, percent));
  progressFill.style.width = percent + '%';
  if (progressMarker) {
    progressMarker.style.left = percent + '%';
    // map colorName to a solid color for the arrow
    let c = '#1b8a4a';
    if (colorName === 'red') c = '#d24b4b';
    else if (colorName === 'orange') c = '#ff9f3f';
    else if (typeof colorName === 'string' && colorName.startsWith('#')) c = colorName;
    progressMarker.style.borderBottomColor = c;
  }
}

function parseRemainingToSeconds(rem) {
  if (!rem || typeof rem !== 'string') return null;
  const parts = rem.split(':').reverse();
  let seconds = 0;
  for (let i = 0; i < parts.length; i++) {
    const v = parseFloat(parts[i].replace(',', '.'));
    if (isNaN(v)) return null;
    seconds += v * Math.pow(60, i);
  }
  return seconds;
}

function updateUI(payload) {
  lastUpdate = Date.now();
  artistEl.textContent = payload.currentArtist || 'Ingen';
  nextArtistEl.textContent = payload.nextArtist || 'Ingen neste';
  clockEl.textContent = formatTime(payload.timeRemaining || '--:--');
  // update wall clock (current time)
  if (wallClockEl) wallClockEl.textContent = formatClockDate(new Date());

  // If running, show progress as placeholder animation if no timing info
  if (payload.isRunning) {
    const secs = parseRemainingToSeconds(payload.timeRemaining || '');
    if (secs !== null) {
      // real-time progress based on initial cue length
      if (!cueInitialSeconds || secs > cueInitialSeconds) cueInitialSeconds = secs;
      const pctElapsed = cueInitialSeconds ? (1 - (secs / cueInitialSeconds)) * 100 : 0;
      const pct = Math.max(0, Math.min(100, pctElapsed));
      // decide color name for both fill and marker
      let colorName = 'green';
      if (secs <= 10) colorName = 'red';
      else if (pct >= 75) colorName = 'orange';
      // apply background gradient for fill
      if (colorName === 'red') progressFill.style.background = 'linear-gradient(90deg,#d24b4b,#ff7b7b)';
      else if (colorName === 'orange') progressFill.style.background = 'linear-gradient(90deg,#ff9f3f,#ffbf7a)';
      else progressFill.style.background = 'linear-gradient(90deg,#1b8a4a,#6be07e)';
      setProgress(pct, colorName);
      // compute and show cue finish wall time
      if (cueFinishEl) {
        const finish = new Date(Date.now() + Math.round(secs * 1000));
        const hh = String(finish.getHours()).padStart(2,'0');
        const mm = String(finish.getMinutes()).padStart(2,'0');
        cueFinishEl.textContent = `${hh}:${mm}`;
      }
    } else {
      // start a coarse progress animation if we don't have numeric time
      if (!fakeProgressStart) {
        fakeProgressStart = Date.now();
        fakeProgressEnd = fakeProgressStart + 3 * 60 * 1000; // 3 min default
      }
      const pct = ((Date.now() - fakeProgressStart) / (fakeProgressEnd - fakeProgressStart)) * 100;
      setProgress(pct, 'green');
    }
  } else {
    // stopped - reset fake progress
    fakeProgressStart = null;
    fakeProgressEnd = null;
    setProgress(0, 'green');
    cueInitialSeconds = null;
    // reset to default green gradient
    progressFill.style.background = 'linear-gradient(90deg,#1b8a4a,#6be07e)';
    if (cueFinishEl) cueFinishEl.textContent = '--:--:--';
  }
}

socket.on('connect', () => {
  if (console && console.log) console.log('[CLIENT] connected');
});

// keep wall clock ticking every second
setInterval(() => {
  if (wallClockEl) wallClockEl.textContent = formatClockDate(new Date());
}, 1000);

socket.on('update', (payload) => {
  updateUI(payload);
});

socket.on('admin_message', (msg) => {
  // msg: { text, durationMs, flash, color, bold, uppercase }
  if (!msg || !msg.text) {
    showStageMessage(null);
    return;
  }
  const dur = (msg.durationMs && Number(msg.durationMs)) ? Number(msg.durationMs) : 10000;
  const isFlash = !!msg.flash;
  showStageMessage(msg, isFlash);
  // If this message is a flash-originated message, leave it persistent until
  // an explicit hide; otherwise clear after its duration.
  if (!isFlash) {
    setTimeout(() => { showStageMessage(null); }, dur + 50);
  }
});

socket.on('disconnect', () => {
  if (console && console.log) console.log('[CLIENT] disconnected');
});

// handle admin actions
socket.on('action', (a) => {
  if (!a || !a.type) return;
  if (a.type === 'blackout') {
    const on = !!a.on;
    const overlay = document.getElementById('blackoutOverlay');
    if (overlay) {
      if (on) overlay.classList.add('show'); else overlay.classList.remove('show');
    }
  }
  if (a.type === 'focus') {
    const on = !!a.on;
    isFocused = !!on;
    if (stageTimerRoot) {
      if (isFocused) stageTimerRoot.classList.add('focused'); else stageTimerRoot.classList.remove('focused');
    }
    // if there's a current stage message, update its size
    const curText = stageMessageEl ? stageMessageEl.textContent : '';
    if (curText) {
      showStageMessage({ text: curText, color: stageMessageEl.style.color === 'rgb(27, 138, 74)' ? 'green' : (stageMessageEl.style.color === 'rgb(210, 75, 75)' ? 'red' : 'white'), bold: stageMessageEl.style.fontWeight === '700', uppercase: stageMessageEl.style.textTransform === 'uppercase' }, false);
    }
  }
  if (a.type === 'flash') {
    const dur = a.durationMs || 3000;
    // If flash targets the timer/clock, pulse the clock element
    if (a.target === 'timer' || a.target === 'clock') {
      if (clockEl) {
        clockEl.classList.add('flash-text');
        setTimeout(()=>{ if (clockEl) clockEl.classList.remove('flash-text'); }, dur + 50);
      }
      return;
    }
    // If server provided text, and stage currently empty, show it persistently
    if (a.text) {
      showStageMessage({ text: a.text, color: 'white', bold: false, uppercase: false }, true);
      // do not clear after flash; keep displayed
      return;
    }
    // Otherwise just pulse the existing stage message
    if (stageMessageEl && !stageMessageEl.classList.contains('hidden')) {
      stageMessageEl.classList.add('flash-text');
      setTimeout(()=>{ if (stageMessageEl) stageMessageEl.classList.remove('flash-text'); }, dur + 50);
    }
  }
});

// show stats if needed
socket.on('stats', (s) => {
  // maybe update local small indicator (if present)
  const el = document.getElementById('liveConnections');
  if (el) el.textContent = String((s && s.connections) ? s.connections : 0);
});







/* Laget av Kevin Johnsen :)*/
// client.js - end
// This file is served to the stage display browser and handles real-time updates and UI rendering based on server messages.