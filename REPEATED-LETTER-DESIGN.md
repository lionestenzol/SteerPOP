# Repeated-Letter Gesture Design

> **Status: IMPLEMENTED** — Flick-down repeat is fully implemented in steerpop-engine.js v0.4.
> See `_checkFlickDown()` and `_commitRepeat()`. Tests #21-22 verify.

## Problem
Users cannot type repeated letters (e.g., "LL", "EE") without lifting their finger. This breaks the core promise of reduced lift frequency.

---

## Candidate Gestures

### Option A: Short Downward Flick
Mirror the existing commit-up flick: a quick downward flick while on the anchor key recommits the current anchor letter.

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Learnability | High | Intuitive opposite of commit-up; "flick up = next letter, flick down = same letter again" |
| Compatibility | High | Downward direction is currently unused during sessions |
| Implementation | Low | Mirror `_checkFlickUp()` with inverted Y check |
| User control | High | Speed threshold prevents accidental triggers |

### Option B: Dwell Timer
Stay on the anchor key without moving for X ms (e.g., 400 ms) to recommit.

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Learnability | Medium | Invisible — user must discover by accident or documentation |
| Compatibility | High | No gesture conflict |
| Implementation | Low | Add timer check in `pointerMove()` when inside deadzone |
| User control | Low | Easy to trigger accidentally when pausing to think |

### Option C: Small "Repeat Zone" Near Anchor
A visible UI zone (e.g., below the anchor key) that the user slides into to recommit.

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Learnability | High | Visible affordance |
| Compatibility | Medium | Consumes screen space; conflicts with downward slide to lower row |
| Implementation | Medium | Requires adapter layout changes + engine zone detection |
| User control | Medium | Zone boundaries could interfere with row switching |

---

## Recommendation: Option A — Short Downward Flick

The downward flick is the strongest choice because:
1. It mirrors the existing flick-up pattern — users learn one gesture and get two behaviors.
2. It requires no visual UI changes.
3. It does not conflict with any existing gesture (downward swipe selects lower-row candidates, but a *flick* is a velocity spike, not a sustained slide).
4. The speed threshold provides good accidental-trigger protection.

---

## Required Changes

### Engine (`steerpop-engine.js`)

**1. New config parameter:**
```js
flickDownSpeedThreshold: 10,  // same as flickSpeedThreshold (can reuse)
```

**2. New method `_checkFlickDown(timestamp)`:**
```
_checkFlickDown(timestamp):
  if flickState !== 'sliding': return
  if no anchorKey: return

  // Need at least 5 velocity samples
  if velocityBuffer.length < 5: return

  // Check recent velocity — must be DOWNWARD (positive Y)
  recentVy = (recent1.y - recent2.y) / dt * 16
  if recentVy <= 0: return              // not moving down

  recentSpeed = hypot(recentVx, recentVy)
  if recentSpeed < flickSpeedThreshold: return  // too slow

  downwardSpeed = abs(recentVy)
  horizontalSpeed = abs(recentVx)
  flickAngle = atan2(horizontalSpeed, downwardSpeed)
  if flickAngle > flickAngleThreshold: return   // too sideways

  // Previous motion must NOT have been strongly downward (same logic as flick-up)
  prevDownward = prevVy  // positive if was moving down
  if prevDownward > flickSpeedThreshold * 0.8:
    if downwardSpeed < prevDownward * 1.8: return

  // Repeat confirmed — recommit anchor letter
  _commitRepeat(anchorKey, timestamp)
```

**3. New method `_commitRepeat(keyId, timestamp)`:**
```
_commitRepeat(keyId, timestamp):
  emit('letter_committed', { key: keyId, label: key.label, commitType: 'repeat' })
  emit('repeat_committed', { key: keyId, label: key.label })

  // Do NOT reanchor — stay on same key
  // Enter cooldown to prevent rapid-fire
  flickState = 'cooldown'
  flickCooldownUntil = timestamp + flickCooldownMs
  velocityBuffer = []

  // Clear candidates (finger is near anchor)
  candidates = []
  topCandidate = null
```

**4. Call site in `pointerMove()`:**
Add `this._checkFlickDown(p.timestamp)` right after `this._checkFlickUp(p.timestamp)` on line 358.

### Adapter (`web-adapter.js`)

**Minimal changes:**
- `processEvents()`: handle `repeat_committed` event — append `evt.detail.label` to `outputText` (same as `letter_committed` handler).
- No visual changes needed — the bubble briefly disappears during cooldown, providing natural feedback.

### State Machine Change

```
Current:
  idle → [pointerDown] → sliding → [flick-up] → cooldown → sliding
                                  → [pointerUp] → idle

Proposed addition:
  sliding → [flick-down] → cooldown → sliding
             (recommits anchor letter)
```

The key difference from flick-up: **no reanchor**. The finger stays on the same key, and the user can immediately slide to the next letter or flick down again for a third repeat.
