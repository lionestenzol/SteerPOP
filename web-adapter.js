/**
 * SteerPop Web Adapter v0.4 — Layer Model
 * Thin browser shell — owns DOM, canvas, text field, events.
 * Reads engine render model + events. Engine owns decisions.
 *
 * @module web-adapter
 */

import { SteerPopEngine } from './steerpop-engine.js';
import { GestureDB } from './gesture-db.js';

// ─────────────────────────────────────────────────────────────
// KEYBOARD LAYOUT
// ─────────────────────────────────────────────────────────────

const ROWS = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M'],
  ['.', ',', "'", '⌫'],
  ['SPACE'],
];

// Keys excluded from slide candidates (tap-only)
const EXCLUDED_KEYS = new Set(['.', ',', "'", '⌫', 'SPACE']);

// ─────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────

const engine = new SteerPopEngine();
const gestureDB = new GestureDB();
gestureDB.open().catch(err => console.warn('GestureDB init failed:', err));

// DOM refs
const kbWrap     = document.getElementById('keyboard-wrap');
const canvas     = document.getElementById('halo-canvas');
const ctx        = canvas.getContext('2d');
const outputEl   = document.getElementById('output-text');
const flashEl    = document.getElementById('commit-flash');
const clearBtn   = document.getElementById('btn-clear');
const eventLogEl = document.getElementById('event-log');

// Debug elements
const dbg = {
  session:    document.getElementById('dbg-session'),
  anchor:     document.getElementById('dbg-anchor'),
  target:     document.getElementById('dbg-target'),
  dist:       document.getElementById('dbg-dist'),
  flickstate: document.getElementById('dbg-flickstate'),
  angle:      document.getElementById('dbg-angle'),
  speed:      document.getElementById('dbg-speed'),
  candcount:  document.getElementById('dbg-candcount'),
  last:       document.getElementById('dbg-last'),
  suggest:    document.getElementById('dbg-suggest'),
  row:        document.getElementById('dbg-row'),
  swipedir:   document.getElementById('dbg-swipedir'),
  confidence: document.getElementById('dbg-confidence'),
  confzone:   document.getElementById('dbg-confzone'),
};

// Adapter-owned state
let outputText = '';
let lastCommitLabel = null;
let activePointerId = null;       // tracks primary touch to reject multi-touch
let sessionTimeoutId = null;      // auto-end session after inactivity
const SESSION_TIMEOUT_MS = 3000;  // 3 seconds of no movement

// UI display config
const ui = {
  bubbleSize:       36,
  haloOffset:       90,
  showTopBubble:    true,
  showHighlights:   true,
  showSuggest:      false,
  showDebugLabels:  false,
  fingerRadius:     22,  // simulated fingertip radius
};

// ── Finger cursor overlay ────────────────────────────────────
const fingerEl = document.createElement('div');
fingerEl.id = 'finger-cursor';
Object.assign(fingerEl.style, {
  position: 'fixed',
  width: '44px', height: '44px',
  borderRadius: '50%',
  border: '2px solid rgba(0,212,255,0.6)',
  background: 'rgba(0,212,255,0.08)',
  pointerEvents: 'none',
  zIndex: '10000',
  display: 'none',
  transform: 'translate(-50%, -50%)',
  transition: 'border-color 0.1s, background 0.1s',
  boxShadow: '0 0 12px rgba(0,212,255,0.15)',
});
document.body.appendChild(fingerEl);

// Track raw screen position for the cursor
let fingerScreenX = 0;
let fingerScreenY = 0;
let fingerVisible = false;

function updateFingerCursor(screenX, screenY, active) {
  fingerScreenX = screenX;
  fingerScreenY = screenY;
  fingerVisible = active;
  fingerEl.style.display = active ? 'block' : 'none';
  fingerEl.style.left = screenX + 'px';
  fingerEl.style.top = screenY + 'px';
  fingerEl.style.width = (ui.fingerRadius * 2) + 'px';
  fingerEl.style.height = (ui.fingerRadius * 2) + 'px';
}

