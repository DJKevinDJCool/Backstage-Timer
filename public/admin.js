const socket = io();

const messagesContainer = document.getElementById('messagesContainer');
const addMessageBtn = document.getElementById('addMessage');

// Keypad unlock elements
const keypadWrap = document.getElementById('keypadWrap');
const keyDots = document.getElementById('keyDots');
const adminContent = document.getElementById('adminContent');

const CODE = '1706'; // KODE FOR Å KOMME INN!
let entered = '';

function updateDots() {
  const dots = CODE.split('').map((_,i)=> (i < entered.length ? '●' : '○'));
  keyDots.textContent = dots.join(' ');
}

function unlockAdmin() {
  // request server token for entered PIN
  fetch('/admin/unlock', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: entered })
  }).then(r => r.json()).then(j => {
    if (j && j.ok && j.token) {
      sessionStorage.setItem('admin_token', j.token);
      sessionStorage.setItem('admin_unlocked', '1');
      keypadWrap.style.display = 'none';
      adminContent.style.display = 'block';
    } else {
      entered = '';
      updateDots();
      alert('Feil PIN');
    }
  }).catch(() => {
    entered = '';
    updateDots();
    alert('Feil ved tilkobling');
  });
}

function lockAdmin() {
  const token = sessionStorage.getItem('admin_token');
  if (token) {
    fetch('/admin/lock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .finally(() => {
        sessionStorage.removeItem('admin_token');
        sessionStorage.removeItem('admin_unlocked');
        entered = '';
        updateDots();
        keypadWrap.style.display = 'flex';
        adminContent.style.display = 'none';
      });
  } else {
    sessionStorage.removeItem('admin_unlocked');
    entered = '';
    updateDots();
    keypadWrap.style.display = 'flex';
    adminContent.style.display = 'none';
  }
}

// initialize keypad state
if (sessionStorage.getItem('admin_unlocked') === '1') {
  keypadWrap.style.display = 'none';
  adminContent.style.display = 'block';
} else {
  keypadWrap.style.display = 'flex';
  adminContent.style.display = 'none';
}

updateDots();

// keypad event delegation
document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (!t.classList) return;
  if (t.classList.contains('key')) {
    const v = t.textContent.trim();
    if (t.classList.contains('clear')) {
      // backspace
      entered = entered.slice(0, -1);
      updateDots();
      return;
    }
    if (t.classList.contains('ok')) {
      // manual OK: request server unlock with PIN
      unlockAdmin();
      return;
    }
    // digit
    if (entered.length < CODE.length) {
      entered += v;
      updateDots();
        if (entered.length === CODE.length) {
        // auto-submit PIN
        unlockAdmin();
      }
    }
  }
});
// helper to get current token
function getAdminToken() { return sessionStorage.getItem('admin_token'); }

