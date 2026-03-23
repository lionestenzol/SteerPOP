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
  smoothingAlpha:       0.6,     // EMA weight for pointer smoothing (1 = no smoothing)
  momentumWeight:       0.15,    // how much velocity-direction alignment boosts scoring (0 = off)
  hotRadius:            0.3,     // fraction of key spacing — force-lock when pointer is this close
  lingerMs:             80,      // ms to freeze candidates after a commit (post-commit stability)
  snapSpeedThreshold:   10,      // min horizontal speed for snap commit (same-row)
  snapAccelRatio:       2.0,     // recent speed must be this × prior speed (slow→fast detection)
  // Sticky key behavior
  sameRowHysteresis:    0.15,    // same-row: score margin to switch (only gate for same-row)
  stickySpeedGate:      3,       // cross-row: below this speed, no target switching
  stickyExitFraction:   0.6,     // cross-row: must travel this × keySpacing AWAY from current key to switch
  stickyDirectionGate:  0.3,     // velocity must point toward new key (cosine similarity threshold)
  switchCooldownMs:     120,     // min ms between target switches
  repeatGuardFraction:  0.4,     // must move this × keySpacing before re-selecting same key
  // Cross-row selection mode
  fixedAnchor:          true,      // true = anchor stays at original tap position, false = reanchor on each commit
  crossRowMode:         'railcar', // 'railcar' = step-based horizontal, 'raytrace' = angle-based ray projection
  // Language-weighted scoring
  frequencyWeight:      0.08,    // how much letter frequency boosts score (0 = off)
  bigramWeight:         0.12,    // how much bigram prediction boosts score (0 = off)
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
// LETTER FREQUENCY (English, normalized 0–1 with E = 1.0)
// ─────────────────────────────────────────────────────────────

const LETTER_FREQ = {
  E:1.00, T:0.70, A:0.63, O:0.58, I:0.54, N:0.52,
  S:0.49, H:0.47, R:0.46, D:0.33, L:0.31, C:0.21,
  U:0.21, M:0.19, W:0.18, F:0.17, G:0.16, Y:0.15,
  P:0.15, B:0.11, V:0.08, K:0.06, J:0.01, X:0.01,
  Q:0.01, Z:0.01,
};

// ─────────────────────────────────────────────────────────────
// BIGRAM FOLLOWERS (after letter X, top 5 most likely next letters)
// ─────────────────────────────────────────────────────────────

const BIGRAM_NEXT = {
  A: {N:0.30, L:0.18, T:0.15, R:0.12, S:0.10},
  B: {E:0.35, U:0.20, L:0.15, O:0.12, A:0.08},
  C: {O:0.30, H:0.25, A:0.15, E:0.12, K:0.10},
  D: {E:0.30, I:0.20, O:0.15, A:0.12, S:0.08},
  E: {R:0.25, S:0.20, D:0.15, N:0.12, A:0.10},
  F: {O:0.35, I:0.20, R:0.15, A:0.12, U:0.08},
  G: {H:0.25, E:0.20, O:0.18, R:0.12, A:0.10},
  H: {E:0.50, A:0.18, I:0.15, O:0.10, U:0.07},
  I: {N:0.30, S:0.20, T:0.18, O:0.12, C:0.08},
  J: {U:0.40, O:0.25, A:0.15, E:0.10, I:0.05},
  K: {E:0.35, I:0.20, N:0.15, S:0.12, A:0.08},
  L: {E:0.30, L:0.18, I:0.15, A:0.12, O:0.10},
  M: {E:0.30, A:0.20, I:0.15, O:0.12, U:0.08},
  N: {G:0.25, D:0.20, E:0.18, T:0.12, O:0.10},
  O: {N:0.25, F:0.20, R:0.18, U:0.12, T:0.10},
  P: {R:0.30, E:0.20, O:0.15, A:0.12, L:0.08},
  Q: {U:0.90, I:0.03, A:0.02, E:0.02, O:0.01},
  R: {E:0.30, O:0.20, A:0.15, I:0.12, S:0.08},
  S: {T:0.30, H:0.20, E:0.15, O:0.12, I:0.10},
  T: {H:0.55, O:0.20, I:0.10, A:0.08, E:0.07},
  U: {R:0.25, S:0.20, T:0.18, N:0.12, L:0.10},
  V: {E:0.50, I:0.20, A:0.12, O:0.08, U:0.05},
  W: {A:0.25, I:0.22, H:0.18, O:0.15, E:0.10},
  X: {P:0.30, T:0.20, I:0.18, C:0.12, A:0.08},
  Y: {O:0.25, S:0.20, E:0.18, I:0.12, A:0.10},
  Z: {E:0.40, A:0.20, O:0.15, I:0.10, Z:0.05},
};

