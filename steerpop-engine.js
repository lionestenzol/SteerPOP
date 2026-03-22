/**
 * SteerPop Engine v0.4 — Layer-Based Interaction Model
 * Pure logic — no DOM, no canvas, no browser APIs.
 *
 * Layer 0: Tap → first letter enters immediately
 * Layer 1: Slide → directional candidates based on swipe angle
 * Layer 2: Flick up → confirms top candidate, anchor moves
 *          → back to Layer 1
 *
 * The engine owns decisions. Adapters own text and rendering.
 *
 * @module steerpop-engine
 */

// ─────────────────────────────────────────────────────────────
// DEFAULT CONFIG
// ─────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = Object.freeze({
  candidateCount:       8,
  hysteresis:           0.3,
  deadzoneRadius:       8,
  flickSpeedThreshold:  8,       // min speed to register flick (touch-tuned)
  flickAngleThreshold:  40,      // max degrees from vertical to count as "up"/"down"
  flickCooldownMs:      350,     // pause after each flick commit
  gridStepSize:         30,      // pixels of slide per key step (larger for finger precision)
  warpStrength:         0.2,     // 0-1: how much keys pull toward the pointer (subtle for touch)
  warpRadius:           150,     // pixels: keys within this radius get warped
  suggestionEnabled:    false,
  useScoring:           false,   // false = grid path (default), true = scoring path
  candidateAngleSpread: 100,     // cone width in degrees (visual + scoring path)
});

// ─────────────────────────────────────────────────────────────
// SUGGESTION TABLE
// ─────────────────────────────────────────────────────────────

const SUGGESTION_MAP = {
  HE: 'hello', TH: 'the',   YO: 'you',
  IT: 'it',    IN: 'into',  AN: 'and',
  IS: 'is',    WO: 'world', BE: 'be',
  FO: 'for',   HA: 'have',  AR: 'are',
  CA: 'can',   NO: 'not',   WI: 'will',
  GO: 'good',  SO: 'so',    DO: 'do',
  ON: 'one',   WH: 'what',  MY: 'my',
  LO: 'love',  ME: 'me',    US: 'use',
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function rad2deg(r) {
  return r * 180 / Math.PI;
}

function angleBetween(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

/** Signed angular difference, result in [-PI, PI] */
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI)  d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ── Vector utilities ─────────────────────────────────────────

function vectorFromTo(ax, ay, bx, by) {
  return { x: bx - ax, y: by - ay };
}

function vecLength(vx, vy) {
  return Math.hypot(vx, vy);
}

function vecNormalize(vx, vy) {
  const len = Math.hypot(vx, vy);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: vx / len, y: vy / len };
}

function vecDot(ax, ay, bx, by) {
  return ax * bx + ay * by;
}

function cosineSimilarity(ax, ay, bx, by) {
  const lenA = Math.hypot(ax, ay);
  const lenB = Math.hypot(bx, by);
  if (lenA < 1e-9 || lenB < 1e-9) return 0;
  return vecDot(ax, ay, bx, by) / (lenA * lenB);
}

// ─────────────────────────────────────────────────────────────
// STEERPOP ENGINE
// ─────────────────────────────────────────────────────────────

export class SteerPopEngine {

  constructor(config = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.geometry = [];
    this._keyById = new Map();
    this._events = [];
    this._textContext = '';
    this._state = this._freshState();

    // Velocity tracking buffer (last N pointer positions for flick detection)
    this._velocityBuffer = [];
  }

  // ── config / geometry ──────────────────────────────────────

  setGeometry(keys) {
    this.geometry = keys;
    this._keyById.clear();
    for (const k of keys) {
      this._keyById.set(k.id, k);
    }
    this._buildGrid();
  }

  _buildGrid() {
    // Group keys by row, sorted by X position
    this._keysByRow = new Map();
    const eligible = this.geometry.filter(k => !k.excluded);

    for (const k of eligible) {
      if (!this._keysByRow.has(k.row)) {
        this._keysByRow.set(k.row, []);
      }
      this._keysByRow.get(k.row).push(k);
    }

    // Sort each row by X
    for (const [row, keys] of this._keysByRow) {
      keys.sort((a, b) => a.centerX - b.centerX);
    }

    // Compute row spacing (average Y distance between adjacent rows)
    const rowCenters = [];
    for (const [row, keys] of this._keysByRow) {
      const avgY = keys.reduce((sum, k) => sum + k.centerY, 0) / keys.length;
      rowCenters.push({ row, y: avgY });
    }
    rowCenters.sort((a, b) => a.row - b.row);

    if (rowCenters.length >= 2) {
      let totalSpacing = 0;
      for (let i = 1; i < rowCenters.length; i++) {
        totalSpacing += rowCenters[i].y - rowCenters[i - 1].y;
      }
      this._rowSpacing = totalSpacing / (rowCenters.length - 1);
    } else {
      this._rowSpacing = 50; // fallback
    }

    this._rowCenters = rowCenters;
  }

