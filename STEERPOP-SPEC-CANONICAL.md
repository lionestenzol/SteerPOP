# SteerPop — Canonical Engineering Specification

**Version:** 1.0 (reverse-engineered from implementation v0.4)
**Date:** 2026-03-22
**Status:** Contractor-grade reference specification
**Source of truth:** `steerpop-engine.js` (1001 lines), `web-adapter.js` (613 lines), `index.html` (375 lines), `steerpop-test.js` (350 lines)

---

# 1. Executive Summary

## What SteerPop Is

SteerPop is a motion-first, QWERTY-based keyboard input system. The user taps once to anchor and commit the first letter, slides without lifting to steer through candidate letters, and flicks upward to confirm candidates — all in a single continuous gesture. It preserves per-letter control while dramatically reducing finger-lift frequency.

It is **not** swipe typing (no word-level path matching). It is **not** predictive text (no probabilistic replacement). It is a deliberate, character-at-a-time gestural input system that happens to be faster than tap-tap-tap.

## Current Maturity Level

**Late prototype / early architecture.** The engine/adapter separation is clean and enforced. Core gesture mechanics (tap, slide, flick, cooldown, reanchor) are implemented and working. The system runs in a browser-based tuning lab with real-time parameter adjustment. Two candidate generation paths exist (grid and scoring). Trace replay and deterministic testing infrastructure are in place.

Not production-ready: missing backspace, space, punctuation, repeated-letter handling, accessibility, multi-touch, and mobile-specific tuning. Suggestion system is a hardcoded 24-entry lookup table.

## Biggest Strengths

1. **Clean engine/adapter boundary** — engine has zero DOM references (verified by automated test). Same engine can be wrapped for Android, iOS, desktop, or test harness.
2. **Deterministic trace replay** — `replayTrace()` produces identical event sequences for identical input traces. Enables reproducible testing and regression protection.
3. **Grid-based candidate generation** — simple, predictable, QWERTY-preserving. Users can reason about which key they'll hit because the mapping is spatial, not statistical.
4. **Real-time tuning lab** — sliders for gridStepSize, deadzoneRadius, flickSpeedThreshold, warpStrength, fingerRadius with immediate visual feedback. Accelerates design iteration.
5. **Flick detection with locked-target safety** — commits the *pre-flick* stable target, not whatever the pointer was over during the flick gesture itself.

## Biggest Risks

1. **No repeated-letter handling** — typing "LL", "EE", "OO" etc. currently requires lifting and re-tapping. This is a core interaction gap.
2. ~~**Determinism bug**~~ — **FIXED.** `Date.now()` has been removed from the engine. All event timestamps now use pointer-provided timestamps. Test #11 verifies no `Date.now()` in engine source. Test #20 verifies all timestamps fall within trace time range.
3. **Suggestion system is a stub** — 24 hardcoded bigram mappings. Not a real prediction system. Risk of being mistaken for a finished feature.
4. **Scoring path is untested** — `useScoring: true` activates `_generateRowLockedCandidates()` which has zero test coverage and different hysteresis logic than the grid path.
5. **No mobile validation** — all development has been mouse-based in a desktop browser. Touch event handling exists but finger occlusion, palm rejection, and real-device gesture feel are untested.

---

# 2. Product Definition

## One-Sentence Definition

SteerPop is a gestural keyboard that lets users type by anchoring on a key, sliding to steer through nearby candidates, and flicking upward to commit — producing one character per flick without lifting the finger between letters.

## Core Promise

Type faster than tap-typing while keeping full per-letter control. No word-guessing, no auto-correction, no loss of agency.

## What It Is

- A motion-first input system built on QWERTY layout
- A character-at-a-time keyboard with reduced lift frequency
- A slide-then-pop interaction model (not slide-to-spell)
- A system where the user always knows what letter they're about to commit

## What It Is Not

- **Not swipe typing** — does not trace word shapes or match against a dictionary
- **Not predictive text** — does not replace or reinterpret user input
- **Not an autocomplete engine** — suggestion layer is subordinate and never auto-fires
- **Not a radial/pie menu keyboard** — uses linear grid traversal, not angular sectors
- **Not a research prototype** — designed for production deployment on mobile

## Intended User Experience

1. User touches a letter — it enters immediately (like normal typing)
2. User keeps finger down and slides — nearby keys light up showing what's reachable
3. User sees the desired letter highlighted as the top candidate in a floating bubble
4. User flicks upward — that letter commits, anchor moves to it, ready for next slide
5. User continues sliding and flicking without lifting
6. User lifts finger — session ends

The experience should feel like "steering through text" — fluid, continuous, and always under the user's direct control.

---

# 3. Current Implementation Summary

## What Is Actually Built Today

| Feature | Status | Location |
|---------|--------|----------|
| Engine/adapter separation | **IMPLEMENTED** | `steerpop-engine.js` / `web-adapter.js` |
| Tap-to-commit (Layer 0) | **IMPLEMENTED** | Engine line 240-285 |
| Slide candidate generation (grid path) | **IMPLEMENTED** | Engine line 620-720 |
| Slide candidate generation (scoring path) | **IMPLEMENTED** | Engine line 726-837 |
| Row switching via Y-displacement | **IMPLEMENTED** | Engine line 333-346 |
| Flick-up detection | **IMPLEMENTED** | Engine line 869-916 |
| Flick cooldown | **IMPLEMENTED** | Engine line 956-958 |
| Reanchoring after flick | **IMPLEMENTED** | Engine line 938-946 |
| Locked-target safety for flick | **IMPLEMENTED** | Engine line 913 |
| Velocity buffer (6 samples, 3 for smoothing) | **IMPLEMENTED** | Engine line 843-862 |
| Deadzone radius filtering | **IMPLEMENTED** | Engine line 306-311 |
| Hysteresis (scoring path only) | **PARTIAL** | Engine line 813-835 (grid path has none, line 701-717) |
| Key warp (visual pull toward pointer) | **IMPLEMENTED** | Engine line 165-209, Adapter line 349-367 |
| Warp-aware candidate generation | **IMPLEMENTED** | Engine line 640-643 |
| Trace replay / deterministic execution | **IMPLEMENTED** | Engine line 376-391. Date.now() bug fixed. Tests #10, #18-20 verify determinism. |
| Suggestion system (bigram lookup) | **PARTIAL** | Engine line 968-973 (24 hardcoded entries) |
| Suggestion acceptance via adapter | **IMPLEMENTED** | Adapter line 260-269 |
| Canvas overlay rendering | **IMPLEMENTED** | Adapter line 396-552 |
| DOM key highlighting | **IMPLEMENTED** | Adapter line 309-341 |
| Debug panel with live values | **IMPLEMENTED** | Adapter line 373-390 |
| Event log | **IMPLEMENTED** | Adapter line 292-301 |
| Control sliders (5) and toggles (4) | **IMPLEMENTED** | Adapter line 559-580 |
| Finger cursor overlay | **IMPLEMENTED** | Adapter line 67-119 |
| Test suite (11 test sections, ~20 assertions) | **IMPLEMENTED** | `steerpop-test.js` |
| Engine purity test (no DOM refs) | **IMPLEMENTED** | Test section 11 |

## What Is Simulated / Demo-Only