function setFingerState(state) {
  // state: 'idle' | 'sliding' | 'flick' | 'cooldown'
  switch (state) {
    case 'sliding':
      fingerEl.style.borderColor = 'rgba(0,212,255,0.7)';
      fingerEl.style.background = 'rgba(0,212,255,0.1)';
      break;
    case 'flick':
      fingerEl.style.borderColor = 'rgba(0,255,170,0.9)';
      fingerEl.style.background = 'rgba(0,255,170,0.15)';
      break;
    case 'cooldown':
      fingerEl.style.borderColor = 'rgba(255,183,0,0.7)';
      fingerEl.style.background = 'rgba(255,183,0,0.08)';
      break;
    default:
      fingerEl.style.borderColor = 'rgba(0,212,255,0.4)';
      fingerEl.style.background = 'rgba(0,212,255,0.05)';
  }
}

// Key DOM map
const keyEls = {};

// ─────────────────────────────────────────────────────────────
// BUILD KEYBOARD DOM
// ─────────────────────────────────────────────────────────────

ROWS.forEach((row, ri) => {
  const rowEl = document.getElementById(`row-${ri}`);
  row.forEach(letter => {
    const el = document.createElement('div');
    el.className = 'key';
    if (letter === 'SPACE') {
      el.classList.add('key-space');
      el.textContent = 'space';
      el.setAttribute('aria-label', 'space');
    } else if (letter === '⌫') {
      el.classList.add('key-backspace');
      el.textContent = '⌫';
      el.setAttribute('aria-label', 'backspace');
    } else if (['.', ',', "'"].includes(letter)) {
      el.classList.add('key-punct');
      el.textContent = letter;
      el.setAttribute('aria-label', letter === '.' ? 'period' : letter === ',' ? 'comma' : 'apostrophe');
    } else {
      el.textContent = letter;
      el.setAttribute('aria-label', `letter ${letter}`);
    }
    el.setAttribute('role', 'button');
    el.dataset.key = letter;
    rowEl.appendChild(el);
    keyEls[letter] = el;
  });
});

// ─────────────────────────────────────────────────────────────
// GEOMETRY
// ─────────────────────────────────────────────────────────────

function computeGeometry() {
  const wrapRect = kbWrap.getBoundingClientRect();
  const keys = [];
  ROWS.forEach((row, ri) => {
    row.forEach((letter, ci) => {
      const el = keyEls[letter];
      const r  = el.getBoundingClientRect();
      keys.push({
        id: letter, label: letter, row: ri, col: ci,
        centerX: r.left - wrapRect.left + r.width / 2,
        centerY: r.top  - wrapRect.top  + r.height / 2,
        width: r.width, height: r.height, excluded: EXCLUDED_KEYS.has(letter),
      });
    });
  });
  engine.setGeometry(keys);
}

// ─────────────────────────────────────────────────────────────
// CANVAS
// ─────────────────────────────────────────────────────────────

let canvasTopOffset = 140;
let canvasSidePad   = 20;

function resizeCanvas() {
  // Read actual CSS-applied offsets from the canvas element
  const cs = getComputedStyle(canvas);
  canvasTopOffset = Math.abs(parseFloat(cs.top)) || 140;
  canvasSidePad   = Math.abs(parseFloat(cs.left)) || 20;

  canvas.width  = kbWrap.offsetWidth  + canvasSidePad * 2;
  canvas.height = kbWrap.offsetHeight + canvasTopOffset + 20;
}

function wrapToCanvas(x, y) {
  return { cx: x + canvasSidePad, cy: y + canvasTopOffset };
}

// ─────────────────────────────────────────────────────────────
// POINTER EVENTS
// ─────────────────────────────────────────────────────────────

function toWrapCoords(e) {
  const rect = kbWrap.getBoundingClientRect();
  const src  = e.touches && e.touches.length > 0
    ? e.touches[0]
    : e.changedTouches && e.changedTouches.length > 0
      ? e.changedTouches[0]
      : e;
  return { x: src.clientX - rect.left, y: src.clientY - rect.top };
}

function getPointerId(e) {
  if (e.touches && e.touches.length > 0) return e.touches[0].identifier;
  if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].identifier;
  return 'mouse';
}

function resetSessionTimeout() {
  if (sessionTimeoutId) clearTimeout(sessionTimeoutId);
  sessionTimeoutId = setTimeout(() => {
    if (engine.getState().active) {
      engine.endSession(performance.now());
      updateFingerCursor(0, 0, false);
      activePointerId = null;
    }
  }, SESSION_TIMEOUT_MS);
}

function clearSessionTimeout() {
  if (sessionTimeoutId) {
    clearTimeout(sessionTimeoutId);
    sessionTimeoutId = null;
  }
}

