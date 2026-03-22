# SteerPop Engine Specification v0.5

## Overview

SteerPop is a gestural keyboard input system. Instead of tapping each letter individually, the user taps once to commit the first letter, then slides to select subsequent letters and flicks up to confirm them — all without lifting their finger.

The system is split into two layers:
- **Engine** (`steerpop-engine.js`) — pure decision logic, no DOM
- **Web Adapter** (`web-adapter.js` + `index.html`) — browser shell for rendering and events

---

## Interaction Model

### Three Layers

| Layer | Trigger | What Happens |
|-------|---------|-------------|
| **0 — Tap** | Finger touches a key | That letter commits immediately. Anchor is set. |
| **1 — Slide** | Finger moves without lifting | Candidates highlight based on direction and distance. |
| **2 — Flick Up** | Sharp upward gesture | Top candidate commits. Anchor moves to that key. Back to Layer 1. |

**Session lifecycle:**
```
Tap → Letter enters → Slide → Candidates appear → Flick up → Letter commits
                          ↑                                        |
                          └────────────────────────────────────────┘
                          (anchor moves, keep sliding)

Lift finger → Session ends
```

### Grid System (Default Path)

The keyboard is treated as a grid. Candidate selection uses **compressed distance**, not absolute cursor position:

- **X-axis (left/right):** Each `gridStepSize` pixels of horizontal slide = one key deeper in that direction
- **Y-axis (up/down):** Y distance from anchor determines which row is active, based on `rowSpacing`
- **Row locking:** Horizontal movement stays on the active row. Vertical movement switches rows.

Example at `gridStepSize = 25`:
```
Anchor: H (row 1)
Slide right  25px → J
Slide right  50px → K
Slide right  75px → L
Slide up    ~36px → Row 0 (Y, U area)
Slide up    ~72px → Row 0 from row 2
```

### Scoring System (Opt-in Path)

Set `useScoring: true` to enable the advanced scoring path which uses:
- Per-key awareness maps (8 directional sectors)
- Angular alignment scoring
- Distance-to-reach Gaussian matching
- Same-row bonuses
- Hysteresis for target stability

---

## Engine API

### Constructor

```javascript
const engine = new SteerPopEngine(config?)
```

### Public Methods

| Method | Description |
|--------|-------------|
| `setGeometry(keys)` | Set keyboard layout. Each key: `{id, label, row, col, centerX, centerY, width, height, excluded}` |
| `setConfig(partial)` | Update config values |
| `setTextContext(text)` | Provide current text for word suggestions |
| `getState()` | Returns copy of current session state |
| `consumeEvents()` | Returns and clears all queued events |
| `reset()` | Clears all state |
| `pointerDown({x, y, timestamp})` | Start session, commit tap |
| `pointerMove({x, y, timestamp})` | Update candidates, check flick |
| `pointerUp({x, y, timestamp})` | End session |
| `replayTrace(trace)` | Deterministic trace replay |
| `getRenderModel()` | Returns visual data for rendering |

---

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `gridStepSize` | 25 | Pixels of slide per key step. Lower = faster selection. |
| `deadzoneRadius` | 12 | Minimum slide distance before candidates appear. |
| `flickSpeedThreshold` | 10 | Minimum upward velocity to register as flick. |
| `flickAngleThreshold` | 40 | Max degrees from vertical that counts as "up." |
| `flickCooldownMs` | 350 | Pause after each flick commit before next allowed. |
| `candidateCount` | 8 | Max candidates shown per swipe. |
| `hysteresis` | 0.3 | Score margin required for target to change. |
| `bubbleSize` | 36 | Size of the floating top-candidate bubble. |
| `haloOffset` | 90 | Y-offset of bubble above anchor. |
| `candidateAngleSpread` | 100 | Cone width in degrees (scoring path only). |
| `suggestionEnabled` | true | Enable word suggestions. |
| `useScoring` | false | false = grid path, true = scoring path. |

---

## Session State

| Field | Type | Description |
|-------|------|-------------|
| `active` | boolean | Session in progress |
| `layer` | 0/1/2 | Current interaction layer |
| `anchorKey` | string | Current anchor key ID |
| `anchorPosition` | {x, y} | Anchor screen coordinates |
| `pointerPosition` | {x, y} | Current pointer coordinates |
| `velocity` | {x, y} | Smoothed velocity vector |
| `speed` | number | Velocity magnitude |
| `swipeAngle` | number | Radians from anchor to pointer |
| `candidates` | array | Active candidates with scores/brightness |
| `topCandidate` | string | Highest-scoring candidate ID |
| `lockedTarget` | string | Last stable target before flick motion |
| `flickState` | string | `idle` / `sliding` / `cooldown` |
| `activeRow` | number | Which row (0/1/2) candidates come from |
| `swipeDirection` | string | `left` / `right` / `up` / `down` |
| `lastCommittedKey` | string | Most recent committed key ID |
| `lastCommitType` | string | `tap` / `flick` / `suggestion` |
| `suggestion` | string | Current word suggestion |

---

## Events

| Event | Data | When |
|-------|------|------|
| `session_started` | `{anchorKey}` | Finger touches a key |
| `letter_committed` | `{key, label, commitType}` | Letter enters the output |
| `target_changed` | `{target, from}` | Top candidate switches |
| `flick_confirmed` | `{key, label}` | Flick-up gesture detected |
| `suggestion_shown` | `{word}` | Word suggestion becomes available |
| `suggestion_committed` | `{word}` | Suggestion accepted |
| `session_ended` | `{anchorKey}` | Finger lifts |

---

## Render Model

Returned by `getRenderModel()`. The adapter reads this to draw the UI.