| Feature | Status | Notes |
|---------|--------|-------|
| Suggestion system | **STUB** | 24 hardcoded bigrams. Not a real word-completion system. |
| `steerpop-demo.html` | **LEGACY** | Monolithic earlier prototype. All logic inline. Not connected to current engine. |
| `steerpop-v02.html` | **LEGACY** | "Floating Probability Field" prototype. Different interaction model. Not connected to current engine. |
| Finger cursor | **SIMULATION** | Desktop mouse simulation of touch finger. Not representative of real mobile occlusion. |

## What Is Missing

| Feature | Status | Impact |
|---------|--------|--------|
| Repeated-letter handling | **IMPLEMENTED** | Flick-down repeats anchor letter. `_checkFlickDown()` + `_commitRepeat()`. Tests #21-22. |
| Backspace / delete | **IMPLEMENTED** | Adapter handles `⌫` label in `processEvents()`. Test #23. |
| Space key | **IMPLEMENTED** | Adapter handles `SPACE` label, appends `' '`. Test #26. |
| Punctuation / symbols | **IMPLEMENTED** | `. , '` keys in ROWS, adapter appends literally. Test #27. |
| Shift / capitalization | **MISSING** | All output is uppercase. |
| Multi-touch handling | **IMPLEMENTED** | `activePointerId` tracking in adapter rejects secondary touches. |
| Palm rejection | **MISSING** | No filtering for accidental large-area touches. |
| Touch-specific gesture tuning | **MISSING** | All thresholds tuned for mouse, not finger. |
| Accessibility | **PARTIAL** | Basic ARIA: `aria-live="polite"` on output, `role="button"` on keys, `aria-label` per key. No per-commit assertive announcements. |
| Sound / haptic feedback | **MISSING** | No commit confirmation beyond screen flash. |
| Session timeout | **IMPLEMENTED** | Adapter: 3s inactivity timeout via `resetSessionTimeout()`. |
| Undo | **MISSING** | No way to undo last commit. |
| Real word prediction | **MISSING** | Would require dictionary, frequency model, or LLM integration. |
| Performance monitoring | **MISSING** | No frame time tracking, no input latency measurement. |

---

# 4. User Interaction Model

## Session Start — **IMPLEMENTED**

1. User places finger (or clicks mouse) on any key within the keyboard bounds
2. Engine performs hit test: finds nearest key within `max(width, height) * 0.6` radius (engine line 519-531)
3. If hit: session starts, Layer 0 fires immediately
4. If no hit (empty space): no session starts, no action taken
5. Events emitted: `session_started`, `letter_committed` (commitType: `tap`)

**Edge case:** If touch lands equidistant between two keys, closest-center wins. No tie-breaking strategy exists beyond floating-point distance comparison.

## Anchor Behavior — **IMPLEMENTED**

- **Initial anchor:** Set to the tapped key on pointerDown (engine line 249-250)
- **Anchor position:** Set to key's `centerX/centerY` (not the pointer position)
- **Reanchoring after flick:** Anchor moves to the committed key's center position (engine line 939-940)
- **Anchor during slide:** Does not move. Stays fixed until flick commits.
- **Anchor display:** Cyan-highlighted key in DOM + cyan dot on canvas

**Note:** Anchor position is always a key center, never an arbitrary pointer position. This is intentional — it keeps the distance-to-candidate math grid-aligned.

## Candidate Behavior — **IMPLEMENTED**

### Grid Path (default, `useScoring: false`)

1. Swipe direction determined: `left`, `right`, `up`, `down` (engine line 348-353)
2. Active row determined by Y-displacement from anchor (engine line 333-346)
3. Keys on active row filtered by swipe direction
4. Keys sorted in swipe direction (nearest first)
5. Effective slide distance = `abs(pointer - anchor) - deadzoneRadius` (engine line 675)
6. Key index = `floor(effectiveDistance / gridStepSize)` (engine line 676)
7. Active key gets brightness 1.0, neighbors dim by 0.25 per step (engine line 683)
8. Up to `candidateCount` (8) candidates returned

### Scoring Path (opt-in, `useScoring: true`)

1. Same direction/row determination
2. Keys filtered by direction on active row
3. Each key scored by Gaussian reach-match: `exp(-reachDiff^2 * 2.0)` where reachDiff = `|slideDist - keyDist| / keySpacing` (engine line 790)
4. Hysteresis applied: new top must beat old top by `hysteresis * 0.5` margin (engine line 819)
5. Up to `candidateCount` candidates, brightness assigned by rank

### Key Warp Integration (grid path only) — **IMPLEMENTED**

Grid candidate generation uses **warped** key positions (engine line 640-643). Keys visually and logically "pull" toward the pointer, which means the candidate ordering is affected by warp strength. This is a deliberate design choice but creates a coupling between a visual effect and core logic.

## Target Selection — **IMPLEMENTED**

- **Top candidate:** Highest-scoring candidate becomes `topCandidate`
- **Locked target:** Before each target change, the previous top becomes `lockedTarget` (engine line 706-714)
- **Purpose of locked target:** When flick fires, it commits `lockedTarget || topCandidate` (engine line 913). This prevents the flick gesture itself from changing what gets committed.
- **Bubble display:** Top candidate shown as floating green circle above anchor at `haloOffset` (90px) distance

## Pop/Commit Behavior — **IMPLEMENTED**

### Flick-Up Detection (engine line 869-916)

Preconditions:
1. `flickState` must be `sliding` (not `idle` or `cooldown`)
2. A `topCandidate` must exist
3. Velocity buffer must have at least 5 samples

Detection logic:
1. Compute recent velocity from last 2 samples (normalized to ~16ms per frame)
2. Recent Y-velocity must be negative (upward)
3. Recent speed must exceed `flickSpeedThreshold` (default: 10)
4. Flick angle (degrees from vertical) must be within `flickAngleThreshold` (default: 40)
5. **Anti-sustain check:** Previous Y-velocity must NOT have been strongly upward (> threshold * 0.8). Exception: allowed if current upward speed is >= 1.8x previous (true acceleration)

On commit (engine line 922-962):
1. Emit `flick_confirmed` event
2. Emit `letter_committed` event (commitType: `flick`)
3. Reanchor to committed key
4. Clear candidates, topCandidate, lockedTarget, swipeAngle
5. Reset activeRow to committed key's row
6. Update suggestion
7. Enter cooldown: `flickState = 'cooldown'`, `flickCooldownUntil = timestamp + flickCooldownMs`
8. Clear velocity buffer

### Cooldown (engine line 314-320)

During cooldown, `pointerMove` returns early — no candidate generation, no flick detection. Cooldown lifts when `timestamp >= flickCooldownUntil`. Default cooldown: 350ms.

## Repeated Letters — **IMPLEMENTED**