function onPointerDown(e) {
  e.preventDefault();
  const pid = getPointerId(e);

  // Multi-touch rejection: if a session is active with a different pointer, ignore
  if (activePointerId !== null && activePointerId !== pid) return;

  activePointerId = pid;
  const { x, y } = toWrapCoords(e);
  const src = e.touches ? e.touches[0] : e;
  updateFingerCursor(src.clientX, src.clientY, true);
  setFingerState('sliding');
  engine.pointerDown({ x, y, timestamp: performance.now() });
  resetSessionTimeout();
}

function onPointerMove(e) {
  e.preventDefault();
  const src = e.touches ? e.touches[0] : e;

  // Multi-touch rejection
  const pid = getPointerId(e);
  if (activePointerId !== null && activePointerId !== pid) return;

  if (!engine.getState().active) {
    updateFingerCursor(src.clientX, src.clientY, true);
    setFingerState('idle');
    return;
  }
  const { x, y } = toWrapCoords(e);
  updateFingerCursor(src.clientX, src.clientY, true);
  engine.pointerMove({ x, y, timestamp: performance.now() });
  resetSessionTimeout();

  const s = engine.getState();
  setFingerState(s.flickState);
}

function onPointerUp(e) {
  // Multi-touch rejection: only the primary pointer can end the session
  const pid = getPointerId(e);
  if (activePointerId !== null && activePointerId !== pid) return;

  updateFingerCursor(fingerScreenX, fingerScreenY, false);
  activePointerId = null;
  clearSessionTimeout();
  if (!engine.getState().active) return;
  if (e) e.preventDefault();
  const coords = e && (e.touches || e.clientX !== undefined)
    ? toWrapCoords(e)
    : { x: 0, y: 0 };
  engine.pointerUp({ x: coords.x, y: coords.y, timestamp: performance.now() });
}

kbWrap.addEventListener('mousedown',  onPointerDown, { passive: false });
kbWrap.addEventListener('mousemove',  onPointerMove, { passive: false });
kbWrap.addEventListener('mouseup',    onPointerUp,   { passive: false });
kbWrap.addEventListener('mouseleave', (e) => {
  updateFingerCursor(0, 0, false);
  // Don't end session on mouseleave — user may flick above the keyboard
  // and return to continue sliding. Only pointerUp ends the session.
}, { passive: false });
kbWrap.addEventListener('touchstart',  onPointerDown, { passive: false });
kbWrap.addEventListener('touchmove',   onPointerMove, { passive: false });
kbWrap.addEventListener('touchend',    onPointerUp,   { passive: false });
kbWrap.addEventListener('touchcancel', onPointerUp,   { passive: false });
document.addEventListener('mouseup', onPointerUp);
document.addEventListener('mousemove', onPointerMove, { passive: false });

// ─────────────────────────────────────────────────────────────
// EVENT PROCESSING
// ─────────────────────────────────────────────────────────────

function processEvents() {
  const events = engine.consumeEvents();
  for (const ev of events) {
    switch (ev.type) {
      case 'letter_committed':
        if (ev.label === '⌫') {
          if (outputText.length > 0) {
            outputText = outputText.slice(0, -1);
          }
          lastCommitLabel = '⌫';
          logEvent(ev.type, '⌫ (backspace)', 'ev-commit');
        } else if (ev.label === 'SPACE') {
          outputText += ' ';
          lastCommitLabel = '␣';
          logEvent(ev.type, '␣ (space)', 'ev-commit');
        } else {
          outputText += ev.label;
          lastCommitLabel = ev.label;
          logEvent(ev.type, `${ev.label} (${ev.commitType})`, 'ev-commit');
        }
        engine.setTextContext(outputText);
        flash();
        break;

      case 'flick_confirmed':
        logEvent(ev.type, ev.label, 'ev-armed');
        break;

      // TODO: dead code — engine never emits suggestion_committed.
      // Will be replaced by word_committed in vector layer.
      case 'suggestion_committed':
        const already = outputText.slice(-2).toLowerCase();
        const word = ev.word;
        const rest = word.startsWith(already) ? word.slice(already.length) : word;
        outputText += rest + ' ';
        lastCommitLabel = '[' + word + ']';
        engine.setTextContext(outputText);
        flash();
        logEvent(ev.type, word, 'ev-commit');
        break;

      case 'target_changed':
        logEvent(ev.type, ev.target || '', 'ev-info');
        break;

      case 'session_started':
        logEvent(ev.type, ev.anchorKey, 'ev-info');
        break;

      case 'session_ended':
        logEvent(ev.type, '', 'ev-info');
        // Gesture capture: save trace to IndexedDB if quality threshold met
        if (ev.gestureKeySequence && ev.gestureKeySequence.length >= 3 && ev.commitVectors && ev.commitVectors.length >= 2) {
          const word = ev.gestureKeySequence.join('').toLowerCase();
          const normalized = SteerPopEngine.normalizeCommitTrace(ev.commitVectors);
          gestureDB.saveTrace(word, normalized).catch(err =>
            console.warn('Failed to save gesture trace:', err)
          );
        }
        break;
    }
  }
  outputEl.textContent = outputText;
}