// Dynamic per-message boxes
function createMessageBox(initialText = '') {
  if (!messagesContainer) return null;
  const box = document.createElement('div');
  box.className = 'message-box';
  box.innerHTML = `
    <textarea class="msg-text" placeholder="Skriv melding...">${initialText}</textarea>
    <div class="format-row">
      <div class="format-icon">A</div>
      <div class="format-icon green">A</div>
      <div class="format-icon red">A</div>
      <div class="format-icon">B</div>
      <div class="format-icon">äA</div>
    </div>
    <div class="msg-controls">
      <div style="flex:1"></div>
      <div class="msg-status muted" style="margin-right:auto"></div>
      <button class="toggle-btn small">Show</button>
      <button class="focus-btn small" style="background:#2b2b2b">Focus</button>
      <button class="flash-btn small" style="background:#3b3b3b">Flash</button>
      <button class="delete-btn small" style="background:#6b2b2b">🗑</button>
    </div>
  `;
  messagesContainer.appendChild(box);

  const textarea = box.querySelector('.msg-text');
  const toggle = box.querySelector('.toggle-btn');
  const del = box.querySelector('.delete-btn');
  const formatIcons = box.querySelectorAll('.format-icon');
  const focusBtn = box.querySelector('.focus-btn');
  const flashBtn = box.querySelector('.flash-btn');
  const status = box.querySelector('.msg-status');
  box.dataset.shown = '0';
  box.dataset.focused = '0';

  // format icon handlers: set textarea style and active state
  formatIcons.forEach((ic, idx) => {
    ic.addEventListener('click', () => {
      // clear active on siblings for color icons (0..2)
      if (idx >= 0 && idx <= 2) {
        formatIcons[0].classList.remove('active');
        formatIcons[1].classList.remove('active');
        formatIcons[2].classList.remove('active');
        ic.classList.add('active');
        if (idx === 0) textarea.style.color = '#ffffff';
        if (idx === 1) textarea.style.color = '#1b8a4a';
        if (idx === 2) textarea.style.color = '#d24b4b';
      }
      // bold toggle (idx 3)
      if (idx === 3) {
        const isBold = textarea.style.fontWeight === '700' || textarea.style.fontWeight === 'bold';
        textarea.style.fontWeight = isBold ? '400' : '700';
        ic.classList.toggle('active', !isBold);
      }
      // uppercase toggle (idx 4)
      if (idx === 4) {
        const isUp = textarea.style.textTransform === 'uppercase';
        textarea.style.textTransform = isUp ? 'none' : 'uppercase';
        ic.classList.toggle('active', !isUp);
      }
    });
  });

  toggle.addEventListener('click', () => {
    const token = getAdminToken();
    if (box.dataset.shown === '1') {
      // send clear with default formatting
      socket.emit('admin_message', { text: '', durationMs: 0, flash: false, color: 'white', bold: false, uppercase: false, token }, (ack) => {
        if (ack && ack.ok) {
          box.dataset.shown = '0';
          toggle.textContent = 'Show';
          status.textContent = 'Hidden';
          setTimeout(() => { status.textContent = ''; }, 900);
        } else {
          status.textContent = 'Auth error';
          if (ack && ack.error === 'unauthorized') lockAdmin();
        }
      });
    } else {
      const text = textarea.value.trim();
      if (!text) { status.textContent = 'Tom melding'; setTimeout(()=>status.textContent='',1000); return; }
      const longMs = 24 * 60 * 60 * 1000; // keep visible for 1 day
      // derive formatting from textarea styles
      let color = 'white';
      const comp = window.getComputedStyle(textarea).color || '';
      if (comp.indexOf('rgb(') === 0) {
        if (comp.includes('27, 138, 74') || comp.includes('27,138,74') || comp.includes('27,138')) color = 'green';
        else if (comp.includes('210, 75, 75') || comp.includes('210,75,75') || comp.includes('210,75')) color = 'red';
      }
      const bold = (textarea.style.fontWeight === '700' || textarea.style.fontWeight === 'bold');
      const uppercase = (textarea.style.textTransform === 'uppercase');
      socket.emit('admin_message', { text, durationMs: longMs, flash: false, color, bold, uppercase, token }, (ack) => {
        if (ack && ack.ok) {
          box.dataset.shown = '1';
          toggle.textContent = 'Hide';
          status.textContent = 'Shown';
          setTimeout(()=>status.textContent='',1200);
          // ensure only one message shown at a time in the admin UI
          document.querySelectorAll('.message-box').forEach((b) => {
            if (b !== box) {
              b.dataset.shown = '0';
              const tb = b.querySelector('.toggle-btn');
              if (tb) tb.textContent = 'Show';
              const fb = b.querySelector('.focus-btn');
              if (fb) fb.dataset.focused = '0';
            }
          });
        } else {
          status.textContent = 'Auth error';
          if (ack && ack.error === 'unauthorized') lockAdmin();
        }
      });
    }
  });

  del.addEventListener('click', () => {
    if (box.dataset.shown === '1') {
      const token = getAdminToken();
      socket.emit('admin_message', { text: '', durationMs: 0, flash: false, color: 'white', bold: false, uppercase: false, token }, ()=>{});
    }
    box.remove();
  });

  // per-box focus button: show message and toggle full-screen focus
  if (focusBtn) {
    focusBtn.addEventListener('click', () => {
      const token = getAdminToken();
      const text = textarea.value.trim();
      if (!text) { status.textContent = 'Tom melding'; setTimeout(()=>status.textContent='',1000); return; }
      if (box.dataset.focused === '1') {
        socket.emit('admin_action', { type:'focus', on:false, token }, (ack)=>{
          if (!(ack && ack.ok)) { status.textContent = 'Ikke autorisert'; if (ack && ack.error === 'unauthorized') lockAdmin(); }
          else { box.dataset.focused = '0'; focusBtn.textContent = 'Focus'; status.textContent = 'Unfocused'; setTimeout(()=>status.textContent='',800); }
        });
        return;
      }
      // Ensure message is shown with formatting
      // derive formatting from textarea styles
      let color = 'white';
      const comp = window.getComputedStyle(textarea).color || '';
      if (comp.indexOf('rgb(') === 0) {
        if (comp.includes('27, 138, 74') || comp.includes('27,138,74') || comp.includes('27,138')) color = 'green';
        else if (comp.includes('210, 75, 75') || comp.includes('210,75,75') || comp.includes('210,75')) color = 'red';
      }
      const bold = (textarea.style.fontWeight === '700' || textarea.style.fontWeight === 'bold');
      const uppercase = (textarea.style.textTransform === 'uppercase');
      const longMs = 24 * 60 * 60 * 1000;
      socket.emit('admin_message', { text, durationMs: longMs, flash: false, color, bold, uppercase, token }, (ack)=>{
        if (!(ack && ack.ok)) { status.textContent = 'Ikke autorisert'; if (ack && ack.error === 'unauthorized') lockAdmin(); return; }
        // turn on focus overlay
        socket.emit('admin_action', { type:'focus', on:true, token }, (ack2)=>{
          if (!(ack2 && ack2.ok)) { status.textContent = 'Ikke autorisert'; if (ack2 && ack2.error === 'unauthorized') lockAdmin(); return; }
          box.dataset.focused = '1'; focusBtn.textContent = 'Unfocus'; status.textContent = 'Focused'; setTimeout(()=>status.textContent='',900);
        });
      });
    });
  }

  // per-box flash button: flash the text prominently
  if (flashBtn) {
    flashBtn.addEventListener('click', ()=>{
      const token = getAdminToken();
      const text = textarea.value.trim();
      if (!text) { status.textContent = 'Tom melding'; setTimeout(()=>status.textContent='',1000); return; }
      // send admin_action flash which the server will broadcast as flash
      socket.emit('admin_action', { type:'flash', text, durationMs:3000, token }, (ack)=>{
        if (!(ack && ack.ok)) { status.textContent = 'Ikke autorisert'; if (ack && ack.error === 'unauthorized') lockAdmin(); }
        else { status.textContent = 'Flashed'; setTimeout(()=>status.textContent='',900); }
      });
    });
  }

  return box;
}