There is no mechanism to commit the same letter that is currently the anchor. Since the anchor key is excluded from directional candidates (it's the reference point), and since there is no "tap-again" or "double-flick" gesture, typing repeated letters (LL, EE, OO, SS, etc.) requires:
1. Lift finger (end session)
2. Tap the same key again (start new session)

This defeats the core promise of reduced lift frequency and is the most critical interaction gap.

## Suggestion Acceptance — **IMPLEMENTED**

- Suggestion computed after each commit via bigram lookup (engine line 968-973)
- Displayed as purple pill above the top-candidate bubble
- **Acceptance mechanism:** Not implemented in the engine — the adapter handles `suggestion_committed` events but there is no gesture to trigger suggestion acceptance. The suggestion system emits `suggestion_shown` but never `suggestion_committed` from the engine.
- **Status:** The suggestion display is **IMPLEMENTED** but the acceptance gesture is **MISSING** from the engine. The adapter has dead code for handling `suggestion_committed` events (adapter line 260-269).

## Session End — **IMPLEMENTED**

- Triggered by `pointerUp` (engine line 366-372)
- Emits `session_ended` event
- Clears all session state (engine line 496-508)
- Clears velocity buffer
- **Touch cancel** also triggers session end (adapter line 236)
- **Mouse leave** does NOT end session (adapter line 228-232) — intentional, allows user to flick above keyboard

## Fallback Behavior — **PARTIAL**

| Scenario | Current Behavior | Status |
|----------|-----------------|--------|
| Tap with no slide | Letter commits, session stays active until lift | **IMPLEMENTED** |
| Slide then lift (no flick) | Session ends, no additional commit | **IMPLEMENTED** |
| Tap outside keyboard bounds | No session starts | **IMPLEMENTED** |
| Very fast tap-and-lift | Letter commits (no minimum hold time) | **IMPLEMENTED** |
| Slide into deadzone during slide | Candidates clear, waiting for slide to resume | **IMPLEMENTED** |
| Flick during cooldown | Ignored until cooldown expires | **IMPLEMENTED** |
| Pointer leaves keyboard area | Session stays active (mouse); implementation-dependent (touch) | **PARTIAL** |

---

# 5. UI / Visual System

## Base Keyboard — **IMPLEMENTED**

- Standard 3-row QWERTY layout: 10-9-7 keys
- Fixed key size: 50x50px with 5px gap
- Row stagger: CSS flexbox centering (rows 1 and 2 naturally narrower)
- Dark theme: `#131820` key background, `#1e2840` border, `#8898b8` text
- All uppercase labels
- Crosshair cursor on keys and body
- Keys have CSS transitions on background, border-color, color, and transform (0.08-0.15s)

## Floating Top-Candidate Bubble — **IMPLEMENTED**

- Canvas-drawn circle positioned at `(anchor.x, anchor.y - haloOffset)` where `haloOffset = 90px`
- Radius: `bubbleSize * 1.4` (default: ~50px)
- Fill: radial gradient from `rgba(0,255,170,0.5)` to `rgba(0,80,60,0.8)`
- Glow: radial gradient halo at 2x radius
- Border: 2px `rgba(0,255,170,0.9)`
- Label: white bold letter, font size = `radius * 0.7`
- Upward arrow hint above bubble (two short lines forming a chevron)
- Togglable via "Show Top Bubble" control

## Active Target Styling — **IMPLEMENTED**

Three key states via CSS classes:

| Class | Appearance | Meaning |
|-------|-----------|---------|
| `.anchor-active` | Cyan bg glow, cyan border/text | Current anchor key |
| `.highlight-top` | Green bg glow, green border/text | Top candidate (would commit on flick) |
| `.highlight` | Cyan border/text, variable opacity | Other candidate (dimmer = further from top) |

Highlights togglable via "Key Highlights" control.

## Suggestion Console — **IMPLEMENTED**

- Canvas-drawn rounded pill shape
- Positioned above the top-candidate bubble at `anchor.y - haloOffset - bubbleSize * 2.5`
- Size: 110x30px
- Background: `rgba(25,15,40,0.85)` with purple border
- Label: `"→ {word}"` in purple (`rgba(192,132,252,0.8)`)
- Togglable via "Suggestion Console" control

## Debug / Control Surfaces — **IMPLEMENTED**

### Control Panel (side panel, top card)
5 sliders: Grid Step, Warp Pull, Deadzone, Flick Speed, Finger Size
4 toggles: Show Top Bubble, Key Highlights, Suggestion Console, Debug Labels

### Debug Panel (side panel, middle card)
12 live-updating values in a 2-column grid:
Session, Anchor, Target, Distance, Flick State, Swipe Angle, Speed, Candidates, Last Commit, Suggestion, Active Row, Swipe Dir

### Event Log
Scrolling log showing engine events, color-coded:
- Green (`.ev-commit`): letter commits
- Orange (`.ev-armed`): flick confirmations
- Cyan (`.ev-info`): session start/end, target changes
- Max 60 entries, oldest pruned

### Finger Cursor Overlay — **IMPLEMENTED**
Fixed-position div following pointer, simulating touch fingertip:
- Circular, size = `fingerRadius * 2` (default: 44px)
- Color changes by state: cyan (sliding), green (flick), orange (cooldown), dim cyan (idle)
- Pointer-events: none (doesn't interfere with input)

## Visual Hierarchy

1. **Commit flash** — full-screen green overlay (z-index 9999), 90ms duration. Highest visual priority.
2. **Finger cursor** — follows pointer (z-index 10000). Always on top.
3. **Canvas overlay** — deadzone circle, connector line, direction cone, bubble, suggestion pill (z-index 20)
4. **Key DOM layer** — highlights, warp transforms (z-index 2)
5. **Keyboard surface** — background panel (z-index 1)

## Canvas Overlay Elements (drawn each frame) — **IMPLEMENTED**

| Element | Visual | Purpose |
|---------|--------|---------|
| Deadzone circle | Dashed white circle at anchor | Shows minimum slide distance |
| Connector line | Thin cyan line anchor→pointer | Shows current slide vector |
| Direction cone | Two lines + arc from anchor | Shows swipe direction spread |
| Top bubble | Large green circle with letter | Shows what flick will commit |
| Suggestion pill | Purple rounded rect with word | Shows available word completion |
| Anchor dot | Small cyan circle at anchor | Marks anchor position |
| Cursor dot | Small cyan circle at pointer | Marks current position |

---

# 6. Core Logic Architecture

## Major Modules

### SteerPopEngine (`steerpop-engine.js`) — **IMPLEMENTED**

Pure decision engine. Accepts pointer events, emits semantic events. No rendering, no DOM, no browser APIs.

**Responsibilities (current):**
- Hit testing on geometry
- Session lifecycle management
- Layer state machine (tap → slide → flick → slide)
- Grid-based candidate generation
- Scoring-based candidate generation (opt-in)
- Row switching logic
- Flick-up gesture detection
- Velocity tracking and smoothing
- Deadzone filtering
- Key warp position computation
- Suggestion computation (bigram lookup)
- Render model generation
- Trace replay
- Event emission

**Responsibilities it SHOULD NOT hold (violations):**
- `bubbleSize` and `haloOffset` are rendering concerns currently in engine config (engine line 22-23). The engine uses them to compute bubble position in `getRenderModel()` (line 428-429, 439). This means the engine knows about visual layout positioning.
- Key warp computation (`getWarpedPositions()`) returns visual offsets for the adapter (engine line 192-209). This is rendering data computed inside the engine.

### Web Adapter (`web-adapter.js`) — **IMPLEMENTED**

Browser shell. Translates between browser events and engine API. Owns all rendering.

**Responsibilities (current):**
- Keyboard DOM construction from ROWS constant
- Geometry extraction from DOM (`getBoundingClientRect()`)
- Mouse + touch event capture and normalization
- Engine event consumption and text output management
- Canvas overlay drawing (every frame via requestAnimationFrame)
- DOM key highlight updates
- DOM key warp transforms
- Debug panel updates
- Control slider/toggle bindings
- Finger cursor overlay
- Commit flash animation
- Event log

**Responsibilities it SHOULD NOT hold:**
- ROWS layout constant (adapter line 15-19) is duplicated knowledge — the layout is also embedded in the engine via `setGeometry()`. The adapter defines the layout, but the engine has no way to validate it.
- Output text management (adapter line 53, 249, 261-265) — the adapter concatenates committed letters and handles suggestion word completion. The engine never sees the output text except via `setTextContext()` which the adapter must call manually.

### index.html — **IMPLEMENTED**

Page layout and CSS design system. Static structure only.

**Responsibilities:** HTML skeleton, CSS variables, key containers, control panel structure, debug panel structure.

## Current Code Organization vs Ideal Organization

| Concern | Currently In | Should Be In |
|---------|-------------|-------------|
| Layout definition (ROWS) | Adapter | Shared config or engine |
| Hit testing | Engine | Engine (correct) |
| Candidate generation | Engine | Engine (correct) |
| Flick detection | Engine | Engine (correct) |
| Bubble position computation | Engine (getRenderModel) | Adapter or renderer |
| Suggestion pill position | Engine (getRenderModel) | Adapter or renderer |
| Key warp computation | Engine | Engine (acceptable — affects candidate scoring) |
| Key warp visual offsets | Engine (getWarpedPositions) | Adapter (rendering concern) |
| Output text accumulation | Adapter | Could be engine (for deterministic replay of full text) |
| Suggestion word completion | Adapter (line 261-265) | Engine (for consistency) |

---

# 7. Data Contracts

## Geometry Key

```javascript
// Input to engine.setGeometry()
{
  id:       string,   // unique identifier, e.g. "H"
  label:    string,   // display label, e.g. "H"
  row:      number,   // row index: 0 (top), 1 (middle), 2 (bottom)
  col:      number,   // column index within row
  centerX:  number,   // X center position in keyboard-local coordinates (px)
  centerY:  number,   // Y center position in keyboard-local coordinates (px)
  width:    number,   // key width (px)
  height:   number,   // key height (px)
  excluded: boolean,  // if true, key is ignored for hit testing and candidates
}
```

**Status:** IMPLEMENTED. Currently `id` and `label` are always identical (the letter itself). The `excluded` flag exists but is never set to `true` in the adapter.

## Configuration

```javascript
{
  candidateCount:       number,  // max candidates per swipe. Default: 8
  bubbleSize:           number,  // floating bubble radius base. Default: 36
  haloOffset:           number,  // bubble Y-offset above anchor (px). Default: 90
  hysteresis:           number,  // score margin for target stability. Default: 0.3
  deadzoneRadius:       number,  // min slide distance for candidates (px). Default: 12
  flickSpeedThreshold:  number,  // min upward velocity for flick. Default: 10
  flickAngleThreshold:  number,  // max degrees from vertical for flick. Default: 40
  flickCooldownMs:      number,  // post-flick pause (ms). Default: 350
  candidateAngleSpread: number,  // cone width in degrees (scoring path + visual only). Default: 100
  gridStepSize:         number,  // px of slide per key step. Default: 25
  warpStrength:         number,  // key pull toward pointer (0-1). Default: 0.35
  warpRadius:           number,  // warp effect radius (px). Default: 150
  suggestionEnabled:    boolean, // enable bigram suggestions. Default: true
  useScoring:           boolean, // false=grid path, true=scoring path. Default: false
}
```

**Status:** IMPLEMENTED. Note: `bubbleSize` and `haloOffset` are rendering concerns leaked into engine config. `candidateAngleSpread` is used by the adapter for cone rendering (adapter line 434) but NOT used by the grid path for candidate generation — only the scoring path uses it implicitly via the neighbor map.

## Session State

```javascript
{
  active:                  boolean,          // session in progress
  layer:                   number,           // 0=tap, 1=sliding, 2=confirming (NOTE: layer 2 never actually set)
  anchorKey:               string | null,    // current anchor key ID
  anchorPosition:          { x, y },         // anchor screen coordinates
  pointerPosition:         { x, y },         // current pointer coordinates
  previousPointerPosition: { x, y },         // previous frame pointer
  velocity:                { x, y },         // smoothed velocity vector (px per ~16ms)
  speed:                   number,           // velocity magnitude
  swipeAngle:              number | null,     // radians from anchor to pointer
  candidates:              Candidate[],      // active candidates
  topCandidate:            string | null,     // ID of highest-scoring candidate
  lockedTarget:            string | null,     // last stable target before flick motion
  flickState:              string,           // 'idle' | 'sliding' | 'cooldown'
  flickCooldownUntil:      number,           // timestamp when cooldown expires
  lastCommittedKey:        string | null,     // most recently committed key ID
  lastCommitTime:          number,           // timestamp of last commit
  lastCommitType:          string | null,     // 'tap' | 'flick' | 'suggestion'
  suggestion:              string | null,     // current word suggestion
  didCommitThisSession:    boolean,          // whether any commit has happened this session
  sessionStartTime:        number,           // timestamp of session start
  activeRow:               number | null,     // which row (0/1/2) candidates come from
  swipeDirection:          string | null,     // 'left' | 'right' | 'up' | 'down'
}
```

**Status:** IMPLEMENTED. Note: `layer` is initialized to 0 in `_freshState()` and set to 1 in `pointerDown()` but is never set to 2 anywhere. The layer concept from the spec (Layer 0/1/2) is partially realized — Layer 2 behavior (flick) happens within Layer 1 as a sub-state tracked by `flickState`, not by the `layer` field.

## Candidate

```javascript
{
  id:         string,   // key ID (e.g. "G")
  label:      string,   // display label (e.g. "G")
  dist:       number,   // distance from anchor (px or grid units, depends on path)
  score:      number,   // 0-1, higher is better
  brightness: number,   // 0-1, visual intensity
  gridIndex:  number,   // (grid path only) position in directional ordering
  order:      number,   // (scoring path only) position in directional ordering
}
```

**Status:** IMPLEMENTED. The two paths produce slightly different candidate shapes — grid path includes `gridIndex`, scoring path includes `order`. These should be unified.

## Suggestion

```javascript
// Internal
{
  word: string | null,  // suggested word or null
}

// In render model
{
  word: string,  // the suggested word
  x:    number,  // X position for display
  y:    number,  // Y position for display
}
```

**Status:** PARTIAL. The suggestion is a simple string, not a structured prediction object. No confidence score, no alternatives, no dictionary source.

## Output Event

```javascript
// Base event shape
{
  type:      string,   // event type identifier
  timestamp: number,   // when the event occurred
  ...data              // event-specific fields
}

// Event types:
{ type: 'session_started',      anchorKey: string }
{ type: 'letter_committed',     key: string, label: string, commitType: 'tap' | 'flick' | 'suggestion' }
{ type: 'target_changed',       target: string, from: string | null }
{ type: 'flick_confirmed',      key: string, label: string }
{ type: 'suggestion_shown',     word: string }
{ type: 'suggestion_committed', word: string }
{ type: 'session_ended',        anchorKey: string | null }
```

**Status:** IMPLEMENTED. Note: `target_changed` uses `Date.now()` for timestamp (engine lines 710, 826) instead of the pointer-provided timestamp. This breaks determinism. All other events correctly use the provided timestamp.

## Render Model

```javascript
{
  sessionActive:     boolean,
  candidates:        [{ id, label, brightness, isTop, score }],
  keyHighlights:     [{ id, brightness, isTop }],
  topCandidate:      { id, label, x, y } | null,    // bubble position
  anchorMarker:      { x, y } | null,
  pointerMarker:     { x, y } | null,
  connectorLine:     { from: { x, y }, to: { x, y } } | null,
  suggestionConsole: { word, x, y } | null,
  debugValues: {
    session:    string,  // 'ACTIVE' | 'IDLE'
    layer:      number,
    anchor:     string,
    topTarget:  string,
    distance:   number,  // rounded px
    swipeAngle: string,  // e.g. "45°" or "—"
    flickState: string,  // 'IDLE' | 'SLIDING' | 'COOLDOWN'
    speed:      number,  // rounded
    lastCommit: string,
    suggestion: string,
    candidates: number,  // count
    activeRow:  string,  // e.g. "Row 1" or "—"
    swipeDir:   string,  // e.g. "left" or "—"
  }
}
```

**Status:** IMPLEMENTED. The render model is well-structured but contains presentation logic (bubble position computation, suggestion position computation) that could be deferred to the adapter.

---

# 8. State Machines

## Session Lifecycle

```
             pointerDown (hit)
   IDLE ───────────────────────► ACTIVE
    ▲                              │
    │                              │ pointerUp
    │                              │ touchCancel
    └──────────────────────────────┘
           (endSession)
```

**States:**
- `IDLE`: `active = false`. No session. Waiting for touch.
- `ACTIVE`: `active = true`. Finger is down. Slide/flick active.

**Status:** IMPLEMENTED. Transition is clean. No timeout from ACTIVE → IDLE exists (session persists indefinitely while finger is held).

## Flick (Pop) Lifecycle

```
                      pointerDown
   idle ──────────────────────────► sliding
                                     │  ▲
                      flick detected │  │ cooldown expired
                                     ▼  │
                                  cooldown
```

**States:**
- `idle`: No active session. Initial state and post-session state.
- `sliding`: Finger is down, candidate generation active, flick detection active.
- `cooldown`: Flick just committed. All input suppressed. Timer running.

**Transitions:**
- `idle → sliding`: On `pointerDown` (engine line 258)
- `sliding → cooldown`: On successful flick commit (engine line 957)
- `cooldown → sliding`: When `timestamp >= flickCooldownUntil` (engine line 315-316)
- `sliding → idle`: On `pointerUp` / `_endSession()` (engine line 505)
- `cooldown → idle`: On `pointerUp` / `_endSession()` (engine line 505)

**Status:** IMPLEMENTED. Note: `flickState` is set to `idle` in `_freshState()` but to `sliding` on `pointerDown` — so `idle` is only the default/post-session state, never a state during an active session.

## Suggestion Acceptance Lifecycle

```
   NO_SUGGESTION ──── commit event ──── check bigram ──── SUGGESTION_SHOWN
                                                              │
                                                              │ (no gesture exists)
                                                              ▼
                                                       SUGGESTION_COMMITTED
```

**Status:** PARTIAL. The engine computes suggestions and emits `suggestion_shown`, but there is no gesture or mechanism to transition to `SUGGESTION_COMMITTED`. The adapter has handler code for `suggestion_committed` events but the engine never emits them during normal operation. Suggestion acceptance is **MISSING**.

---

# 9. Algorithms

## Anchor Resolution — **IMPLEMENTED**

**Location:** Engine `_hitTest()`, line 519-531

```
For each non-excluded key in geometry:
  d = euclidean distance from (x, y) to (key.centerX, key.centerY)
  hitRadius = max(key.width, key.height) * 0.6
  if d < hitRadius AND d < bestDist:
    best = key
    bestDist = d
Return best (or null if no key within hit radius)
```

**Notes:**
- Hit radius is 60% of key's largest dimension (30px for 50x50 keys)
- Pure nearest-center match within hit radius — no Voronoi or touch-area weighting
- Does not account for finger size or occlusion
- Does not use warp positions for hit testing (correct — warp is visual only during initial tap)

## Candidate Generation — Grid Path — **IMPLEMENTED**

**Location:** Engine `_generateGridCandidates()`, line 620-720

```
1. Get anchor key from geometry
2. Get all keys on activeRow from _keysByRow
3. Compute warped positions for row keys (pulled toward pointer)
4. Filter by swipeDirection:
   - right: keys with centerX > anchor.centerX, sort by ascending warpedX
   - left: keys with centerX < anchor.centerX, sort by descending warpedX
   - up/down: all keys, sort by abs(warpedX - pointerX)
5. Compute effective slide distance:
   - For left/right: abs(pointer.x - anchor.x) - deadzoneRadius
   - For up/down: abs(pointer.y - anchor.y) - deadzoneRadius
6. Key index = floor(effectiveDist / gridStepSize), clamped to ordered.length - 1
7. Score each key:
   - indexDist = abs(i - activeIndex)
   - brightness = max(0.12, 1.0 - indexDist * 0.25)
   - score = indexDist == 0 ? 1.0 : 1.0 / (1 + indexDist)
8. Sort by score descending, take first candidateCount
9. Update topCandidate with no hysteresis (unlike scoring path)
10. Update lockedTarget = previous top before change
```

**Critical observation:** The grid path does NOT apply hysteresis. Line 704-709 updates `topCandidate` directly whenever the new top differs, without checking a score margin. The scoring path (line 818-821) does apply hysteresis. This is an **INCONSISTENCY**.

**Critical observation:** Warped positions affect candidate ordering. If warpStrength > 0, keys closer to the pointer appear "closer" in the grid, which can change which key is at `activeIndex`. This means the grid path is not purely distance-based when warp is enabled.

## Candidate Generation — Scoring Path — **IMPLEMENTED**

**Location:** Engine `_generateRowLockedCandidates()`, line 726-837

```
1. Get all non-excluded keys on activeRow, excluding anchor key
2. Filter by swipeDirection
3. Compute inter-key spacing on active row
4. For each directional key:
   - keyDist = distance from anchor in swipe direction
   - reachDiff = abs(slideDist - keyDist) / keySpacing
   - reachScore = exp(-reachDiff^2 * 2.0)  (Gaussian)
5. Sort by score descending
6. Take first candidateCount, assign brightness by rank
7. Hysteresis: if newTop != prevTop AND score margin < hysteresis * 0.5:
   keep previous top
8. Update lockedTarget
```

**Notes:**
- Does NOT use warped positions (unlike grid path) — **INCONSISTENCY**
- Hysteresis is applied (unlike grid path) — **INCONSISTENCY**
- Excludes anchor key from candidates (unlike grid path which filters by direction and naturally excludes anchor)
- Gaussian scoring provides smoother transitions than grid's floor-based indexing

## Target Scoring — **PARTIAL**

The scoring path uses a simple Gaussian reach-match. The full per-key awareness map (`_buildNeighborMap()`, `_keyAwareness`) is built during `setGeometry()` but is **NEVER USED** by either candidate generation path. It is only read in `_debugValues()` (line 984) and is otherwise dead code.

The neighbor map computes:
- 8 directional sectors per key
- Neighbors sorted by distance per sector
- Density ratio (how many sectors have neighbors)
- Local cone spread (wider for corner keys, tighter for center)

**Status:** The neighbor map infrastructure described below does **NOT EXIST** in the current codebase. `_buildNeighborMap`, `_keyAwareness`, and `_neighborMap` are not present in `steerpop-engine.js`. The scoring path (`_generateRowLockedCandidates`) uses simple Gaussian reach matching without neighbor-map awareness. This section describes an architecture that was either planned but never built, or was removed.

## Deadzone Filtering — **IMPLEMENTED**

**Location:** Engine `pointerMove()`, line 306-311

```
distance = euclidean(anchor, pointer)
if distance < deadzoneRadius:
  clear swipeAngle, candidates, topCandidate
  return (stop processing)
```

**Notes:**
- Applied before any candidate generation
- Applied before cooldown check (deadzone takes priority)
- Uses raw distance, not X or Y component
- Default radius: 12px

## Hysteresis — **PARTIAL**

Grid path: **NO HYSTERESIS.** Top candidate changes immediately on any score change.

Scoring path: hysteresis check at line 818-821:
```
if newTop != prevTop:
  if oldTop is in candidate list AND score margin < hysteresis * 0.5:
    keep prevTop as topCandidate (suppress change)
  else:
    accept newTop
```

**Status:** Hysteresis is only implemented in the scoring path. The grid path freely switches top candidate on every frame. This makes the grid path susceptible to jitter near grid-step boundaries.

## Flick Arming / Firing / Cooldown — **IMPLEMENTED**

**Arming:** Implicit — any time `flickState === 'sliding'` and `topCandidate` exists and velocity buffer has 5+ samples, the system is "armed" for flick detection. There is no explicit armed state.

**Firing:** See "Pop/Commit Behavior" in Section 4 above.

**Cooldown:**
```
Enter: flickState = 'cooldown', flickCooldownUntil = timestamp + flickCooldownMs
During: pointerMove returns early (line 314-320), no processing
Exit: when timestamp >= flickCooldownUntil, set flickState = 'sliding'
```

## Recentering — **IMPLEMENTED**

After flick commit, anchor moves to the committed key's center position:
```
s.anchorKey      = keyId
s.anchorPosition = { x: key.centerX, y: key.centerY }
s.activeRow      = key.row
```

All relative measurements (deadzone, swipe distance, row offset) reset relative to the new anchor. The pointer position does NOT change — so the user is now "already slid" from the new anchor, and the next frame of `pointerMove` will generate new candidates from the new reference point.

**Note:** There is no animated or gradual recentering. The anchor snaps to the new key immediately.

## Tap Fallback — **IMPLEMENTED**

If the user taps (pointerDown + pointerUp with minimal or no movement), the tapped letter commits on pointerDown and no further action happens. This is the standard keyboard behavior path and always works regardless of engine state.

**Note:** There is no minimum hold time. Even a 1ms tap commits.

## Suggestion Generation — **PARTIAL**

**Location:** Engine `_computeSuggestion()`, line 968-973

```
text = this._textContext
if text.length < 2: return null
suffix = text.slice(-2).toUpperCase()
return SUGGESTION_MAP[suffix] || null
```

24 hardcoded bigram-to-word mappings. Not case-sensitive. No context awareness, no frequency weighting, no dictionary lookup.

**Table:** HE→hello, TH→the, YO→you, IT→it, IN→into, AN→and, IS→is, WO→world, BE→be, FO→for, HA→have, AR→are, CA→can, NO→not, WI→will, GO→good, SO→so, DO→do, ON→one, WH→what, MY→my, LO→love, ME→me, US→use

---

# 10. Current Gaps and Violations

## Doctrine Violations

| # | Violation | Severity | Details |
|---|-----------|----------|---------|
| D1 | **Repeated-letter gap breaks core promise** | CRITICAL | Cannot type "LL", "EE", "OO" without lifting. This directly violates "reducing lift frequency." |
| D2 | **Suggestion acceptance gesture missing** | MODERATE | Suggestions display but cannot be accepted. The feature appears broken to users. Either implement acceptance or remove the display. |
| D3 | **Suggestion system is a stub masquerading as a feature** | LOW | 24-entry lookup table. Risk of misleading evaluators into thinking this is a real prediction system. Doctrine says "suggestion layer must never dominate" — currently it's so minimal it's irrelevant, which is safe but not useful. |

## Architecture Violations

| # | Violation | Severity | Details |
|---|-----------|----------|---------|
| A1 | **`Date.now()` in engine breaks determinism** | HIGH | Lines 710, 826: `target_changed` event timestamps use `Date.now()` instead of the pointer-provided timestamp. Trace replay produces non-deterministic timestamps. |
| A2 | **Rendering config in engine** | MODERATE | `bubbleSize` and `haloOffset` are engine config but only used for render model positioning. Engine should not know about visual layout. |
| A3 | **Neighbor map is dead code** | LOW | `_buildNeighborMap()` and `_keyAwareness` are computed on every `setGeometry()` call but never used for candidate generation. Wasted computation and misleading code. |
| A4 | **Hysteresis inconsistency** | MODERATE | Grid path has no hysteresis, scoring path does. Either both should have it or neither. Grid path jitters at step boundaries. |
| A5 | **Candidate shape inconsistency** | LOW | Grid path produces `gridIndex` field, scoring path produces `order` field. Should be unified. |
| A6 | **Warp affects grid candidates but not scoring candidates** | MODERATE | Grid path uses warped positions (line 640-643), scoring path uses raw positions. Inconsistent behavior when switching between paths. |

## Implementation Gaps

| # | Gap | Severity | Details |
|---|-----|----------|---------|
| G1 | No backspace/delete | HIGH | No error correction except "Clear All". |
| G2 | No space key | HIGH | Cannot separate words. |
| G3 | No punctuation | MODERATE | No period, comma, apostrophe. |
| G4 | No shift/capitalization | MODERATE | All output uppercase. |
| G5 | No multi-touch handling | MODERATE | Second finger during session is undefined behavior. |
| G6 | No session timeout | LOW | Session persists indefinitely. Could cause ghost sessions on mobile. |
| G7 | No performance monitoring | LOW | No frame time tracking, input latency measurement. |
| G8 | `layer` field is vestigial | LOW | Set to 0 or 1 but never 2. Layer concept exists in documentation but not in state machine. |
| G9 | `excluded` key flag never used | LOW | Infrastructure exists but no keys are ever excluded. |
| G10 | No output text tracking in engine | MODERATE | Engine doesn't track output text — adapter must manually call `setTextContext()`. Breaks determinism if adapter forgets. |

## Fragile Assumptions

| # | Assumption | Risk |
|---|-----------|------|
| F1 | Exactly 3 rows, hardcoded row clamp 0-2 (line 343) | Breaks if layout changes |
| F2 | `rowSpacing` computed from average — assumes uniform spacing | Breaks with non-uniform layouts |
| F3 | Hit radius = 60% of key size — no per-key adjustment | May cause dead zones between small keys |
| F4 | Velocity normalization assumes ~16ms frame rate (line 858) | Breaks at 30fps, 120fps, or variable rate |
| F5 | Adapter uses `setTimeout(80ms)` for initial geometry (line 610) | Race condition with DOM layout |
| F6 | Canvas offset constants are magic numbers (CANVAS_TOP_OFFSET=140, CANVAS_SIDE_PAD=20) | Breaks if layout changes |

---

# 11. Testing Strategy

## Current Coverage

11 test sections, ~20 assertions. All tests target the grid path. No tests for the scoring path.

| Test | What It Covers | Status |
|------|---------------|--------|
| 1. Tap commits | Layer 0 → letter enters, commitType=tap | PASS |
| 2. Slide left | G is top candidate when sliding left from H | PASS |
| 3. Slide far left | Further keys (F, D) appear at greater distance | PASS |
| 4. Slide up-left | Upper row keys appear on diagonal slide | PASS |
| 5. Flick up | Top candidate commits on upward flick | PASS |
| 6. Anchor moves | Anchor changes to committed key after flick | PASS |
| 7. Cooldown | Second flick blocked during cooldown | PASS |
| 8. Deadzone | No candidates within deadzone radius | PASS |
| 9. Pointer up | Session ends on pointer up | PASS |
| 10. Trace replay | Same trace → same event sequence | PASS |
| 11. Engine purity | No document/window/canvas references in engine class | PASS |

## Required Additional Tests

### Core Engine Logic
- [ ] **Scoring path basic operation** — useScoring:true produces candidates
- [ ] **Scoring path hysteresis** — top candidate resists change within margin
- [ ] **Grid path boundary behavior** — test at exact gridStepSize boundaries
- [ ] **Row switching threshold** — verify 0.6 * rowSpacing threshold
- [ ] **Multi-row jump** — row 0 → row 2 directly
- [ ] **Anchor exclusion** — anchor key never appears in own candidates
- [ ] **Warp effect on candidates** — verify warped positions change candidate ordering
- [ ] **Empty row handling** — what happens if active row has no keys
- [ ] **Edge key candidates** — P (rightmost) sliding right produces empty
- [ ] **Config update during session** — changing gridStepSize mid-slide

### Gesture Traces
- [ ] **Full word trace** — tap H, slide to E, flick, slide to L, flick, etc.
- [ ] **Diagonal slide trace** — verify row switching during lateral slide
- [ ] **Rapid flick sequence** — multiple flicks with exact cooldown timing
- [ ] **Flick angle boundary** — exactly at flickAngleThreshold
- [ ] **Slow upward slide (no flick)** — sustained upward motion should NOT trigger flick
- [ ] **Flick from cooldown boundary** — flick at exact cooldown expiration timestamp

### Repeated Letters — **IMPLEMENTED**
- [ ] (BLOCKED) Double-letter commit without lift

### Jitter Resistance
- [ ] **Sub-pixel jitter** — tiny movements within deadzone produce no candidates
- [ ] **Grid step boundary oscillation** — rapid back-and-forth at exact step boundary
- [ ] **Velocity buffer noise** — small Y-noise during horizontal slide doesn't trigger flick

### Fallback Behavior
- [ ] **Tap outside keyboard** — no crash, no session
- [ ] **PointerUp without PointerDown** — graceful no-op
- [ ] **PointerMove without active session** — graceful no-op
- [ ] **Multiple rapid sessions** — tap-lift-tap-lift in quick succession
- [ ] **Zero-duration tap** — pointerDown and pointerUp at same timestamp

### Suggestion Safety
- [ ] **Suggestion never auto-commits** — verify no path from suggestion_shown to letter_committed without user action
- [ ] **Suggestion clears on session end** — no stale suggestion after lift
- [ ] **Suggestion with < 2 chars** — returns null

### Regression Protection
- [ ] **Determinism regression** — automated check that `Date.now()` is never called in engine (extend test 11)
- [ ] **Event order regression** — for known traces, event sequence must match golden reference
- [ ] **State cleanup regression** — after session end, all state fields are reset to fresh values

---

# 12. Productionization Roadmap

## Phase 1: Cleanup (1-2 days)

1. **Fix determinism bug** — Replace `Date.now()` at engine lines 710, 826 with the pointer-provided timestamp. This requires threading the timestamp through to `_generateGridCandidates()` and `_generateRowLockedCandidates()`.
2. **Unify candidate shape** — Standardize on a single candidate schema (eliminate `gridIndex` vs `order` split).
3. **Remove dead code** — Either use `_keyAwareness`/`_neighborMap` in the scoring path or remove the entire `_buildNeighborMap()` infrastructure.
4. **Fix vestigial `layer` field** — Either implement Layer 2 as a real state or remove the field and document the actual flick sub-state model.
5. **Move rendering config out of engine** — `bubbleSize` and `haloOffset` should be adapter-only config. Engine's `getRenderModel()` should return anchor position and let the adapter compute bubble/suggestion positions.

## Phase 2: Core Interaction Gaps (3-5 days)

6. **Implement repeated-letter handling** — Design and implement a gesture for committing the current anchor letter. Options: double-tap (problematic — session already active), short flick down, dwell timer, or dedicated "repeat" zone. This requires a product decision.
7. **Implement backspace** — Design a gesture or add a backspace key. Options: swipe-left-to-delete, dedicated key, or long-press.
8. **Implement space** — Add a space bar to the layout or design a gesture (e.g., slide off right edge of bottom row).
9. **Add hysteresis to grid path** — Port the scoring path's hysteresis logic to the grid path to prevent jitter at step boundaries.

## Phase 3: Deterministic Test Suite (2-3 days)

10. Build the full test suite outlined in Section 11.
11. Add golden trace tests: record known-good input traces and their expected event sequences, verify on every run.
12. Add the `Date.now()` regression check (extend existing engine purity test to search for `Date.now` in source).
13. Automate test running (currently requires opening `test.html` in a browser).

## Phase 4: Web Tuning Lab Enhancement (2-3 days)

14. Add performance overlay (frame time, input-to-render latency).
15. Add trace recording/playback UI (capture real gestures, replay in engine).
16. Add A/B comparison between grid and scoring paths.
17. Add touch simulation (emulate finger occlusion, variable touch areas).
18. Expose all engine config parameters as sliders (currently only 4 of 14).

## Phase 5: Platform Shell (5-10 days)

19. Extract shared config (ROWS layout, key dimensions) into a common module.
20. Define platform adapter interface: `PlatformAdapter { translateEvent(nativeEvent) → PointerInput, render(model), getGeometry() → Key[] }`.
21. Build Android adapter shell (Kotlin/Java wrapping the JS engine or native port).
22. Build touch-specific gesture tuning profile (different thresholds for finger vs mouse).
23. Implement multi-touch rejection (ignore second finger during session).

## Phase 6: Product Hardening (5-10 days)

24. Add shift/capitalization system.
25. Add punctuation layer (period, comma, apostrophe at minimum).
26. Replace bigram suggestion stub with dictionary-backed system (or remove suggestion feature entirely).
27. Implement suggestion acceptance gesture.
28. Add haptic feedback integration points (engine emits feedback events, adapter maps to platform haptics).
29. Add sound feedback integration points.
30. Add accessibility scaffolding.
31. Session timeout (configurable, e.g., 5s of no movement → auto-end).

---

# 13. Immediate Priorities

Ordered by impact and dependency:

| # | Action | Type | Rationale |
|---|--------|------|-----------|
| 1 | **Fix `Date.now()` determinism bug** | BUG FIX | Breaks trace replay, the foundation of deterministic testing. Blocks Phase 3. |
| 2 | **Design repeated-letter gesture** | PRODUCT DECISION | Most critical interaction gap. Must be decided before further UX testing. |
| 3 | **Add hysteresis to grid path** | ENGINE FIX | Prevents jitter at step boundaries. Low effort, high polish impact. |
| 4 | **Remove or use neighbor map** | CLEANUP | 75 lines of dead code (`_buildNeighborMap`) running on every geometry set. |
| 5 | **Move bubble/suggestion position to adapter** | ARCHITECTURE | Removes rendering logic from engine. Clean boundary enforcement. |
| 6 | **Unify candidate schema** | CLEANUP | Prevents adapter bugs when switching between grid/scoring paths. |
| 7 | **Add scoring path tests** | TESTING | Zero coverage on a code path that can be activated by a single config flag. |
| 8 | **Implement backspace** | FEATURE | Cannot use the keyboard for real text without error correction. |
| 9 | **Implement space** | FEATURE | Cannot produce readable text without word separation. |
| 10 | **Add golden trace regression tests** | TESTING | Prevents regressions as engine evolves. Requires #1 first. |

---

# 14. Open Questions

These are genuine unresolved questions that cannot be inferred from the code:

1. **What gesture should commit a repeated letter?** The anchor key is the reference point for all measurements. Committing it again without lifting requires a new gesture primitive (double-tap, dwell, flick-down, shake, etc.). Each has trade-offs with the existing interaction model. This is a product design decision, not an engineering one.

2. **Should the scoring path be kept?** It exists as an alternative to the grid path but has zero test coverage, different hysteresis behavior, and doesn't use the neighbor map that was apparently built for it. Is this a planned evolution or abandoned experiment?

3. **What is the intended suggestion acceptance gesture?** The adapter has dead handler code for `suggestion_committed` events, and the engine computes suggestions, but no gesture triggers acceptance. Was this deferred intentionally or was a gesture designed but not implemented?

4. **Is key warp a visual effect or a functional behavior?** Currently it affects grid candidate generation (engine logic) AND visual key positions (adapter rendering). Should warped positions change which key the user is "pointing at", or should they only move the visual representation while keeping the logical grid unchanged?

5. **What is the target platform?** The codebase is browser-only. Is the intended target mobile web (PWA), native Android, native iOS, or cross-platform? This affects adapter architecture, gesture tuning, and performance requirements.

6. **Should the engine track output text?** Currently the adapter owns the output string and manually calls `engine.setTextContext()`. If the engine tracked text internally, suggestion computation and potential future features (undo, context-aware prediction) would be more reliable. But this adds state to the engine that isn't strictly "input decision" logic.

7. **What is the intended behavior for swipe direction during vertical movement?** When swiping up/down (row switching), the grid path shows all keys on the target row sorted by X-distance from pointer. Is this correct, or should vertical swipes maintain the horizontal direction from before the row switch?

8. **Should the deadzone be circular or directional?** Currently circular (euclidean distance). A directional deadzone (larger in Y to prevent accidental row switches, smaller in X for faster lateral selection) might better serve the interaction model.

---

# Appendix — File-to-Responsibility Map

## `steerpop-engine.js` (1001 lines)

**Current responsibility:** Core decision engine. Session management, candidate generation (two paths), flick detection, velocity tracking, deadzone filtering, key warp computation, suggestion computation, render model generation, trace replay, event emission.

**Intended responsibility:** Same as current, minus render model positioning logic (bubble/suggestion coordinates) and with the neighbor map either integrated into scoring or removed.

**Module classification:** ENGINE

**Boundary violations:**
- Render model computes visual positions (`topBubble.x/y`, `suggestionConsole.x/y`) using `haloOffset` and `bubbleSize` — these are adapter concerns
- `getWarpedPositions()` returns visual offset data for the adapter — acceptable since warp also affects candidate generation
- `Date.now()` calls at lines 710, 826 — violates pure-engine principle
- `_buildNeighborMap()` produces dead data structures

**Status:** Well-structured. The engine/adapter boundary is genuinely clean. The violations above are minor and fixable.

## `web-adapter.js` (613 lines)

**Current responsibility:** Browser shell. DOM construction, geometry extraction, pointer event translation, engine event consumption, canvas rendering, DOM key highlighting, key warp rendering, debug panel, control bindings, finger cursor, event log, output text management.

**Intended responsibility:** Same as current, plus taking over bubble/suggestion position computation from engine.

**Module classification:** ADAPTER + RENDERER (currently combined)

**Notes:**
- The adapter is monolithic — it handles both event translation (adapter concern) and rendering (renderer concern). For a web-only implementation this is acceptable. For multi-platform, the renderer should be separable.
- ROWS constant (line 15-19) defines the keyboard layout but is not shared with the engine — the engine receives layout via `setGeometry()` from DOM measurements. This means the layout is defined in HTML/adapter but consumed by the engine through a clean API.
- Output text management (line 53, 249, 261-265) is adapter-owned. This is acceptable but means trace replay cannot verify output text correctness — only engine events.

## `index.html` (375 lines)

**Current responsibility:** Page layout, CSS design system (variables, key styles, panel styles, animations), structural HTML for keyboard, output bar, control panel, debug panel.

**Intended responsibility:** Same. This is appropriate for a web adapter.

**Module classification:** APP SHELL (web-specific)

**Notes:**
- CSS design tokens are well-organized with semantic variable names
- Key dimensions are CSS-defined (50x50px) not engine-defined — engine discovers them via geometry extraction
- No JavaScript in this file — clean separation

## `steerpop-test.js` (350 lines)

**Current responsibility:** Engine unit tests. Custom assert/section harness. 11 test sections covering tap, slide, flick, cooldown, deadzone, session lifecycle, trace replay, engine purity.

**Intended responsibility:** Same, expanded with the tests listed in Section 11.

**Module classification:** TEST HARNESS

**Notes:**
- No framework dependency — custom console-based harness
- Builds synthetic geometry (3 rows, 55px spacing) independent of DOM
- Tests are deterministic (use explicit timestamps, not Date.now())
- All tests target grid path only — scoring path has zero coverage
- Test runner requires browser (`test.html`) — should be runnable headless

## `SPEC.md` (319 lines)

**Current responsibility:** Human-readable specification document. Documents architecture, interaction model, API, config, events, render model, internal systems.

**Intended responsibility:** Superseded by this document (`STEERPOP-SPEC-CANONICAL.md`).

**Module classification:** DOCUMENTATION

**Notes:**
- Generally accurate but does not document gaps, bugs, or missing features
- Does not distinguish between implemented and planned behavior
- Does not document the determinism bug or hysteresis inconsistency
- Useful as quick-reference but insufficient as engineering spec

## `steerpop-demo.html` (~monolithic)

**Current responsibility:** Legacy prototype. Self-contained single-file implementation with all logic inline.

**Intended responsibility:** Archive/reference only. Not connected to current engine.

**Module classification:** LEGACY

## `steerpop-v02.html` (~monolithic)

**Current responsibility:** Earlier prototype ("Floating Probability Field"). Different interaction model from current implementation.

**Intended responsibility:** Archive/reference only. Not connected to current engine.

**Module classification:** LEGACY

## `test.html` (17 lines)

**Current responsibility:** Browser entry point for test suite. Loads `steerpop-test.js` as ES module.

**Intended responsibility:** Same, or replaced by headless test runner.

**Module classification:** TEST HARNESS

---

*End of specification.*