function flash() {
  flashEl.classList.add('flash');
  setTimeout(() => flashEl.classList.remove('flash'), 90);
}

function logEvent(type, detail, cls) {
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = `${type}${detail ? ' \u2192 ' + detail : ''}`;
  eventLogEl.appendChild(line);
  eventLogEl.scrollTop = eventLogEl.scrollHeight;
  while (eventLogEl.childElementCount > 60) {
    eventLogEl.removeChild(eventLogEl.firstChild);
  }
}

// ─────────────────────────────────────────────────────────────
// KEY HIGHLIGHTING
// ─────────────────────────────────────────────────────────────

let prevHighlighted = [];

function updateKeyHighlights(model) {
  // Clear previous highlights
  for (const id of prevHighlighted) {
    if (keyEls[id]) {
      keyEls[id].classList.remove('highlight', 'highlight-top', 'anchor-active');
      keyEls[id].style.opacity = '';
    }
  }
  prevHighlighted = [];

  if (!model.sessionActive) return;

  // Anchor highlight
  const anchorId = model.debugValues.anchor;
  if (anchorId && anchorId !== '\u2014' && keyEls[anchorId]) {
    keyEls[anchorId].classList.add('anchor-active');
    prevHighlighted.push(anchorId);
  }

  if (!ui.showHighlights) return;

  // Candidate highlights (confidence modulates top-candidate intensity)
  const conf = model.confidence || 0;
  for (const h of model.keyHighlights) {
    if (!keyEls[h.id]) continue;
    if (h.isTop) {
      keyEls[h.id].classList.add('highlight-top');
      // Dim top candidate when confidence is low
      if (conf < 0.3) {
        keyEls[h.id].style.opacity = 0.5;
      }
    } else {
      keyEls[h.id].classList.add('highlight');
      keyEls[h.id].style.opacity = Math.max(0.3, h.brightness);
    }
    prevHighlighted.push(h.id);
  }
}

// ─────────────────────────────────────────────────────────────
// KEY WARP (visual pull toward pointer)
// ─────────────────────────────────────────────────────────────

let prevWarped = [];

function updateKeyWarp() {
  // Reset previous warps
  for (const id of prevWarped) {
    if (keyEls[id]) {
      keyEls[id].style.transform = '';
    }
  }
  prevWarped = [];

  const warpData = engine.getWarpedPositions();
  if (!warpData || warpData.length === 0) return;

  for (const w of warpData) {
    if (!keyEls[w.id]) continue;
    if (Math.abs(w.offsetX) < 0.5 && Math.abs(w.offsetY) < 0.5) continue;
    keyEls[w.id].style.transform = `translate(${w.offsetX.toFixed(1)}px, ${w.offsetY.toFixed(1)}px)`;
    prevWarped.push(w.id);
  }
}

// ─────────────────────────────────────────────────────────────
// DEBUG PANEL
// ─────────────────────────────────────────────────────────────