  _gridLookup(x, row) {
    const rowKeys = this._keysByRow.get(row);
    if (!rowKeys || rowKeys.length === 0) return null;

    let best = rowKeys[0];
    let bestDist = Math.abs(rowKeys[0].centerX - x);

    for (let i = 1; i < rowKeys.length; i++) {
      const d = Math.abs(rowKeys[i].centerX - x);
      if (d < bestDist) {
        best = rowKeys[i];
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * Compute warped position of a key — pulled toward the pointer.
   * Returns {x, y} of where the key "feels" like it is.
   */
  _warpKeyPosition(key, pointerX, pointerY) {
    const strength = this.cfg.warpStrength;
    if (strength <= 0) return { x: key.centerX, y: key.centerY };

    const d = dist(key.centerX, key.centerY, pointerX, pointerY);
    const radius = this.cfg.warpRadius;

    if (d > radius || d < 1) return { x: key.centerX, y: key.centerY };

    // Pull factor: stronger for closer keys, fades to 0 at warpRadius
    const falloff = 1 - (d / radius);
    const pull = falloff * falloff * strength; // quadratic falloff

    // Move key toward pointer
    const dx = pointerX - key.centerX;
    const dy = pointerY - key.centerY;

    return {
      x: key.centerX + dx * pull,
      y: key.centerY + dy * pull,
    };
  }

  /**
   * Get warped positions for all keys (for adapter to render visual shift).
   * Only meaningful during an active session.
   */
  getWarpedPositions() {
    const s = this._state;
    if (!s.active) return [];

    const px = s.pointerPosition.x;
    const py = s.pointerPosition.y;

    return this.geometry
      .filter(k => !k.excluded)
      .map(k => {
        const warped = this._warpKeyPosition(k, px, py);
        return {
          id: k.id,
          offsetX: warped.x - k.centerX,
          offsetY: warped.y - k.centerY,
        };
      });
  }

  setConfig(partial) {
    Object.assign(this.cfg, partial);
  }

  setTextContext(text) {
    this._textContext = text;
  }

  // ── public state access ────────────────────────────────────

  getState() {
    return { ...this._state };
  }

  consumeEvents() {
    const out = this._events.slice();
    this._events.length = 0;
    return out;
  }

  reset() {
    this._state = this._freshState();
    this._events.length = 0;
    this._textContext = '';
    this._velocityBuffer = [];
  }

  // ── pointer interface ──────────────────────────────────────

  pointerDown(p) {
    const hit = this._hitTest(p.x, p.y);
    if (!hit) return;

    const s = this._state;

    // Layer 0: tap commits the key immediately
    s.active = true;
    s.layer = 1; // move to sliding layer after commit
    s.anchorKey = hit.id;
    s.anchorPosition = { x: hit.centerX, y: hit.centerY };
    s.pointerPosition = { x: p.x, y: p.y };
    s.previousPointerPosition = { x: p.x, y: p.y };
    s.velocity = { x: 0, y: 0 };
    s.speed = 0;
    s.swipeAngle = null;
    s.candidates = [];
    s.topCandidate = null;
    s.flickState = 'sliding';
    s.didCommitThisSession = false;
    s.sessionStartTime = p.timestamp;
    s.activeRow = hit.row;
    s.swipeDirection = null;

    this._velocityBuffer = [{ x: p.x, y: p.y, t: p.timestamp }];

    // Emit Layer 0 commit
    this._emit('session_started', { anchorKey: hit.id }, p.timestamp);
    this._emit('letter_committed', {
      key: hit.id,
      label: hit.label,
      commitType: 'tap',
    }, p.timestamp);
    s.lastCommittedKey = hit.id;
    s.lastCommitTime = p.timestamp;
    s.lastCommitType = 'tap';
    s.didCommitThisSession = true;

    // Gesture capture: record first key
    s.gestureKeySequence.push(hit.id);
    s.lastCommitPosition = { x: hit.centerX, y: hit.centerY };

    // Update suggestion
    if (this.cfg.suggestionEnabled) {
      s.suggestion = this._computeSuggestion();
      if (s.suggestion) {
        this._emit('suggestion_shown', { word: s.suggestion }, p.timestamp);
      }
    }
  }

  pointerMove(p) {
    const s = this._state;
    if (!s.active) return;

    s.previousPointerPosition = { ...s.pointerPosition };
    s.pointerPosition = { x: p.x, y: p.y };

    // Gesture capture: raw pointer displacement
    const gdx = p.x - s.previousPointerPosition.x;
    const gdy = p.y - s.previousPointerPosition.y;
    if (Math.abs(gdx) > 0.5 || Math.abs(gdy) > 0.5) {
      s.gestureVectors.push({ dx: gdx, dy: gdy, t: p.timestamp });
    }

    // Track velocity buffer
    this._velocityBuffer.push({ x: p.x, y: p.y, t: p.timestamp });
    // Keep last 6 samples
    if (this._velocityBuffer.length > 6) {
      this._velocityBuffer.shift();
    }

    this._updateVelocity();

    const d = dist(s.anchorPosition.x, s.anchorPosition.y, p.x, p.y);

    // Deadzone: no candidates until intentional slide
    if (d < this.cfg.deadzoneRadius) {
      s.swipeAngle = null;
      s.candidates = [];
      s.topCandidate = null;
      return;
    }

    // Cooldown gate
    if (s.flickState === 'cooldown') {
      if (p.timestamp >= s.flickCooldownUntil) {
        s.flickState = 'sliding';
      } else {
        return;
      }
    }

    // Layer 1: compute swipe angle and detect row vs lateral intent
    s.swipeAngle = angleBetween(
      s.anchorPosition.x, s.anchorPosition.y,
      p.x, p.y
    );

    const dx = p.x - s.anchorPosition.x;
    const dy = p.y - s.anchorPosition.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Row switching: Y distance determines how many rows to jump
    const rowSpacing = this._rowSpacing || 50;
    const rowThreshold = rowSpacing * 0.6;
    if (absDy > rowThreshold) {
      const anchorKey = this._keyById.get(s.anchorKey);
      if (anchorKey) {
        // How many rows to jump: 1 row per rowSpacing of Y movement
        const maxRow = this._rowCenters.length > 0
          ? this._rowCenters[this._rowCenters.length - 1].row : 2;
        const rowsToJump = Math.round(absDy / rowSpacing);
        const targetRow = dy > 0
          ? Math.min(anchorKey.row + rowsToJump, maxRow)
          : Math.max(anchorKey.row - rowsToJump, 0);
        s.activeRow = targetRow;
      }
    }

    // Determine swipe direction
    if (absDy > absDx * 1.2) {
      s.swipeDirection = dy > 0 ? 'down' : 'up';
    } else {
      s.swipeDirection = dx > 0 ? 'right' : 'left';
    }

    // Generate candidates: grid path (default) or scoring path
    if (this.cfg.useScoring) {
      this._generateRowLockedCandidates(p.timestamp);
    } else {
      this._generateGridCandidates(p.timestamp);
    }

    // Layer 2: check for flick gestures
    this._checkFlickUp(p.timestamp);
    this._checkFlickDown(p.timestamp);
  }

  pointerUp(p) {
    const s = this._state;
    if (!s.active) return;

    this._emit('session_ended', {
      anchorKey: s.anchorKey,
      gestureVectors: s.gestureVectors,
      gestureKeySequence: s.gestureKeySequence,
      commitVectors: s.commitVectors,
    }, p.timestamp);
    this._endSession();
  }

  endSession(timestamp) {
    const s = this._state;
    if (!s.active) return;
    this._emit('session_ended', {
      anchorKey: s.anchorKey,
      gestureVectors: s.gestureVectors,
      gestureKeySequence: s.gestureKeySequence,
      commitVectors: s.commitVectors,
    }, timestamp);
    this._endSession();
  }

  // ── trace replay ───────────────────────────────────────────

  replayTrace(trace) {
    this.reset();
    if (trace.config) this.setConfig(trace.config);
    if (trace.geometry) this.setGeometry(trace.geometry);
    if (trace.textContext) this.setTextContext(trace.textContext);

    for (const evt of trace.events) {
      const p = { x: evt.x, y: evt.y, timestamp: evt.timestamp };
      switch (evt.type) {
        case 'pointerDown': this.pointerDown(p); break;
        case 'pointerMove': this.pointerMove(p); break;
        case 'pointerUp':   this.pointerUp(p);   break;
      }
    }
    return this.consumeEvents();
  }

  // ── render model ───────────────────────────────────────────

  getRenderModel() {
    const s = this._state;

    if (!s.active) {
      return {
        sessionActive: false,
        candidates: [],
        keyHighlights: [],
        topCandidate: null,
        anchorMarker: null,
        pointerMarker: null,
        connectorLine: null,
        suggestionConsole: null,
        debugValues: this._debugValues(),
      };
    }

    // Key highlights: map candidates to brightness values for DOM keys
    const keyHighlights = s.candidates.map(c => ({
      id: c.id,
      brightness: c.brightness,
      isTop: c.id === s.topCandidate,
    }));

    // Floating indicator for top candidate (position computed by adapter)
    let topBubble = null;
    if (s.topCandidate) {
      const topC = s.candidates.find(c => c.id === s.topCandidate);
      if (topC) {
        topBubble = {
          id: topC.id,
          label: topC.label,
        };
      }
    }

    // Suggestion (position computed by adapter)
    let suggestionConsole = null;
    if (this.cfg.suggestionEnabled && s.suggestion) {
      suggestionConsole = {
        word: s.suggestion,
      };
    }

    return {
      sessionActive: true,
      candidates: s.candidates.map(c => ({
        id: c.id,
        label: c.label,
        brightness: c.brightness,
        isTop: c.id === s.topCandidate,
        score: c.score,
      })),
      keyHighlights,
      topCandidate: topBubble,
      anchorMarker: { ...s.anchorPosition },
      pointerMarker: { ...s.pointerPosition },
      connectorLine: {
        from: { ...s.anchorPosition },
        to: { ...s.pointerPosition },
      },
      suggestionConsole,
      debugValues: this._debugValues(),
    };
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — state
  // ─────────────────────────────────────────────────────────

  _freshState() {
    return {
      active:                  false,
      layer:                   0,       // 0=tap, 1=sliding, 2=confirming
      anchorKey:               null,
      anchorPosition:          { x: 0, y: 0 },
      pointerPosition:         { x: 0, y: 0 },
      previousPointerPosition: { x: 0, y: 0 },
      velocity:                { x: 0, y: 0 },
      speed:                   0,
      swipeAngle:              null,
      candidates:              [],
      topCandidate:            null,
      lockedTarget:            null,     // last stable top candidate (before flick motion)
      flickState:              'idle',   // idle | sliding | cooldown
      flickCooldownUntil:      0,
      lastCommittedKey:        null,
      lastCommitTime:          0,
      lastCommitType:          null,     // 'tap' | 'flick' | 'repeat' | 'suggestion'
      suggestion:              null,
      didCommitThisSession:    false,
      sessionStartTime:        0,
      activeRow:               null,     // which row candidates come from
      swipeDirection:          null,     // 'left' | 'right' | 'up' | 'down'
      // Gesture capture (vector layer)
      gestureVectors:          [],       // raw pointer displacements [{dx, dy, t}]
      gestureKeySequence:      [],       // committed key IDs in order
      commitVectors:           [],       // key-to-key displacement vectors [{dx, dy}]
      lastCommitPosition:      null,     // {x, y} of last committed key center
    };
  }

  _endSession() {
    const s = this._state;
    s.active       = false;
    s.layer        = 0;
    s.anchorKey    = null;
    s.candidates   = [];
    s.topCandidate = null;
    s.lockedTarget = null;
    s.swipeAngle   = null;
    s.flickState   = 'idle';
    s.activeRow    = null;
    s.swipeDirection = null;
    this._velocityBuffer = [];
  }

  _emit(type, data, timestamp) {
    this._events.push({ type, timestamp, ...data });
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — hit testing
  // ─────────────────────────────────────────────────────────

  _hitTest(x, y) {
    let best = null;
    let bestDist = Infinity;
    for (const k of this.geometry) {
      const d = dist(x, y, k.centerX, k.centerY);
      const hitRadius = Math.max(k.width, k.height) * 0.6;
      if (d < hitRadius && d < bestDist) {
        best = k;
        bestDist = d;
      }
    }
    return best;
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — row-locked candidate generation
  // ─────────────────────────────────────────────────────────
  // PRIVATE — grid-based candidate generation (default path)
  // ─────────────────────────────────────────────────────────

  _generateGridCandidates(timestamp) {
    const s = this._state;
    if (!s.anchorKey || s.activeRow === null) return;
    if (!this._keysByRow) return;

    const anchorKey = this._keyById.get(s.anchorKey);
    if (!anchorKey) return;

    const rowKeys = this._keysByRow.get(s.activeRow);
    if (!rowKeys || rowKeys.length === 0) {
      s.candidates = [];
      s.topCandidate = null;
      return;
    }

    const dir = s.swipeDirection;
    const px = s.pointerPosition.x;
    const py = s.pointerPosition.y;

    // Compute warped positions for keys on this row
    const warpedKeys = rowKeys.map(k => {
      const w = this._warpKeyPosition(k, px, py);
      return { ...k, warpedX: w.x, warpedY: w.y };
    });

    // Get keys in the swipe direction, ordered by warped position (nearest first)
    let ordered;
    if (dir === 'right') {
      ordered = warpedKeys.filter(k => k.centerX > anchorKey.centerX);
      ordered.sort((a, b) => a.warpedX - b.warpedX);
    } else if (dir === 'left') {
      ordered = warpedKeys.filter(k => k.centerX < anchorKey.centerX);
      ordered.sort((a, b) => b.warpedX - a.warpedX); // nearest first
    } else {
      // Vertical — sort by warped X distance from pointer
      ordered = warpedKeys.slice().sort((a, b) =>
        Math.abs(a.warpedX - px) - Math.abs(b.warpedX - px)
      );
    }

    if (ordered.length === 0) {
      s.candidates = [];
      s.topCandidate = null;
      return;
    }

    // GRID COMPRESSION: slide distance → key index
    // Each "step" of gridStepSize pixels = one key deeper
    const gridStepSize = this.cfg.gridStepSize || 25; // pixels per key step
    const slideDist = (dir === 'left' || dir === 'right')
      ? Math.abs(s.pointerPosition.x - s.anchorPosition.x)
      : Math.abs(s.pointerPosition.y - s.anchorPosition.y);

    // Which key index does this slide distance map to?
    // Subtract deadzone from slide distance
    const effectiveDist = Math.max(0, slideDist - this.cfg.deadzoneRadius);
    const keyIndex = Math.floor(effectiveDist / gridStepSize);
    const activeIndex = Math.min(keyIndex, ordered.length - 1);

    // Build candidates: active key is brightest, neighbors dimmer
    const scored = ordered.map((k, i) => {
      // Distance from the active index determines brightness
      const indexDist = Math.abs(i - activeIndex);
      const brightness = Math.max(0.12, 1.0 - indexDist * 0.25);
      const score = indexDist === 0 ? 1.0 : 1.0 / (1 + indexDist);
      return {
        id: k.id,
        label: k.label,
        dist: Math.abs(k.centerX - anchorKey.centerX),
        score,
        brightness,
        order: i,
      };
    });

    // Sort by score (active key first)
    scored.sort((a, b) => b.score - a.score);

    // Take up to 8
    const chosen = scored.slice(0, this.cfg.candidateCount);

    // Hysteresis — resist switching top candidate unless score margin is large enough
    const prevTop = s.topCandidate;
    if (chosen.length > 0) {
      const newTop = chosen[0].id;
      if (newTop !== prevTop) {
        const oldInList = chosen.find(c => c.id === prevTop);
        if (oldInList && chosen[0].score - oldInList.score < this.cfg.hysteresis * 0.5) {
          // Keep old top candidate — margin too small
          s.topCandidate = prevTop;
        } else {
          if (prevTop) {
            s.lockedTarget = prevTop;
          }
          s.topCandidate = newTop;
          this._emit('target_changed', { target: newTop, from: prevTop }, timestamp);
        }
      }
      if (s.topCandidate === prevTop && s.topCandidate) {
        s.lockedTarget = s.topCandidate;
      }
    } else {
      s.topCandidate = null;
    }

    s.candidates = chosen;
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — scoring-based candidate generation (opt-in path)
  // ─────────────────────────────────────────────────────────

  _generateRowLockedCandidates(timestamp) {
    const s = this._state;
    if (!s.anchorKey || s.activeRow === null) return;

    const anchorKey = this._keyById.get(s.anchorKey);
    if (!anchorKey) return;

    const dir = s.swipeDirection;

    // Get all keys on the active row, sorted by horizontal position
    const rowKeys = this.geometry
      .filter(k => !k.excluded && k.row === s.activeRow && k.id !== s.anchorKey)
      .sort((a, b) => a.centerX - b.centerX);

    if (rowKeys.length === 0) {
      s.candidates = [];
      s.topCandidate = null;
      return;
    }

    // Filter by direction: only keys in the swipe direction
    let directional;
    if (dir === 'right') {
      directional = rowKeys.filter(k => k.centerX > anchorKey.centerX);
    } else if (dir === 'left') {
      directional = rowKeys.filter(k => k.centerX < anchorKey.centerX).reverse(); // closest first
    } else if (dir === 'up' || dir === 'down') {
      // Vertical: show the key on the target row closest to anchor's X position
      directional = rowKeys.slice().sort((a, b) =>
        Math.abs(a.centerX - anchorKey.centerX) - Math.abs(b.centerX - anchorKey.centerX)
      );
    } else {
      directional = [];
    }

    if (directional.length === 0) {
      s.candidates = [];
      s.topCandidate = null;
      return;
    }

    // How far the pointer has slid from the anchor (horizontal component for left/right)
    const slideDist = (dir === 'left' || dir === 'right')
      ? Math.abs(s.pointerPosition.x - s.anchorPosition.x)
      : Math.abs(s.pointerPosition.y - s.anchorPosition.y);

    // Compute horizontal spacing between adjacent keys on this row
    const allRowKeys = this.geometry
      .filter(k => !k.excluded && k.row === s.activeRow)
      .sort((a, b) => a.centerX - b.centerX);
    let keySpacing = 55;
    if (allRowKeys.length >= 2) {
      keySpacing = (allRowKeys[allRowKeys.length - 1].centerX - allRowKeys[0].centerX) / (allRowKeys.length - 1);
    }

    // Score: which key matches the current slide distance
    const scored = directional.map((k, idx) => {
      // Distance of this key from anchor (in the direction of swipe)
      const keyDist = (dir === 'left' || dir === 'right')
        ? Math.abs(k.centerX - anchorKey.centerX)
        : Math.abs(k.centerY - anchorKey.centerY);

      // How well the slide distance matches this key's position
      const reachDiff = Math.abs(slideDist - keyDist) / keySpacing;
      const reachScore = Math.exp(-reachDiff * reachDiff * 2.0);

      return {
        id: k.id,
        label: k.label,
        dist: keyDist,
        score: reachScore,
        brightness: 0,
        order: idx,
      };
    });

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    // All of them are candidates (show the full row direction)
    const chosen = scored.slice(0, this.cfg.candidateCount);

    // Assign brightness
    chosen.forEach((c, i) => {
      c.brightness = Math.max(0.15, 1.0 - i * 0.15);
    });

    // Hysteresis
    const prevTop = s.topCandidate;
    if (chosen.length > 0) {
      const newTop = chosen[0].id;
      if (newTop !== prevTop) {
        const oldInList = chosen.find(c => c.id === prevTop);
        if (oldInList && chosen[0].score - oldInList.score < this.cfg.hysteresis * 0.5) {
          s.topCandidate = prevTop;
        } else {
          if (prevTop) {
            s.lockedTarget = prevTop;
          }
          s.topCandidate = newTop;
          this._emit('target_changed', { target: newTop, from: prevTop }, timestamp);
        }
      }
      if (s.topCandidate === prevTop && s.topCandidate) {
        s.lockedTarget = s.topCandidate;
      }
    } else {
      s.topCandidate = null;
    }

    s.candidates = chosen;
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — velocity tracking
  // ─────────────────────────────────────────────────────────

  _updateVelocity() {
    const buf = this._velocityBuffer;
    if (buf.length < 2) {
      this._state.velocity = { x: 0, y: 0 };
      this._state.speed = 0;
      return;
    }

    // Use last 3 samples for smoothed velocity
    const n = Math.min(buf.length, 3);
    const newest = buf[buf.length - 1];
    const oldest = buf[buf.length - n];
    const dt = newest.t - oldest.t;

    if (dt > 0) {
      const vx = (newest.x - oldest.x) / dt * 16; // normalize to ~per-frame
      const vy = (newest.y - oldest.y) / dt * 16;
      this._state.velocity = { x: vx, y: vy };
      this._state.speed = Math.hypot(vx, vy);
    }
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — flick-up detection
  // ─────────────────────────────────────────────────────────

  _checkFlickUp(timestamp) {
    const s = this._state;
    if (s.flickState !== 'sliding') return;
    if (!s.topCandidate) return;

    const buf = this._velocityBuffer;
    // Need at least 5 samples
    if (buf.length < 5) return;

    // Flick = direction change: recent motion is upward, but earlier motion was not
    // Check recent velocity (last 2 samples)
    const recent1 = buf[buf.length - 1];
    const recent2 = buf[buf.length - 2];
    const recent3 = buf[buf.length - 3];
    const dt1 = recent1.t - recent2.t;
    const dt2 = recent2.t - recent3.t;

    if (dt1 <= 0 || dt2 <= 0) return;

    const recentVy = (recent1.y - recent2.y) / dt1 * 16;
    const recentVx = (recent1.x - recent2.x) / dt1 * 16;
    const prevVy   = (recent2.y - recent3.y) / dt2 * 16;

    const recentSpeed = Math.hypot(recentVx, recentVy);

    // Recent motion must be upward
    if (recentVy >= 0) return;                                 // not moving up
    if (recentSpeed < this.cfg.flickSpeedThreshold) return;    // too slow

    const upwardSpeed = Math.abs(recentVy);
    const horizontalSpeed = Math.abs(recentVx);
    const flickAngle = rad2deg(Math.atan2(horizontalSpeed, upwardSpeed));
    if (flickAngle > this.cfg.flickAngleThreshold) return;     // too sideways

    // Previous motion must NOT have been strongly upward
    // (this prevents continuous upward sliding from triggering flick)
    const prevUpward = -prevVy; // positive if was moving up
    if (prevUpward > this.cfg.flickSpeedThreshold * 0.8) {
      // Was already moving upward — this is a sustained slide, not a flick
      // Only allow if there was a clear acceleration (speed doubled)
      if (upwardSpeed < prevUpward * 1.8) return;
    }

    // Flick confirmed — commit the locked target (stable before flick motion)
    const commitTarget = s.lockedTarget || s.topCandidate;
    if (!commitTarget) return;
    this._commitFlick(commitTarget, timestamp);
  }

  _checkFlickDown(timestamp) {
    const s = this._state;
    if (s.flickState !== 'sliding') return;
    if (!s.anchorKey) return;

    const buf = this._velocityBuffer;
    if (buf.length < 5) return;

    const recent1 = buf[buf.length - 1];
    const recent2 = buf[buf.length - 2];
    const recent3 = buf[buf.length - 3];
    const dt1 = recent1.t - recent2.t;
    const dt2 = recent2.t - recent3.t;

    if (dt1 <= 0 || dt2 <= 0) return;

    const recentVy = (recent1.y - recent2.y) / dt1 * 16;
    const recentVx = (recent1.x - recent2.x) / dt1 * 16;
    const prevVy   = (recent2.y - recent3.y) / dt2 * 16;

    const recentSpeed = Math.hypot(recentVx, recentVy);

    // Recent motion must be downward (positive Y)
    if (recentVy <= 0) return;
    if (recentSpeed < this.cfg.flickSpeedThreshold) return;

    const downwardSpeed = Math.abs(recentVy);
    const horizontalSpeed = Math.abs(recentVx);
    const flickAngle = rad2deg(Math.atan2(horizontalSpeed, downwardSpeed));
    if (flickAngle > this.cfg.flickAngleThreshold) return;

    // Previous motion must NOT have been strongly downward
    const prevDownward = prevVy; // positive if was moving down
    if (prevDownward > this.cfg.flickSpeedThreshold * 0.8) {
      if (downwardSpeed < prevDownward * 1.8) return;
    }

    // Repeat confirmed — recommit anchor letter
    this._commitRepeat(s.anchorKey, timestamp);
  }

  _commitRepeat(keyId, timestamp) {
    const s = this._state;
    const key = this._keyById.get(keyId);
    if (!key) return;

    s.lastCommittedKey = keyId;
    s.lastCommitTime   = timestamp;
    s.lastCommitType   = 'repeat';

    this._emit('letter_committed', {
      key: keyId,
      label: key.label,
      commitType: 'repeat',
    }, timestamp);

    // Gesture capture: record repeated key (no commit vector — same position)
    s.gestureKeySequence.push(keyId);

    // Do NOT reanchor — stay on same key for chaining
    s.candidates   = [];
    s.topCandidate = null;
    s.lockedTarget = null;
    s.swipeAngle   = null;
    s.swipeDirection = null;

    // Enter cooldown
    s.flickState = 'cooldown';
    s.flickCooldownUntil = timestamp + this.cfg.flickCooldownMs;
    this._velocityBuffer = [];
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — commit
  // ─────────────────────────────────────────────────────────

  _commitFlick(keyId, timestamp) {
    const s = this._state;
    const key = this._keyById.get(keyId);
    if (!key) return;

    s.lastCommittedKey = keyId;
    s.lastCommitTime   = timestamp;
    s.lastCommitType   = 'flick';

    this._emit('flick_confirmed', { key: keyId, label: key.label }, timestamp);
    this._emit('letter_committed', {
      key: keyId,
      label: key.label,
      commitType: 'flick',
    }, timestamp);

    // Gesture capture: record commit vector and key
    if (s.lastCommitPosition && key) {
      s.commitVectors.push({
        dx: key.centerX - s.lastCommitPosition.x,
        dy: key.centerY - s.lastCommitPosition.y,
      });
    }
    s.gestureKeySequence.push(keyId);
    s.lastCommitPosition = { x: key.centerX, y: key.centerY };

    // Reanchor on committed key
    s.anchorKey      = keyId;
    s.anchorPosition = { x: key.centerX, y: key.centerY };
    s.activeRow      = key.row;
    s.swipeDirection = null;
    s.candidates     = [];
    s.topCandidate   = null;
    s.lockedTarget   = null;
    s.swipeAngle     = null;

    // Update suggestion
    if (this.cfg.suggestionEnabled) {
      s.suggestion = this._computeSuggestion();
      if (s.suggestion) {
        this._emit('suggestion_shown', { word: s.suggestion }, timestamp);
      }
    }

    // Enter cooldown
    s.flickState = 'cooldown';
    s.flickCooldownUntil = timestamp + this.cfg.flickCooldownMs;

    // Reset velocity buffer to prevent double-flick
    this._velocityBuffer = [];
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — suggestion
  // ─────────────────────────────────────────────────────────

  _computeSuggestion() {
    const text = this._textContext;
    if (!text || text.length < 2) return null;
    const suffix = text.slice(-2).toUpperCase();
    return SUGGESTION_MAP[suffix] || null;
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — debug values
  // ─────────────────────────────────────────────────────────

  _debugValues() {
    const s = this._state;
    const d = s.active
      ? dist(s.anchorPosition.x, s.anchorPosition.y, s.pointerPosition.x, s.pointerPosition.y)
      : 0;
    return {
      session:     s.active ? 'ACTIVE' : 'IDLE',
      layer:       s.layer,
      anchor:      s.anchorKey || '\u2014',
      topTarget:   s.topCandidate || '\u2014',
      distance:    Math.round(d),
      swipeAngle:  s.swipeAngle !== null ? Math.round(rad2deg(s.swipeAngle)) + '\u00B0' : '\u2014',
      flickState:  s.flickState.toUpperCase(),
      speed:       Math.round(s.speed),
      lastCommit:  s.lastCommittedKey || '\u2014',
      suggestion:  s.suggestion || '\u2014',
      candidates:  s.candidates.length,
      activeRow:   s.activeRow !== null ? 'Row ' + s.activeRow : '\u2014',
      swipeDir:    s.swipeDirection || '\u2014',
    };
  }

  // ─────────────────────────────────────────────────────────
  // STATIC — vector normalization
  // ─────────────────────────────────────────────────────────

  /**
   * Normalize a commit-vector trace to a fixed-length sequence of unit vectors.
   * Used for gesture matching: canonical representation of a typed word's motion path.
   *
   * @param {Array<{dx, dy}>} commitVectors - key-to-key displacement vectors
   * @param {number} targetLength - desired output length (default 12)
   * @returns {Array<{x, y}>} fixed-length array of unit vectors
   */
  static normalizeCommitTrace(commitVectors, targetLength = 12) {
    if (!commitVectors || commitVectors.length === 0) {
      return Array.from({ length: targetLength }, () => ({ x: 0, y: 0 }));
    }

    // Build cumulative path: array of points from origin
    const points = [{ x: 0, y: 0 }];
    for (const v of commitVectors) {
      const prev = points[points.length - 1];
      points.push({ x: prev.x + v.dx, y: prev.y + v.dy });
    }

    // Compute cumulative arc length at each point
    const arcLengths = [0];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      arcLengths.push(arcLengths[i - 1] + Math.hypot(dx, dy));
    }

    const totalLength = arcLengths[arcLengths.length - 1];
    if (totalLength < 1e-9) {
      return Array.from({ length: targetLength }, () => ({ x: 0, y: 0 }));
    }

    // Resample to targetLength + 1 equidistant points along the path
    const resampledPoints = [{ x: points[0].x, y: points[0].y }];
    const segmentLength = totalLength / targetLength;

    for (let i = 1; i <= targetLength; i++) {
      const targetDist = i * segmentLength;
      // Find the segment that contains this distance
      let j = 1;
      while (j < arcLengths.length - 1 && arcLengths[j] < targetDist) {
        j++;
      }
      // Interpolate between points[j-1] and points[j]
      const segStart = arcLengths[j - 1];
      const segEnd = arcLengths[j];
      const segLen = segEnd - segStart;
      const t = segLen > 1e-9 ? (targetDist - segStart) / segLen : 0;
      resampledPoints.push({
        x: points[j - 1].x + (points[j].x - points[j - 1].x) * t,
        y: points[j - 1].y + (points[j].y - points[j - 1].y) * t,
      });
    }

    // Convert resampled points back to direction vectors and normalize
    const result = [];
    for (let i = 1; i < resampledPoints.length; i++) {
      const dx = resampledPoints[i].x - resampledPoints[i - 1].x;
      const dy = resampledPoints[i].y - resampledPoints[i - 1].y;
      result.push(vecNormalize(dx, dy));
    }

    return result;
  }

  // ── angle diagnostics ─────────────────────────────────────

  static classifyDirection(dx, dy, thresholdRatio = 1.2) {
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (absDy > absDx * thresholdRatio) {
      return dy > 0 ? 'down' : 'up';
    }
    return dx > 0 ? 'right' : 'left';
  }

  static computeTransitionMap(geometry, config = {}) {
    const thresholdRatio = config.thresholdRatio || 1.2;
    const rowSwitchFactor = config.rowSwitchFactor || 0.6;

    // Filter to non-excluded keys
    const keys = geometry.filter(k => !k.excluded);

    // Group by row
    const keysByRow = new Map();
    for (const k of keys) {
      if (!keysByRow.has(k.row)) keysByRow.set(k.row, []);
      keysByRow.get(k.row).push(k);
    }
    for (const [, rowKeys] of keysByRow) {
      rowKeys.sort((a, b) => a.centerX - b.centerX);
    }

    // Compute row spacing (same as _buildGrid)
    const rowCenters = [];
    for (const [row, rowKeys] of keysByRow) {
      const avgY = rowKeys.reduce((sum, k) => sum + k.centerY, 0) / rowKeys.length;
      rowCenters.push({ row, y: avgY });
    }
    rowCenters.sort((a, b) => a.row - b.row);

    let rowSpacing = 50;
    if (rowCenters.length >= 2) {
      let total = 0;
      for (let i = 1; i < rowCenters.length; i++) {
        total += rowCenters[i].y - rowCenters[i - 1].y;
      }
      rowSpacing = total / (rowCenters.length - 1);
    }

    const maxRow = rowCenters.length > 0 ? rowCenters[rowCenters.length - 1].row : 2;
    const rowThreshold = rowSpacing * rowSwitchFactor;

    // Build map
    const map = new Map();
    for (const a of keys) {
      const inner = new Map();
      for (const b of keys) {
        if (a.id === b.id) continue;

        const dx = b.centerX - a.centerX;
        const dy = b.centerY - a.centerY;
        const distance = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        const direction = SteerPopEngine.classifyDirection(dx, dy, thresholdRatio);

        const absDy = Math.abs(dy);

        // Determine which row the direction resolves to
        let targetRow = a.row;
        if (absDy > rowThreshold) {
          const rowsToJump = Math.round(absDy / rowSpacing);
          targetRow = dy > 0
            ? Math.min(a.row + rowsToJump, maxRow)
            : Math.max(a.row - rowsToJump, 0);
        }

        // Get candidates for this direction on the target row
        const rowKeys = keysByRow.get(targetRow) || [];
        let candidates;
        if (direction === 'right') {
          candidates = rowKeys.filter(k => k.centerX > a.centerX);
          candidates.sort((x, y) => x.centerX - y.centerX);
        } else if (direction === 'left') {
          candidates = rowKeys.filter(k => k.centerX < a.centerX);
          candidates.sort((x, y) => y.centerX - x.centerX); // nearest first
        } else {
          // up/down: all keys on target row, sorted by X distance from anchor
          candidates = rowKeys.slice().sort((x, y) =>
            Math.abs(x.centerX - a.centerX) - Math.abs(y.centerX - a.centerX)
          );
        }

        // Check if B is among the candidates
        const idx = candidates.findIndex(k => k.id === b.id);
        let status;
        if (idx === 0) {
          status = 'direct';
        } else if (idx > 0) {
          status = 'reachable';
        } else if (b.row !== targetRow) {
          status = 'unreachable';
        } else {
          status = 'wrong_direction';
        }

        inner.set(b.id, {
          angle,
          distance,
          direction,
          targetRow,
          status,
          candidateIndex: idx,
        });
      }
      map.set(a.id, inner);
    }
    return map;
  }
}