// ── ADAPTATION HOOK ──────────────────────────────────────
// To add user-adaptive frequencies:
// 1. Track per-letter commit counts in a Map (letterCounts)
// 2. After N commits, blend: effective_freq = α × user_freq + (1-α) × LETTER_FREQ
// 3. Similarly for bigrams: track committed bigram pairs
// 4. Expose setUserFrequencies(letterMap, bigramMap) method
// 5. Persist via localStorage in the adapter
// ─────────────────────────────────────────────────────────

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

  _getKeySpacing(row) {
    const rowKeys = this._keysByRow.get(row);
    if (!rowKeys || rowKeys.length < 2) return 55;
    const sorted = rowKeys.slice().sort((a, b) => a.centerX - b.centerX);
    return (sorted[sorted.length - 1].centerX - sorted[0].centerX) / (sorted.length - 1);
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
    s.homeRow = hit.row;       // remember starting row for home bias
    s.hasLeftHome = false;     // track if user has visited another row
    s.swipeDirection = null;
    s.lastSwitchTime = 0;
    s.lastSwitchedFrom = null;
    s.lastSwitchedFromPos = null;

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

    // Gesture capture: raw pointer displacement
    const gdx = p.x - s.previousPointerPosition.x;
    const gdy = p.y - s.previousPointerPosition.y;
    if (Math.abs(gdx) > 0.5 || Math.abs(gdy) > 0.5) {
      s.gestureVectors.push({ dx: gdx, dy: gdy, t: p.timestamp });
    }

    // Track velocity buffer (raw coords — smoothing must not affect flick detection)
    this._velocityBuffer.push({ x: p.x, y: p.y, t: p.timestamp });
    // Keep last 6 samples
    if (this._velocityBuffer.length > 6) {
      this._velocityBuffer.shift();
    }

    this._updateVelocity();
    this._updateMomentum();

    // EMA pointer smoothing for candidate generation (not velocity)
    const alpha = this.cfg.smoothingAlpha;
    s.pointerPosition = {
      x: alpha * p.x + (1 - alpha) * s.previousPointerPosition.x,
      y: alpha * p.y + (1 - alpha) * s.previousPointerPosition.y,
    };

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

    // Linger gate: freeze candidates briefly after commit for post-commit stability
    if (s.lingerUntil && p.timestamp < s.lingerUntil) {
      return;
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

    // Row switching with home row bias
    // The home row (where the user first tapped) has gravity — the pointer
    // snaps back to it when close, even if the angle is shallow.
    const rowSpacing = this._rowSpacing || 50;
    const anchorKey = this._keyById.get(s.anchorKey);
    if (anchorKey) {
      // Use ray projection to determine target row
      const hasVerticalIntent = absDy > absDx * 0.15 && absDy > 3;
      let newRow = s.activeRow;

      if (hasVerticalIntent) {
        const maxRow = this._rowCenters.length > 0
          ? this._rowCenters[this._rowCenters.length - 1].row : 2;

        let bestRow = anchorKey.row;
        let bestDist = Infinity;
        const anchorY = anchorKey.centerY;
        for (const rc of this._rowCenters) {
          if (rc.row === anchorKey.row) continue;
          const rowY = rc.y;
          // Only consider rows in the direction of motion
          if ((rowY - anchorY) * dy <= 0) continue;
          // Pick the row whose center is closest to the pointer Y
          const distToPointer = Math.abs(rc.y - p.y);
          if (distToPointer < bestDist) {
            bestDist = distToPointer;
            bestRow = rc.row;
          }
        }
        newRow = bestRow;
      }

      // Home row bias: once the user has left home and is returning,
      // snap back to home row when pointer is close to it.
      // Check BEFORE updating hasLeftHome so it only applies on return.
      const homeRowCenter = this._rowCenters.find(rc => rc.row === s.homeRow);
      if (s.hasLeftHome && homeRowCenter) {
        const distToHome = Math.abs(p.y - homeRowCenter.y);
        if (distToHome < rowSpacing * 0.6) {
          newRow = s.homeRow;
        }
      }

      // Track if user has left home row (after applying bias)
      if (newRow !== s.homeRow) {
        s.hasLeftHome = true;
      }

      s.activeRow = newRow;
    }

    // Determine swipe direction
    if (absDy > absDx * 1.2) {
      s.swipeDirection = dy > 0 ? 'down' : 'up';
    } else {
      s.swipeDirection = dx > 0 ? 'right' : 'left';
    }

    // Freeze candidates during flick-speed near-vertical motion when a target is locked.
    // This prevents the flick gesture from switching rows and overwriting lockedTarget.
    // Only triggers for strongly vertical motion (>3x horizontal) to avoid blocking
    // legitimate diagonal cross-row slides.
    const isFlickSpeed = s.speed > this.cfg.flickSpeedThreshold;
    const isNearVertical = Math.abs(s.velocity.y) > Math.abs(s.velocity.x) * 3;
    const skipCandidates = isFlickSpeed && isNearVertical && s.lockedTarget;

    if (!skipCandidates) {
      // Generate candidates: grid path (default) or scoring path
      if (this.cfg.useScoring) {
        this._generateRowLockedCandidates(p.timestamp);
      } else {
        this._generateGridCandidates(p.timestamp);
      }
    }

    // Layer 2: check for commit gestures
    this._checkFlickUp(p.timestamp);
    this._checkFlickDown(p.timestamp);
    this._checkHorizontalSnap(p.timestamp);
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
        confidence: 0,
        confidenceZone: 'none',
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
      confidence: s.confidence,
      confidenceZone: s.confidenceZone,
      momentum: s.momentum,
      velocity: { x: s.velocity.x, y: s.velocity.y },
      speed: s.speed,
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
      // Confidence system
      confidence:              0,        // 0-1 certainty of current selection
      confidenceZone:          'none',   // 'hot' | 'warm' | 'uncertain' | 'none'
      topCandidateSince:       0,        // timestamp when current topCandidate was set
      // Momentum & linger
      momentum:                0,        // velocity * direction stability (0-1)
      lingerUntil:             0,        // timestamp until candidates are frozen after commit
      // Sticky key behavior
      lastSwitchTime:          0,        // timestamp of last topCandidate switch
      lastSwitchedFrom:        null,     // key ID we just left
      lastSwitchedFromPos:     null,     // {x, y} center of that key
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

    // Get keys in the swipe direction
    const crossRow = s.activeRow !== anchorKey.row;
    const keySpacing = this._getKeySpacing(s.activeRow);
    let ordered;
    if (crossRow && this.cfg.crossRowMode === 'railcar') {
      // RAIL CAR: order keys from anchor's X outward in swipe direction
      const homeX = anchorKey.centerX;
      const tolerance = keySpacing * 0.3;
      if (dir === 'right') {
        ordered = warpedKeys.filter(k => k.centerX >= homeX - tolerance);
        ordered.sort((a, b) => a.centerX - b.centerX);
      } else if (dir === 'left') {
        ordered = warpedKeys.filter(k => k.centerX <= homeX + tolerance);
        ordered.sort((a, b) => b.centerX - a.centerX);
      } else {
        // Vertical only — all keys, sorted by distance from homeX
        ordered = warpedKeys.slice();
        ordered.sort((a, b) => Math.abs(a.centerX - homeX) - Math.abs(b.centerX - homeX));
      }
    } else if (crossRow) {
      // RAY TRACE: no directional filter (stagger makes left/right unreliable)
      ordered = warpedKeys.slice();
    } else if (dir === 'right') {
      ordered = warpedKeys.filter(k => k.centerX > anchorKey.centerX);
      // Sort by distance from anchor (nearest first) for step-based indexing
      ordered.sort((a, b) => a.centerX - b.centerX);
    } else if (dir === 'left') {
      ordered = warpedKeys.filter(k => k.centerX < anchorKey.centerX);
      ordered.sort((a, b) => b.centerX - a.centerX); // nearest first
    } else {
      // Vertical — all keys on target row
      ordered = warpedKeys.slice();
    }

    if (ordered.length === 0) {
      s.candidates = [];
      s.topCandidate = null;
      return;
    }

    const adx = px - anchorKey.centerX;
    const ady = py - anchorKey.centerY;

    // Momentum: boost keys aligned with velocity direction
    const mw = this.cfg.momentumWeight;
    const hasVel = s.speed > 1;
    const velNorm = hasVel ? vecNormalize(s.velocity.x, s.velocity.y) : { x: 0, y: 0 };

    // Hot radius: force-lock threshold (raytrace mode only)
    const hotDist = keySpacing * this.cfg.hotRadius;

    const scored = ordered.map((k, i) => {
      let score;

      if (crossRow && this.cfg.crossRowMode === 'railcar') {
        // RAIL CAR: step-based from home position (key above/below anchor)
        const homeX = anchorKey.centerX;
        const swipeDist = Math.abs(adx);
        const stepIndex = swipeDist / this.cfg.gridStepSize;
        const keyDistFromHome = Math.abs(k.centerX - homeX) / keySpacing;
        const indexDist = Math.abs(stepIndex - keyDistFromHome);
        score = Math.exp(-indexDist * indexDist * 2.0);
      } else if (crossRow) {
        // RAY TRACE: angle-based projection from anchor through pointer to target row
        let hitX;
        if (Math.abs(ady) > 1) {
          const targetRowY = ordered[0].centerY;
          const t = (targetRowY - anchorKey.centerY) / ady;
          hitX = anchorKey.centerX + adx * t;
        } else {
          hitX = px;
        }
        const aimDist = Math.abs(k.centerX - hitX);
        const normDist = aimDist / keySpacing;
        score = Math.exp(-normDist * normDist * 2.0);
      } else {
        // SAME-ROW: step-based indexing — swipe distance from anchor
        const swipeDist = Math.abs(adx);
        const stepIndex = swipeDist / this.cfg.gridStepSize;
        const indexDist = Math.abs(stepIndex - (i + 1));
        score = Math.exp(-indexDist * indexDist * 2.0);
      }

      // Hot radius: force-lock when pointer is very close to key center
      // Only in raytrace mode — rail car and same-row use step-based indexing
      if (crossRow && this.cfg.crossRowMode === 'raytrace') {
        const rawDist = dist(k.centerX, k.centerY, px, py);
        if (rawDist < hotDist) {
          score = 1.0;
        }
      }

      // Momentum boost: keys in the direction of motion get a bump
      if (mw > 0 && hasVel && s.momentum > 0.2) {
        const toKey = vecNormalize(k.centerX - anchorKey.centerX, k.centerY - anchorKey.centerY);
        const alignment = Math.max(0, vecDot(velNorm.x, velNorm.y, toKey.x, toKey.y));
        score += mw * alignment * s.momentum;
      }

      // Frequency boost: common letters score higher
      if (this.cfg.frequencyWeight > 0) {
        score += this.cfg.frequencyWeight * (LETTER_FREQ[k.label] || 0);
      }

      // Bigram boost: letters likely to follow the last typed letter
      if (this.cfg.bigramWeight > 0 && s.lastCommittedKey) {
        const lastLabel = this._keyById.get(s.lastCommittedKey)?.label;
        if (lastLabel && BIGRAM_NEXT[lastLabel]) {
          score += this.cfg.bigramWeight * (BIGRAM_NEXT[lastLabel][k.label] || 0);
        }
      }

      const brightness = Math.max(0.12, Math.min(1.0, score));
      return {
        id: k.id,
        label: k.label,
        dist: Math.abs(k.centerX - anchorKey.centerX),
        score,
        brightness,
        order: i,
      };
    });

    // Sort by score (highest first)
    scored.sort((a, b) => b.score - a.score);

    // Take up to 8
    const chosen = scored.slice(0, this.cfg.candidateCount);

    // Sticky key gate — resist switching unless all conditions are met
    const prevTop = s.topCandidate;
    if (chosen.length > 0) {
      const newTop = chosen[0].id;
      if (newTop !== prevTop) {
        const oldInList = chosen.find(c => c.id === prevTop);
        const oldScore = oldInList ? oldInList.score : 0;

        if (prevTop && !this._shouldSwitchTarget(newTop, chosen[0].score, prevTop, oldScore, timestamp)) {
          // Keep old top candidate — switch conditions not met
          s.topCandidate = prevTop;
        } else {
          // Switch approved
          if (prevTop) {
            s.lockedTarget = prevTop;
            s.lastSwitchedFrom = prevTop;
            const prevKey = this._keyById.get(prevTop);
            s.lastSwitchedFromPos = prevKey ? { x: prevKey.centerX, y: prevKey.centerY } : null;
          }
          s.topCandidate = newTop;
          s.topCandidateSince = timestamp;
          s.lastSwitchTime = timestamp;
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
    this._computeConfidence(timestamp);
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
    const crossRow = s.activeRow !== anchorKey.row;
    let directional;
    if (crossRow) {
      // Cross-row: no directional filter (stagger makes left/right unreliable)
      directional = rowKeys.slice();
    } else if (dir === 'right') {
      directional = rowKeys.filter(k => k.centerX > anchorKey.centerX);
    } else if (dir === 'left') {
      directional = rowKeys.filter(k => k.centerX < anchorKey.centerX).reverse();
    } else if (dir === 'up' || dir === 'down') {
      directional = rowKeys.slice();
    } else {
      directional = [];
    }

    if (directional.length === 0) {
      s.candidates = [];
      s.topCandidate = null;
      return;
    }

    // Compute horizontal spacing between adjacent keys on this row
    const keySpacing = this._getKeySpacing(s.activeRow);

    // ANGLE-BASED AIMING: score by proximity to where the user is pointing
    const px = s.pointerPosition.x;
    const py = s.pointerPosition.y;
    const adx = px - anchorKey.centerX;
    const ady = py - anchorKey.centerY;

    const scored = directional.map((k, idx) => {
      let aimX;
      if (crossRow && Math.abs(ady) > 1) {
        // Ray projection: anchor→pointer ray extended to target row
        const t = (k.centerY - anchorKey.centerY) / ady;
        aimX = anchorKey.centerX + adx * t;
      } else {
        // Same-row: pointer X position is the aim point
        aimX = px;
      }

      const pointerDist = Math.abs(k.centerX - aimX) / keySpacing;
      let score = Math.exp(-pointerDist * pointerDist * 2.0);

      // Frequency boost
      if (this.cfg.frequencyWeight > 0) {
        score += this.cfg.frequencyWeight * (LETTER_FREQ[k.label] || 0);
      }

      // Bigram boost
      if (this.cfg.bigramWeight > 0 && s.lastCommittedKey) {
        const lastLabel = this._keyById.get(s.lastCommittedKey)?.label;
        if (lastLabel && BIGRAM_NEXT[lastLabel]) {
          score += this.cfg.bigramWeight * (BIGRAM_NEXT[lastLabel][k.label] || 0);
        }
      }

      return {
        id: k.id,
        label: k.label,
        dist: Math.abs(k.centerX - anchorKey.centerX),
        score,
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

    // Sticky key gate — resist switching unless all conditions are met
    const prevTop = s.topCandidate;
    if (chosen.length > 0) {
      const newTop = chosen[0].id;
      if (newTop !== prevTop) {
        const oldInList = chosen.find(c => c.id === prevTop);
        const oldScore = oldInList ? oldInList.score : 0;

        if (prevTop && !this._shouldSwitchTarget(newTop, chosen[0].score, prevTop, oldScore, timestamp)) {
          s.topCandidate = prevTop;
        } else {
          if (prevTop) {
            s.lockedTarget = prevTop;
            s.lastSwitchedFrom = prevTop;
            const prevKey = this._keyById.get(prevTop);
            s.lastSwitchedFromPos = prevKey ? { x: prevKey.centerX, y: prevKey.centerY } : null;
          }
          s.topCandidate = newTop;
          s.topCandidateSince = timestamp;
          s.lastSwitchTime = timestamp;
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
    this._computeConfidence(timestamp);
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
  // PRIVATE — momentum computation
  // ─────────────────────────────────────────────────────────

  _updateMomentum() {
    const s = this._state;
    const buf = this._velocityBuffer;
    if (buf.length < 4 || s.speed < 1) {
      s.momentum = 0;
      return;
    }

    // Direction stability: cosine similarity between recent and prior velocity
    const n1 = buf[buf.length - 1];
    const n2 = buf[buf.length - 2];
    const n3 = buf[buf.length - 3];
    const n4 = buf[buf.length - 4];

    const dt1 = n1.t - n2.t;
    const dt2 = n3.t - n4.t;
    if (dt1 <= 0 || dt2 <= 0) { s.momentum = 0; return; }

    const vx1 = (n1.x - n2.x) / dt1;
    const vy1 = (n1.y - n2.y) / dt1;
    const vx2 = (n3.x - n4.x) / dt2;
    const vy2 = (n3.y - n4.y) / dt2;

    const stability = cosineSimilarity(vx1, vy1, vx2, vy2);
    // momentum = speed (normalized) * direction consistency
    const normSpeed = Math.min(s.speed / 15, 1.0); // cap at 15
    s.momentum = Math.max(0, normSpeed * stability);
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — confidence computation
  // ─────────────────────────────────────────────────────────

  _computeConfidence(timestamp) {
    const s = this._state;
    if (!s.topCandidate) {
      s.confidence = 0;
      s.confidenceZone = 'none';
      return;
    }

    // Single candidate = no ambiguity = maximum score gap
    const scoreGap = s.candidates.length < 2
      ? 1.0
      : Math.min((s.candidates[0].score - s.candidates[1].score) / 0.3, 1.0);

    // Factor 2: Dwell time — how long topCandidate has been stable (0-1 over 200ms)
    const dwell = Math.min((timestamp - s.topCandidateSince) / 200, 1.0);

    // Factor 3: Pointer stability — inverse of speed (0-1)
    const stability = 1.0 / (1.0 + s.speed * 0.3);

    // Weighted blend
    s.confidence = scoreGap * 0.5 + dwell * 0.3 + stability * 0.2;

    // Zone classification
    if (s.confidence > 0.7) s.confidenceZone = 'hot';
    else if (s.confidence > 0.3) s.confidenceZone = 'warm';
    else s.confidenceZone = 'uncertain';
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — sticky key switch gate
  // ─────────────────────────────────────────────────────────

  _shouldSwitchTarget(newTopId, newTopScore, oldTopId, oldTopScore, timestamp) {
    const s = this._state;
    const anchorKey = this._keyById.get(s.anchorKey);
    const oldKey = this._keyById.get(oldTopId);
    const isSameRow = oldKey && anchorKey && s.activeRow === anchorKey.row;

    // ── SAME-ROW: simple score margin only ──────────────
    // Step-based indexing already provides natural zones.
    // Only gate: the score margin must exceed sameRowHysteresis.
    if (isSameRow) {
      return (newTopScore - oldTopScore) >= this.cfg.sameRowHysteresis;
    }

    // ── CROSS-ROW: full sticky gate system ──────────────

    // Score margin
    if (newTopScore - oldTopScore < this.cfg.hysteresis * 0.5) return false;

    // Speed gate — slow movement = hold current key
    if (s.speed < this.cfg.stickySpeedGate) return false;

    // Switch cooldown — no rapid back-and-forth
    if (s.lastSwitchTime > 0 && (timestamp - s.lastSwitchTime) < this.cfg.switchCooldownMs) {
      return false;
    }

    // Direction gate — velocity must point toward new key
    const newKey = this._keyById.get(newTopId);
    if (newKey && oldKey && s.speed > 0) {
      const velNorm = vecNormalize(s.velocity.x, s.velocity.y);
      const toNew = vecNormalize(
        newKey.centerX - oldKey.centerX,
        newKey.centerY - oldKey.centerY
      );
      const alignment = vecDot(velNorm.x, velNorm.y, toNew.x, toNew.y);
      if (alignment < this.cfg.stickyDirectionGate) return false;
    }

    // Exit distance — must be far enough from current key
    if (oldKey) {
      const pointerDistFromOld = dist(
        s.pointerPosition.x, s.pointerPosition.y,
        oldKey.centerX, oldKey.centerY
      );
      const keySpacing = this._getKeySpacing(s.activeRow);
      const exitThreshold = keySpacing * this.cfg.stickyExitFraction;
      if (pointerDistFromOld < exitThreshold) return false;
    }

    // Repeat guard — can't re-select a key we just left without moving away
    if (newTopId === s.lastSwitchedFrom && s.lastSwitchedFromPos) {
      const keySpacing = this._getKeySpacing(s.activeRow);
      const distFromOldPos = dist(
        s.pointerPosition.x, s.pointerPosition.y,
        s.lastSwitchedFromPos.x, s.lastSwitchedFromPos.y
      );
      if (distFromOldPos < keySpacing * this.cfg.repeatGuardFraction) return false;
    }

    return true;
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — flick-up detection
  // ─────────────────────────────────────────────────────────

  _checkFlickUp(timestamp) {
    const s = this._state;
    if (s.flickState !== 'sliding') return;
    if (!s.topCandidate && !s.lockedTarget) return;

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

  // ─────────────────────────────────────────────────────────
  // PRIVATE — horizontal snap detection (same-row commit)
  // ─────────────────────────────────────────────────────────

  _checkHorizontalSnap(timestamp) {
    const s = this._state;
    if (s.flickState !== 'sliding') return;
    if (!s.topCandidate) return;

    // Only applies on the same row as anchor
    const anchorKey = this._keyById.get(s.anchorKey);
    if (!anchorKey || s.activeRow !== anchorKey.row) return;

    const buf = this._velocityBuffer;
    if (buf.length < 5) return;

    // Recent horizontal velocity (last 2 samples)
    const r1 = buf[buf.length - 1];
    const r2 = buf[buf.length - 2];
    const r3 = buf[buf.length - 3];
    const r4 = buf[buf.length - 4];
    const dt1 = r1.t - r2.t;
    const dt2 = r3.t - r4.t;
    if (dt1 <= 0 || dt2 <= 0) return;

    const recentVx = Math.abs((r1.x - r2.x) / dt1 * 16);
    const recentVy = Math.abs((r1.y - r2.y) / dt1 * 16);
    const priorVx = Math.abs((r3.x - r4.x) / dt2 * 16);

    // Must be primarily horizontal (not vertical flick)
    if (recentVy > recentVx * 0.8) return;

    // Must exceed speed threshold
    if (recentVx < this.cfg.snapSpeedThreshold) return;

    // Must show acceleration: recent >> prior (slow→fast pattern)
    // Prior must have been slow (below threshold) to avoid sustain false positives
    if (priorVx > this.cfg.snapSpeedThreshold * 0.6) {
      // Was already fast — only allow if clear acceleration
      if (recentVx < priorVx * this.cfg.snapAccelRatio) return;
    }

    // Snap confirmed — commit locked target
    const commitTarget = s.lockedTarget || s.topCandidate;
    if (!commitTarget) return;
    this._commitFlick(commitTarget, timestamp);
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

    // Enter cooldown + linger
    s.flickState = 'cooldown';
    s.flickCooldownUntil = timestamp + this.cfg.flickCooldownMs;
    s.lingerUntil = timestamp + this.cfg.lingerMs;
    this._velocityBuffer = [];

    // Sticky key: clear guard state (user stays on anchor)
    s.lastSwitchTime = 0;
    s.lastSwitchedFrom = null;
    s.lastSwitchedFromPos = null;
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

    // Reanchor: fixed anchor keeps the original tap position, mobile anchor moves to committed key
    if (!this.cfg.fixedAnchor) {
      s.anchorKey      = keyId;
      s.anchorPosition = { x: key.centerX, y: key.centerY };
      s.activeRow      = key.row;
    } else {
      // Fixed anchor: stay at original tap position, reset to home row
      s.activeRow = this._keyById.get(s.anchorKey)?.row ?? s.activeRow;
    }
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

    // Enter cooldown + linger
    s.flickState = 'cooldown';
    s.flickCooldownUntil = timestamp + this.cfg.flickCooldownMs;
    s.lingerUntil = timestamp + this.cfg.lingerMs;

    // Reset velocity buffer to prevent double-flick
    this._velocityBuffer = [];

    // Sticky key: committed key becomes "last switched from" for repeat guard
    s.lastSwitchTime = 0;
    s.lastSwitchedFrom = keyId;
    s.lastSwitchedFromPos = { x: key.centerX, y: key.centerY };
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
        const crossRow = targetRow !== a.row;
        let candidates;
        if (crossRow) {
          // Cross-row: sort all target row keys by X-distance from B
          // (mirrors the live engine's pointer-proximity logic)
          candidates = rowKeys.slice().sort((x, y) =>
            Math.abs(x.centerX - b.centerX) - Math.abs(y.centerX - b.centerX)
          );
        } else if (direction === 'right') {
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
        // With pointer-proximity aiming, all keys in the candidate list are
        // equally reachable by pointing — so any key in the list is "direct"
        const idx = candidates.findIndex(k => k.id === b.id);
        let status;
        if (idx >= 0) {
          status = 'direct';
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