function updateDebug(model) {
  const dv = model.debugValues;
  dbg.session.textContent   = dv.session;
  dbg.anchor.textContent    = dv.anchor;
  dbg.target.textContent    = dv.topTarget;
  dbg.dist.textContent      = `${dv.distance} px`;
  dbg.last.textContent      = lastCommitLabel || '\u2014';
  dbg.suggest.textContent   = dv.suggestion;
  dbg.flickstate.textContent = dv.flickState;
  dbg.flickstate.className  = `d-value ${
    dv.flickState === 'COOLDOWN' ? 'd-armed' : 'd-muted'
  }`;
  dbg.angle.textContent     = dv.swipeAngle;
  dbg.speed.textContent     = dv.speed;
  dbg.candcount.textContent = dv.candidates;
  if (dbg.row)      dbg.row.textContent      = dv.activeRow || '\u2014';
  if (dbg.swipedir) dbg.swipedir.textContent = dv.swipeDir || '\u2014';
  if (dbg.confidence) {
    dbg.confidence.textContent = model.confidence !== undefined
      ? model.confidence.toFixed(2) : '0';
  }
  if (dbg.confzone) {
    const zone = model.confidenceZone || 'none';
    dbg.confzone.textContent = zone;
    dbg.confzone.className = `d-value ${
      zone === 'hot' ? 'd-accent' : zone === 'warm' ? 'd-armed' : 'd-muted'
    }`;
  }
}

// ─────────────────────────────────────────────────────────────
// RENDERING
// ─────────────────────────────────────────────────────────────