// Add-message button
if (addMessageBtn) {
  addMessageBtn.addEventListener('click', ()=>{ createMessageBox(''); });
}

// initialize with one box
if (messagesContainer && messagesContainer.children.length === 0) createMessageBox('');

// Lock button handler
const lockBtn = document.getElementById('lock');
if (lockBtn) {
  lockBtn.addEventListener('click', () => {
    lockAdmin();
  });
}

// Presets management
const presetsKey = 'stage_admin_presets_v1';
const presetsListEl = document.getElementById('presetsList');

function loadPresets() {
  try {
    const raw = localStorage.getItem(presetsKey);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function savePresets(arr) {
  localStorage.setItem(presetsKey, JSON.stringify(arr));
}

function renderPresets() {
  const list = loadPresets();
  presetsListEl.innerHTML = '';
  if (!list.length) {
    presetsListEl.innerHTML = '<div class="presets-empty">No presets yet</div>';
    return;
  }
  list.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'preset-card';
    div.innerHTML = `
      <div class="preset-text">${escapeHtml(p.text)}</div>
      <div class="preset-controls">
        <button class="preset-show" data-idx="${idx}">Show</button>
        <button class="preset-load" data-idx="${idx}">Load</button>
        <button class="preset-delete" data-idx="${idx}">Delete</button>
      </div>
    `;
    presetsListEl.appendChild(div);
  });
}

function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function addPreset(text, duration, flash) {
  const list = loadPresets();
  list.unshift({ text, duration, flash });
  savePresets(list);
  renderPresets();
}

function deletePreset(idx) {
  const list = loadPresets();
  if (idx < 0 || idx >= list.length) return;
  list.splice(idx,1);
  savePresets(list);
  renderPresets();
}

function loadPresetToEditor(idx) {
  const list = loadPresets();
  if (idx < 0 || idx >= list.length) return;
  const p = list[idx];
  const box = createMessageBox(p.text || '');
}

function showPreset(idx) {
  const token = getAdminToken();
  const list = loadPresets();
  if (idx < 0 || idx >= list.length) return;
  const p = list[idx];
  socket.emit('admin_message', { text: p.text, durationMs: (p.duration||10)*1000, flash: false, color: 'white', bold: false, uppercase: false, token }, (ack) => {
    if (!(ack && ack.ok)) {
      console.warn('Unauthorized');
      if (ack && ack.error === 'unauthorized') lockAdmin();
    } else {
      console.log('Preset shown');
    }
  });
}