```
{
  sessionActive:      boolean,
  candidates:         [{id, label, brightness, isTop, score}],
  keyHighlights:      [{id, brightness, isTop}],
  topCandidate:       {id, label, x, y} | null,
  anchorMarker:       {x, y} | null,
  pointerMarker:      {x, y} | null,
  connectorLine:      {from: {x,y}, to: {x,y}} | null,
  suggestionConsole:  {word, x, y} | null,
  debugValues:        { session, layer, anchor, topTarget, distance,
                        swipeAngle, flickState, speed, lastCommit,
                        suggestion, candidates, activeRow, swipeDir }
}
```

---

## Keyboard Layout

```
Row 0:  Q  W  E  R  T  Y  U  I  O  P
Row 1:  A  S  D  F  G  H  J  K  L
Row 2:  Z  X  C  V  B  N  M
```

Each key stores: `id`, `label`, `row`, `col`, `centerX`, `centerY`, `width`, `height`, `excluded`.

---

## Internal Systems

### Grid System (`_keysByRow`, `_gridLookup`)

Built in `setGeometry()`:
- `_keysByRow`: Map of row number to keys sorted by X position
- `_rowSpacing`: Average Y distance between adjacent rows
- `_gridLookup(x, row)`: Returns key on given row closest to X position

Grid candidate generation (`_generateGridCandidates`):
1. Get ordered keys in the swipe direction on the active row
2. Compute effective slide distance (minus deadzone)
3. `keyIndex = floor(effectiveDist / gridStepSize)`
4. That index is the top candidate; neighbors get decreasing brightness

### Row Switching

- Y distance from anchor divided by `rowSpacing` = number of rows to jump
- Threshold: `rowSpacing * 0.6` before any row switch
- Supports jumping multiple rows (e.g., row 2 → row 0)
- Clamped to 0–2

### Flick Detection

Uses a velocity buffer (last 6 pointer samples):
1. Recent motion must be upward (`vy < 0`)
2. Speed must exceed `flickSpeedThreshold`
3. Angle from vertical must be within `flickAngleThreshold`
4. Previous motion must NOT have been already upward (prevents sustained slide from triggering)
5. On confirm: commits `lockedTarget` (stable target before flick motion started)

### Velocity Tracking

- Maintains buffer of last 6 `{x, y, timestamp}` samples
- Uses last 3 samples for smoothed velocity
- Normalized to per-frame (~16ms) rate

### Per-Key Awareness (Scoring Path)

Built in `_buildNeighborMap()`:
- 8 directional sectors (R, UR, U, UL, L, DL, D, DR) per key
- Each sector lists neighbors sorted by distance
- Computes: valid sectors, nearest per sector, density ratio
- Adjusts cone spread per key (wider for corners, tighter for center)

### Suggestion System

- Checks last 2 characters of text against `SUGGESTION_MAP`
- 24 common bigram-to-word mappings (HE→hello, TH→the, etc.)
- Suggestion appears as a purple pill above the bubble
- Requires explicit acceptance (never auto-fires)

---

## Web Adapter

### Responsibilities

The adapter owns:
- DOM keyboard construction and key highlighting
- Canvas overlay (deadzone circle, connector line, cone indicator, bubbles, suggestion pill)
- Pointer event translation (mouse + touch)
- Text output field
- Debug panel updates
- Event log
- Finger cursor overlay (simulated fingertip circle)
- Control sliders and toggles

The adapter does NOT own:
- Which key is the anchor
- Which candidates appear
- When to commit
- Flick detection
- Row switching
- Scoring

### Finger Cursor

Visual circle overlay showing touch area. Changes color by state:
- **Sliding:** Cyan border
- **Flick:** Green border
- **Cooldown:** Orange border
- **Idle:** Dim cyan border

### Controls

| Slider | Maps To | Range |
|--------|---------|-------|
| Grid Step | `engine.gridStepSize` | 10–60px |
| Deadzone | `engine.deadzoneRadius` | 0–30px |
| Flick Speed | `engine.flickSpeedThreshold` | 4–20 |
| Finger Size | `ui.fingerRadius` | 10–40px |

| Toggle | Controls |
|--------|----------|
| Show Top Bubble | Floating candidate indicator |
| Key Highlights | DOM key highlighting |
| Suggestion Console | Word suggestion pill |
| Debug Labels | Debug overlay |

---

## Design Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#080a0d` | Page background |
| `--surface` | `#0e1118` | Card backgrounds |
| `--accent` | `#00d4ff` | Primary accent (cyan) |
| `--accent2` | `#8b5cf6` | Secondary accent (purple) |
| `--commit-col` | `#00ffaa` | Commit feedback (green) |
| `--armed-col` | `#ffb700` | Armed/cooldown (orange) |
| `--danger` | `#ff4455` | Clear/delete (red) |
| `--suggest-col` | `#c084fc` | Suggestions (light purple) |
| `--key-bg` | `#131820` | Key fill |
| `--key-text` | `#8898b8` | Key label |

---

## File Structure

```
SteerPOP/
├── steerpop-engine.js    # Pure logic engine (no DOM)
├── web-adapter.js        # Browser shell (DOM + canvas + events)
├── index.html            # Page layout + CSS design system
├── steerpop-test.js      # Test cases
├── test.html             # Test runner
├── steerpop-v02.html     # Legacy prototype (reference)
├── steerpop-demo.html    # Legacy demo (reference)
└── SPEC.md               # This document
```

---

## Architecture Principle

> The engine owns decisions. The adapter owns pixels.

Same engine input trace always produces the same output events, whether the shell is web, Android, or a test harness. The adapter never invents logic — it only translates events in and renders state out.