function render() {
  processEvents();

  const model = engine.getRenderModel();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateDebug(model);
  updateKeyHighlights(model);
  updateKeyWarp();

  if (!model.sessionActive) {
    requestAnimationFrame(render);
    return;
  }

  const ac = wrapToCanvas(model.anchorMarker.x, model.anchorMarker.y);
  const pc = wrapToCanvas(model.pointerMarker.x, model.pointerMarker.y);

  // ── Deadzone circle ──────────────────────────────────────
  ctx.beginPath();
  ctx.arc(ac.cx, ac.cy, engine.cfg.deadzoneRadius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Connector line ──────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(ac.cx, ac.cy);
  ctx.lineTo(pc.cx, pc.cy);
  ctx.strokeStyle = 'rgba(0,212,255,0.3)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // ── Swipe direction indicator (cone) ────────────────────
  const dv = model.debugValues;
  if (dv.swipeAngle && dv.swipeAngle !== '\u2014') {
    const angleRad = parseFloat(dv.swipeAngle) * Math.PI / 180;
    const spreadRad = (engine.cfg.candidateAngleSpread / 2) * Math.PI / 180;
    const coneLen = 50;

    ctx.beginPath();
    ctx.moveTo(ac.cx, ac.cy);
    ctx.lineTo(
      ac.cx + Math.cos(angleRad - spreadRad) * coneLen,
      ac.cy + Math.sin(angleRad - spreadRad) * coneLen
    );
    ctx.moveTo(ac.cx, ac.cy);
    ctx.lineTo(
      ac.cx + Math.cos(angleRad + spreadRad) * coneLen,
      ac.cy + Math.sin(angleRad + spreadRad) * coneLen
    );
    ctx.strokeStyle = 'rgba(0,212,255,0.12)';
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // Cone arc
    ctx.beginPath();
    ctx.arc(ac.cx, ac.cy, coneLen, angleRad - spreadRad, angleRad + spreadRad);
    ctx.strokeStyle = 'rgba(0,212,255,0.08)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  // ── Top candidate bubble (floating above anchor) ────────
  if (ui.showTopBubble && model.topCandidate && model.anchorMarker) {
    const tc = model.topCandidate;
    const bc = wrapToCanvas(model.anchorMarker.x, model.anchorMarker.y - ui.haloOffset);
    const r = ui.bubbleSize * 1.4;

    // Glow
    const grd = ctx.createRadialGradient(bc.cx, bc.cy, r * 0.3, bc.cx, bc.cy, r * 2);
    grd.addColorStop(0, 'rgba(0,255,170,0.25)');
    grd.addColorStop(1, 'rgba(0,255,170,0)');
    ctx.beginPath();
    ctx.arc(bc.cx, bc.cy, r * 2, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Fill
    ctx.beginPath();
    ctx.arc(bc.cx, bc.cy, r, 0, Math.PI * 2);
    const fg = ctx.createRadialGradient(bc.cx, bc.cy - r * 0.35, r * 0.05, bc.cx, bc.cy, r);
    fg.addColorStop(0, 'rgba(0,255,170,0.5)');
    fg.addColorStop(1, 'rgba(0,80,60,0.8)');
    ctx.fillStyle = fg;
    ctx.fill();

    // Border
    ctx.beginPath();
    ctx.arc(bc.cx, bc.cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,255,170,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    const fontSize = Math.round(r * 0.7);
    ctx.font = `700 ${fontSize}px 'Trebuchet MS', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(tc.label, bc.cx, bc.cy);

    // "flick up" hint arrow
    ctx.beginPath();
    ctx.moveTo(bc.cx, bc.cy - r - 8);
    ctx.lineTo(bc.cx - 6, bc.cy - r - 2);
    ctx.moveTo(bc.cx, bc.cy - r - 8);
    ctx.lineTo(bc.cx + 6, bc.cy - r - 2);
    ctx.strokeStyle = 'rgba(0,255,170,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ── Suggestion pill ─────────────────────────────────────
  if (ui.showSuggest && model.suggestionConsole && model.anchorMarker) {
    const sg = model.suggestionConsole;
    const sc = wrapToCanvas(model.anchorMarker.x, model.anchorMarker.y - ui.haloOffset - ui.bubbleSize * 2.5);
    const pillW = 110;
    const pillH = 30;
    const px = sc.cx - pillW / 2;
    const py = sc.cy - pillH / 2;
    const r  = pillH / 2;

    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + pillW, py, px + pillW, py + pillH, r);
    ctx.arcTo(px + pillW, py + pillH, px, py + pillH, r);
    ctx.arcTo(px, py + pillH, px, py, r);
    ctx.arcTo(px, py, px + pillW, py, r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(25,15,40,0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,80,200,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = "600 13px 'Trebuchet MS', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(192,132,252,0.8)';
    ctx.fillText(`\u2192 ${sg.word}`, sc.cx, sc.cy);
  }

  // ── Anchor dot ──────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(ac.cx, ac.cy, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,212,255,0.8)';
  ctx.fill();

  // ── Cursor dot ──────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(pc.cx, pc.cy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,212,255,0.6)';
  ctx.fill();

  requestAnimationFrame(render);
}

// ─────────────────────────────────────────────────────────────
// CONTROLS
// ─────────────────────────────────────────────────────────────

function bindSlider(id, lblId, engineProp, uiProp, parseFn = parseFloat) {
  const el = document.getElementById(id);
  const lb = document.getElementById(lblId);
  if (!el || !lb) return;
  el.addEventListener('input', () => {
    const val = parseFn(el.value);
    lb.textContent = el.value;
    if (engineProp) engine.setConfig({ [engineProp]: val });
    if (uiProp)     ui[uiProp] = val;
  });
}

bindSlider('ctrl-gridstep',   'lbl-gridstep',   'gridStepSize',        null,         parseInt);
bindSlider('ctrl-warp',       'lbl-warp',       'warpStrength',        null);
bindSlider('ctrl-deadzone',   'lbl-deadzone',   'deadzoneRadius',      null,         parseInt);
bindSlider('ctrl-flickspeed', 'lbl-flickspeed', 'flickSpeedThreshold', null,         parseInt);
bindSlider('ctrl-finger',    'lbl-finger',    null,                  'fingerRadius', parseInt);

document.getElementById('tog-halo')?.addEventListener('change',         e => ui.showTopBubble  = e.target.checked);
document.getElementById('tog-highlights')?.addEventListener('change',   e => ui.showHighlights = e.target.checked);
document.getElementById('tog-suggest')?.addEventListener('change',      e => ui.showSuggest    = e.target.checked);
document.getElementById('tog-debug-labels')?.addEventListener('change', e => ui.showDebugLabels = e.target.checked);

// ─────────────────────────────────────────────────────────────
// CLEAR
// ─────────────────────────────────────────────────────────────

clearBtn.addEventListener('click', () => {
  outputText = '';
  lastCommitLabel = null;
  activePointerId = null;
  clearSessionTimeout();
  outputEl.textContent = '';
  engine.reset();
  eventLogEl.innerHTML = '';
  // Clear key highlights
  for (const id of Object.keys(keyEls)) {
    keyEls[id].classList.remove('highlight', 'highlight-top', 'anchor-active');
    keyEls[id].style.opacity = '';
  }
  updateDebug(engine.getRenderModel());
});

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────

function recalibrate() {
  resizeCanvas();
  computeGeometry();
}

window.addEventListener('resize', recalibrate);
window.addEventListener('orientationchange', () => setTimeout(recalibrate, 200));

resizeCanvas();
setTimeout(() => {
  computeGeometry();
  requestAnimationFrame(render);
}, 150);