// wire preset events
document.addEventListener('click', (ev)=>{
  const t = ev.target;
  if (t.classList && t.classList.contains('preset-delete')) {
    const idx = Number(t.getAttribute('data-idx'));
    deletePreset(idx);
  } else if (t.classList && t.classList.contains('preset-load')) {
    const idx = Number(t.getAttribute('data-idx'));
    loadPresetToEditor(idx);
  } else if (t.classList && t.classList.contains('preset-show')) {
    const idx = Number(t.getAttribute('data-idx'));
    showPreset(idx);
  }
});

renderPresets();

// Handle stats (connections)
const connCountEl = document.getElementById('connCount');
socket.on('stats', (s) => {
  if (connCountEl) connCountEl.textContent = String((s && s.connections) ? s.connections - 2 : 0);
});

// Timeline / mini progress handling
const miniFill = document.getElementById('miniFill');
const timelineLabels = document.querySelector('.timeline-labels');
let cueInitialSeconds = null;
const nowClockDisplay = document.getElementById('nowClockDisplay');
const adminCueFinish = document.getElementById('cueFinishTime');

function formatClockDate(d) {
  if (!d) return '--:--:--';
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  return `${hh}:${mm}:${ss}`;
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

// render timeline labels positioned according to total cue seconds
function renderTimelineLabels(totalSeconds) {
  if (!timelineLabels) return;
  timelineLabels.innerHTML = '';
  if (!totalSeconds || totalSeconds <= 0) return;
  // choose a sensible max number of labels (avoid clutter)
  const maxLabels = Math.min(8, Math.ceil(totalSeconds / 60));
  const startMin = Math.ceil(totalSeconds / 60);
  const labelsCount = Math.min(maxLabels, startMin);
  if (labelsCount <= 0) return;
  for (let j = 0; j < labelsCount; j++) {
    // spread labels evenly across the bar (left from 0%..100%)
    const left = (labelsCount === 1) ? 0 : (j / (labelsCount - 1)) * 100;
    // compute minute label descending from startMin to 1
    const minute = Math.max(1, Math.ceil((startMin * (labelsCount - j)) / labelsCount));
    const span = document.createElement('span');
    span.className = 'timeline-label';
    span.style.left = left + '%';
    span.textContent = `${minute}:00`;
    timelineLabels.appendChild(span);
  }
}

function updateMiniProgress(payload) {
  if (!miniFill) return;
  const rem = payload.timeRemaining || '';
  const secs = parseRemainingToSeconds(rem);
  if (payload.isRunning && secs !== null) {
    // if we don't have an initial cue length, set it to the first seen remaining
    if (!cueInitialSeconds || secs > cueInitialSeconds) {
      cueInitialSeconds = secs;
      // update timeline labels to show minutes markers
      if (timelineLabels && cueInitialSeconds >= 30) {
        renderTimelineLabels(cueInitialSeconds);
      }
    }
    const pctElapsed = cueInitialSeconds ? (1 - (secs / cueInitialSeconds)) * 100 : 0;
    const pct = Math.max(0, Math.min(100, pctElapsed));
    miniFill.style.width = pct + '%';

    // color rules: red when <=10s, orange when mostly elapsed, green otherwise
    if (secs <= 10) {
      miniFill.style.background = 'linear-gradient(90deg,#d24b4b,#ff7b7b)';
    } else if (pct >= 75) {
      miniFill.style.background = 'linear-gradient(90deg,#ff9f3f,#ffbf7a)';
    } else {
      miniFill.style.background = 'linear-gradient(90deg,#1b8a4a,#6be07e)';
    }
    // update wall clock and cue finish display
    if (nowClockDisplay) nowClockDisplay.textContent = formatClockDate(new Date());
    if (adminCueFinish) {
      const finish = new Date(Date.now() + Math.round(secs * 1000));
      adminCueFinish.textContent = formatClockDate(finish);
    }
  } else {
    // not running: reset or show full/empty accordingly
    if (!payload.isRunning) {
      miniFill.style.width = '0%';
      cueInitialSeconds = null;
      // reset label to sensible default (10..1) positioned evenly
      if (timelineLabels) renderTimelineLabels(10 * 60);
      if (nowClockDisplay) nowClockDisplay.textContent = formatClockDate(new Date());
      if (adminCueFinish) adminCueFinish.textContent = '--:--:--';
    }
  }
}

socket.on('update', (payload) => { updateMiniProgress(payload); });

// wire blackout/focus/flash buttons
const blackoutBtn = document.getElementById('blackoutBtn');
let isBlackout = false;
if (blackoutBtn) {
  const updateBtn = (on) => {
    blackoutBtn.textContent = on ? 'Unblackout' : 'Blackout';
    blackoutBtn.classList.toggle('active', !!on);
  };
  updateBtn(isBlackout);

  blackoutBtn.addEventListener('click', ()=>{
    const token = getAdminToken();
    const newOn = !isBlackout;
    socket.emit('admin_action', { type:'blackout', on: newOn, token }, (ack)=>{
      if (!(ack && ack.ok)) { console.warn('Blackout: not authorized'); if (ack && ack.error === 'unauthorized') lockAdmin(); }
      else {
        isBlackout = !!newOn;
        updateBtn(isBlackout);
      }
    });
  });

  // keep button in sync with server-broadcasted actions
  socket.on('action', (a) => {
    if (a && a.type === 'blackout') {
      isBlackout = !!a.on;
      updateBtn(isBlackout);
    }
  });
}

// Flash timer button: pulses the main clock on display
const flashTimerBtn = document.getElementById('flashTimerBtn');
if (flashTimerBtn) {
  flashTimerBtn.addEventListener('click', ()=>{
    const token = getAdminToken();
    const dur = 3000;
    socket.emit('admin_action', { type:'flash', target:'timer', durationMs: dur, token }, (ack)=>{
      if (!(ack && ack.ok)) { console.warn('Flash timer: not authorized'); if (ack && ack.error === 'unauthorized') lockAdmin(); }
      else { flashTimerBtn.classList.add('active'); setTimeout(()=>flashTimerBtn.classList.remove('active'), 600); }
    });
  });
}

socket.on('connect', () => {
  console.log('admin connected');
});

// keep admin wall clock ticking every second
setInterval(() => {
  if (nowClockDisplay) nowClockDisplay.textContent = formatClockDate(new Date());
}, 1000);

// (messages handled via dynamic boxes)

// --- GO-knapp ---
const goButton = document.getElementById("goButton");
const goCounter = document.getElementById("go-knapp");
let clickCount = 0;

if(goButton) {
  goButton.addEventListener("click", () => {


    // send /go til serveren
    fetch("/go")
      .then(res => res.json())
      .then(data => console.log("OSC /go sendt!", data))
      .catch(err => console.error("Feil med /go:", err));
  });
}

// --- STOP-knapp ---
const stopButton = document.getElementById("stopButton");
if(stopButton) {
  stopButton.addEventListener("click", () => {
    fetch("/stop")
      .then(res => res.json())
      .then(data => console.log("OSC /cue/stop sendt!", data))
      .catch(err => console.error("Feil med /stop:", err));
  });
}

document.getElementById("fadeall").addEventListener("click", () => {
  fetch("/fadeall")  // endpoint på serveren din
    .then(res => res.json())
    .then(data => {
      if (data.ok) {
        console.log("[OSC SENT] /fadeall");
        
      } else {
        console.error("Noe gikk galt");
      }
    })
    .catch(err => console.error("Feil ved sending:", err));
});
document.getElementById("restartButton").addEventListener("click", () => {
  fetch("/restart");
});

//pause knapp!
const pauseBtn = document.getElementById("pauseButton");
let isPaused = false;

pauseBtn.addEventListener("click", () => {
  fetch("/pause")
    .then(res => res.json())
    .then(data => {
      if (data.ok) {
        isPaused = !isPaused;
        pauseBtn.textContent = isPaused ? "Play▶️" : "Pause⏸️"; // Play vs Pause ikon
        console.log("[OSC SENT] /cue/active/pausetoggle, isPaused =", isPaused);
      } else {
        console.error("Noe gikk galt");
      }
    })
    .catch(err => console.error("Feil ved sending:", err));
});

// Sett default ikon
pauseBtn.textContent = "⏸️";

document.getElementById("oppButton").addEventListener("click", () => {
  fetch("/cue/previous");
});
document.getElementById("nedButton").addEventListener("click", () => {
  fetch("/cue/next");
});
document.getElementById("minus10Button").addEventListener("click", () => {
  fetch("/cue/active/jumpback");
});
document.getElementById("plus10Button").addEventListener("click", () => {
  fetch("/cue/active/jumpfwd");
});
document.getElementById("jumpendButton").addEventListener("click", () => {
  fetch("/cue/active/jumpend");
});



/* Laget av Kevin Johnsen :)*/


// This file is served to the admin page and handles admin interactions, sending commands to the server, and updating the UI based on server responses and broadcasts.

// admin.js end