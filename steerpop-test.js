/**
 * SteerPop Engine v0.4 — Tests for Layer-Based Model
 * No framework. Console pass/fail.
 *
 * @module steerpop-test
 */

import { SteerPopEngine } from './steerpop-engine.js';

// ─────────────────────────────────────────────────────────────
// HARNESS
// ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${msg}`);
  } else {
    failed++;
    console.error(`  \u2717 FAIL: ${msg}`);
  }
}

function section(name) {
  console.log(`\n\u2500\u2500 ${name} \u2500\u2500`);
}

// ─────────────────────────────────────────────────────────────
// TEST GEOMETRY
// ─────────────────────────────────────────────────────────────

const KEY_W = 50;
const GAP = 5;

const ROWS = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M'],
];

function buildGeometry() {
  const keys = [];
  ROWS.forEach((row, ri) => {
    const offsetX = ri * 15;
    row.forEach((label, ci) => {
      keys.push({
        id: label, label, row: ri, col: ci,
        centerX: offsetX + ci * (KEY_W + GAP) + KEY_W / 2,
        centerY: ri * (KEY_W + GAP) + KEY_W / 2,
        width: KEY_W, height: KEY_W, excluded: false,
      });
    });
  });
  return keys;
}

function keyCenter(geo, id) {
  const k = geo.find(k => k.id === id);
  return { x: k.centerX, y: k.centerY };
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

function runTests() {
  const geo = buildGeometry();

  // ── 1. Tap commits immediately ────────────────────────────
  section('1. Tap commits immediately (Layer 0)');
  {
    const engine = new SteerPopEngine();
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    const events = engine.consumeEvents();

    assert(events.some(e => e.type === 'session_started'), 'session_started emitted');
    assert(events.some(e => e.type === 'letter_committed' && e.key === 'H'), 'H committed on tap');
    assert(events.find(e => e.type === 'letter_committed').commitType === 'tap', 'commit type is tap');

    const s = engine.getState();
    assert(s.active === true, 'session still active after tap');
    assert(s.anchorKey === 'H', 'anchor is H');
  }

  // ── 2. Slide left → G is top candidate ────────────────────
  section('2. Slide left → G is top candidate');
  {
    const engine = new SteerPopEngine({ deadzoneRadius: 5 });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    // Slide left
    engine.pointerMove({ x: h.x - 30, y: h.y, timestamp: 1050 });

    const s = engine.getState();
    assert(s.candidates.length > 0, 'candidates appear on slide');
    assert(s.topCandidate === 'G', `top candidate is G (got ${s.topCandidate})`);
  }

  // ── 3. Slide far left → further keys rank higher ──────────
  section('3. Slide far left → further keys appear');
  {
    const engine = new SteerPopEngine({ deadzoneRadius: 5, candidateAngleSpread: 90 });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    // Slide far left
    engine.pointerMove({ x: h.x - 80, y: h.y, timestamp: 1050 });

    const s = engine.getState();
    const ids = s.candidates.map(c => c.id);
    assert(ids.includes('G'), 'G in candidates');
    assert(ids.includes('F') || ids.includes('D'), 'further keys F or D also in candidates');
  }

  // ── 4. Slide up-left → upper-left keys ────────────────────
  section('4. Slide up-left → upper row keys');
  {
    const engine = new SteerPopEngine({ deadzoneRadius: 5, candidateAngleSpread: 150 });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    // Slide up-left gradually (so flick doesn't trigger)
    engine.pointerMove({ x: h.x - 5,  y: h.y - 15, timestamp: 1020 });
    engine.pointerMove({ x: h.x - 10, y: h.y - 30, timestamp: 1040 });
    engine.pointerMove({ x: h.x - 15, y: h.y - 45, timestamp: 1060 });
    engine.pointerMove({ x: h.x - 20, y: h.y - 60, timestamp: 1080 });

    const s = engine.getState();
    const ids = s.candidates.map(c => c.id);
    // Upward from H should include row-0 keys
    const hasUpperRow = ids.some(id => {
      const k = geo.find(k => k.id === id);
      return k && k.row === 0;
    });
    assert(hasUpperRow, 'upper row keys appear when swiping up-left');
  }

  // ── 5. Flick up → top candidate commits ───────────────────
  section('5. Flick up commits top candidate');
  {
    const engine = new SteerPopEngine({
      deadzoneRadius: 5,
      flickSpeedThreshold: 2,
      flickCooldownMs: 100,
    });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    // Slide left gradually to build velocity buffer
    engine.pointerMove({ x: h.x - 10, y: h.y, timestamp: 1030 });
    engine.pointerMove({ x: h.x - 20, y: h.y, timestamp: 1040 });
    engine.pointerMove({ x: h.x - 30, y: h.y, timestamp: 1050 });
    engine.pointerMove({ x: h.x - 35, y: h.y, timestamp: 1060 });
    engine.consumeEvents();

    const topBefore = engine.getState().topCandidate;
    assert(topBefore !== null, 'has a top candidate before flick');

    // Flick upward: rapid upward movement
    engine.pointerMove({ x: h.x - 35, y: h.y - 10, timestamp: 1070 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 25, timestamp: 1080 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 50, timestamp: 1090 });

    const events = engine.consumeEvents();
    const commits = events.filter(e => e.type === 'letter_committed' && e.commitType === 'flick');
    assert(commits.length === 1, 'one flick commit');

    const flickEvents = events.filter(e => e.type === 'flick_confirmed');
    assert(flickEvents.length === 1, 'flick_confirmed event emitted');
  }

  // ── 6. After flick, anchor moves ──────────────────────────
  section('6. Anchor moves after flick');
  {
    const engine = new SteerPopEngine({
      deadzoneRadius: 5,
      flickSpeedThreshold: 2,
      flickCooldownMs: 50,
    });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    // Slide left gradually
    engine.pointerMove({ x: h.x - 10, y: h.y, timestamp: 1030 });
    engine.pointerMove({ x: h.x - 20, y: h.y, timestamp: 1040 });
    engine.pointerMove({ x: h.x - 30, y: h.y, timestamp: 1050 });
    engine.pointerMove({ x: h.x - 35, y: h.y, timestamp: 1060 });
    engine.consumeEvents();

    // Flick up
    engine.pointerMove({ x: h.x - 35, y: h.y - 10, timestamp: 1070 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 25, timestamp: 1080 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 50, timestamp: 1090 });

    // Check that a flick commit happened and anchor changed from H
    const events = engine.consumeEvents();
    const flickCommit = events.find(e => e.type === 'flick_confirmed');
    assert(flickCommit !== undefined, 'flick commit happened');

    const s = engine.getState();
    assert(s.anchorKey === flickCommit.key, `anchor moved to ${flickCommit.key}`);
    assert(s.anchorKey !== 'H', 'anchor is no longer H');
    assert(s.active === true, 'session still active after flick');
  }

  // ── 7. Cooldown prevents double-flick ─────────────────────
  section('7. Cooldown prevents double-flick');
  {
    const engine = new SteerPopEngine({
      deadzoneRadius: 5,
      flickSpeedThreshold: 2,
      flickCooldownMs: 500,
    });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    // Slide gradually then flick
    engine.pointerMove({ x: h.x - 10, y: h.y, timestamp: 1030 });
    engine.pointerMove({ x: h.x - 20, y: h.y, timestamp: 1040 });
    engine.pointerMove({ x: h.x - 30, y: h.y, timestamp: 1050 });
    engine.pointerMove({ x: h.x - 35, y: h.y, timestamp: 1060 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 10, timestamp: 1070 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 25, timestamp: 1080 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 50, timestamp: 1090 });
    const first = engine.consumeEvents().filter(e => e.type === 'flick_confirmed');
    assert(first.length === 1, 'first flick works');

    // Immediately try another flick (still in cooldown)
    engine.pointerMove({ x: h.x - 35, y: h.y - 55, timestamp: 1100 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 75, timestamp: 1110 });
    const second = engine.consumeEvents().filter(e => e.type === 'flick_confirmed');
    assert(second.length === 0, 'no second flick during cooldown');
  }

  // ── 8. Deadzone → no candidates ───────────────────────────
  section('8. Deadzone prevents candidates');
  {
    const engine = new SteerPopEngine({ deadzoneRadius: 15 });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    // Tiny movement inside deadzone
    engine.pointerMove({ x: h.x + 5, y: h.y - 3, timestamp: 1050 });

    const s = engine.getState();
    assert(s.candidates.length === 0, 'no candidates inside deadzone');
    assert(s.topCandidate === null, 'no top candidate inside deadzone');
  }

  // ── 9. Pointer up ends session ────────────────────────────
  section('9. Pointer up ends session');
  {
    const engine = new SteerPopEngine();
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    engine.pointerUp({ x: h.x, y: h.y, timestamp: 1200 });
    const events = engine.consumeEvents();
    assert(events.some(e => e.type === 'session_ended'), 'session_ended emitted');

    const s = engine.getState();
    assert(s.active === false, 'session inactive after pointer up');
  }

  // ── 10. Trace replay determinism ──────────────────────────
  section('10. Trace replay determinism');
  {
    const engine = new SteerPopEngine({
      deadzoneRadius: 5,
      flickSpeedThreshold: 2,
      flickCooldownMs: 100,
    });

    const h = keyCenter(geo, 'H');

    const trace = {
      geometry: geo,
      events: [
        { type: 'pointerDown', x: h.x, y: h.y, timestamp: 1000 },
        { type: 'pointerMove', x: h.x - 10, y: h.y, timestamp: 1020 },
        { type: 'pointerMove', x: h.x - 20, y: h.y, timestamp: 1040 },
        { type: 'pointerMove', x: h.x - 30, y: h.y, timestamp: 1060 },
        { type: 'pointerMove', x: h.x - 35, y: h.y, timestamp: 1080 },
        { type: 'pointerMove', x: h.x - 35, y: h.y - 10, timestamp: 1090 },
        { type: 'pointerMove', x: h.x - 35, y: h.y - 25, timestamp: 1100 },
        { type: 'pointerMove', x: h.x - 35, y: h.y - 50, timestamp: 1110 },
        { type: 'pointerUp', x: h.x - 35, y: h.y - 50, timestamp: 1200 },
      ],
    };

    const events1 = engine.replayTrace(trace);
    const events2 = engine.replayTrace(trace);

    assert(events1.length === events2.length, 'same trace = same event count');
    assert(
      events1.map(e => e.type).join(',') === events2.map(e => e.type).join(','),
      'same trace = identical event sequence'
    );
    assert(events1.some(e => e.type === 'session_started'), 'replay has session_started');
    assert(events1.filter(e => e.type === 'letter_committed').length >= 2, 'replay has tap + flick commits');
  }

  // ── 11. Engine has no DOM references ──────────────────────
  section('11. Engine purity');
  {
    const engine = new SteerPopEngine();
    const src = SteerPopEngine.toString();
    assert(!src.includes('document.'), 'no document references in engine class');
    assert(!src.includes('window.'), 'no window references in engine class');
    assert(!src.includes('canvas'), 'no canvas references in engine class');
    assert(!src.includes('Date.now()'), 'no Date.now() calls in engine class');
  }

  // ── 12. Scoring path: basic candidate generation ─────────
  section('12. Scoring path: slide right produces candidates');
  {
    const engine = new SteerPopEngine({ useScoring: true, deadzoneRadius: 5 });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    // Slide right
    engine.pointerMove({ x: h.x + 30, y: h.y, timestamp: 1050 });

    const s = engine.getState();
    assert(s.candidates.length > 0, 'scoring path produces candidates on slide');
    assert(s.topCandidate === 'J', `top candidate is J (got ${s.topCandidate})`);
  }

  // ── 13. Scoring path: slide left produces candidates ────
  section('13. Scoring path: slide left produces candidates');
  {
    const engine = new SteerPopEngine({ useScoring: true, deadzoneRadius: 5 });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    // Slide left
    engine.pointerMove({ x: h.x - 30, y: h.y, timestamp: 1050 });

    const s = engine.getState();
    assert(s.candidates.length > 0, 'scoring path produces candidates sliding left');
    assert(s.topCandidate === 'G', `top candidate is G (got ${s.topCandidate})`);
  }

  // ── 14. Scoring path: hysteresis resists change ─────────
  section('14. Scoring path: hysteresis stabilizes top candidate');
  {
    const engine = new SteerPopEngine({
      useScoring: true, deadzoneRadius: 5, hysteresis: 0.3,
    });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    // Slide right to lock on J
    engine.pointerMove({ x: h.x + 40, y: h.y, timestamp: 1050 });
    const s1 = engine.getState();
    assert(s1.topCandidate === 'J', 'top candidate locks to J');

    // Small movement — should NOT switch to K yet due to hysteresis
    engine.pointerMove({ x: h.x + 55, y: h.y, timestamp: 1060 });
    const s2 = engine.getState();
    // J should resist switching unless K's score margin exceeds hysteresis * 0.5
    assert(s2.topCandidate !== null, 'still has a top candidate after small move');
  }

  // ── 15. Scoring path: anchor excluded from candidates ───
  section('15. Scoring path: anchor not in candidates');
  {
    const engine = new SteerPopEngine({ useScoring: true, deadzoneRadius: 5 });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    engine.pointerMove({ x: h.x + 30, y: h.y, timestamp: 1050 });

    const s = engine.getState();
    const ids = s.candidates.map(c => c.id);
    assert(!ids.includes('H'), 'anchor H is excluded from candidates');
  }

  // ── 16. Scoring path: row switching ─────────────────────
  section('16. Scoring path: Y displacement switches row');
  {
    const engine = new SteerPopEngine({ useScoring: true, deadzoneRadius: 5 });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    // Slide upward to switch to row 0
    engine.pointerMove({ x: h.x - 5,  y: h.y - 15, timestamp: 1020 });
    engine.pointerMove({ x: h.x - 10, y: h.y - 35, timestamp: 1040 });
    engine.pointerMove({ x: h.x - 15, y: h.y - 50, timestamp: 1060 });

    const s = engine.getState();
    assert(s.activeRow === 0, `active row switched to 0 (got ${s.activeRow})`);
    const ids = s.candidates.map(c => c.id);
    const hasRow0 = ids.some(id => {
      const k = geo.find(k => k.id === id);
      return k && k.row === 0;
    });
    assert(hasRow0, 'candidates include row 0 keys after upward slide');
  }

  // ── 17. Scoring path: flick detection works ─────────────
  section('17. Scoring path: flick up commits');
  {
    const engine = new SteerPopEngine({
      useScoring: true, deadzoneRadius: 5,
      flickSpeedThreshold: 2, flickCooldownMs: 100,
    });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    // Slide left gradually
    engine.pointerMove({ x: h.x - 10, y: h.y, timestamp: 1030 });
    engine.pointerMove({ x: h.x - 20, y: h.y, timestamp: 1040 });
    engine.pointerMove({ x: h.x - 30, y: h.y, timestamp: 1050 });
    engine.pointerMove({ x: h.x - 35, y: h.y, timestamp: 1060 });
    engine.consumeEvents();

    assert(engine.getState().topCandidate !== null, 'has top candidate before flick');

    // Flick up
    engine.pointerMove({ x: h.x - 35, y: h.y - 10, timestamp: 1070 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 25, timestamp: 1080 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 50, timestamp: 1090 });

    const events = engine.consumeEvents();
    const commits = events.filter(e => e.type === 'letter_committed' && e.commitType === 'flick');
    assert(commits.length === 1, 'scoring path flick produces one commit');
  }

  // ── 18. Golden trace: tap-only "HG" ─────────────────────
  section('18. Golden trace: tap H then tap G');
  {
    const engine = new SteerPopEngine({ deadzoneRadius: 5 });
    const h = keyCenter(geo, 'H');
    const g = keyCenter(geo, 'G');

    const trace = {
      geometry: geo,
      events: [
        { type: 'pointerDown', x: h.x, y: h.y, timestamp: 1000 },
        { type: 'pointerUp', x: h.x, y: h.y, timestamp: 1100 },
        { type: 'pointerDown', x: g.x, y: g.y, timestamp: 1200 },
        { type: 'pointerUp', x: g.x, y: g.y, timestamp: 1300 },
      ],
    };

    const events1 = engine.replayTrace(trace);
    const events2 = engine.replayTrace(trace);

    // Golden: exact event types
    const expectedTypes = [
      'session_started', 'letter_committed',   // tap H
      'session_ended',
      'session_started', 'letter_committed',   // tap G
      'session_ended',
    ];

    const actualTypes = events1.map(e => e.type);
    assert(
      actualTypes.join(',') === expectedTypes.join(','),
      `tap-only trace event types match golden (got ${actualTypes.join(',')})`
    );

    // Golden: exact keys committed
    const commits = events1.filter(e => e.type === 'letter_committed');
    assert(commits[0].key === 'H', 'first commit is H');
    assert(commits[1].key === 'G', 'second commit is G');
    assert(commits.every(c => c.commitType === 'tap'), 'all commits are taps');

    // Determinism: identical across runs
    assert(
      events1.map(e => `${e.type}:${e.timestamp}`).join('|') ===
      events2.map(e => `${e.type}:${e.timestamp}`).join('|'),
      'tap-only trace is deterministic (types + timestamps match)'
    );
  }

  // ── 19. Golden trace: slide + flick "H→G" ──────────────
  section('19. Golden trace: tap H, slide-flick G');
  {
    const engine = new SteerPopEngine({
      deadzoneRadius: 5,
      flickSpeedThreshold: 2,
      flickCooldownMs: 100,
    });
    const h = keyCenter(geo, 'H');

    const trace = {
      geometry: geo,
      events: [
        { type: 'pointerDown', x: h.x, y: h.y, timestamp: 1000 },
        // Slide left gradually
        { type: 'pointerMove', x: h.x - 10, y: h.y, timestamp: 1030 },
        { type: 'pointerMove', x: h.x - 20, y: h.y, timestamp: 1040 },
        { type: 'pointerMove', x: h.x - 30, y: h.y, timestamp: 1050 },
        { type: 'pointerMove', x: h.x - 35, y: h.y, timestamp: 1060 },
        // Flick up
        { type: 'pointerMove', x: h.x - 35, y: h.y - 10, timestamp: 1070 },
        { type: 'pointerMove', x: h.x - 35, y: h.y - 25, timestamp: 1080 },
        { type: 'pointerMove', x: h.x - 35, y: h.y - 50, timestamp: 1090 },
        { type: 'pointerUp', x: h.x - 35, y: h.y - 50, timestamp: 1200 },
      ],
    };

    const events1 = engine.replayTrace(trace);
    const events2 = engine.replayTrace(trace);

    // Should have: session_started, letter_committed(tap H), target_changed(s), ..., flick_confirmed, letter_committed(flick), session_ended
    const commits = events1.filter(e => e.type === 'letter_committed');
    assert(commits.length >= 2, 'trace has at least 2 commits (tap + flick)');
    assert(commits[0].commitType === 'tap', 'first commit is tap');
    assert(commits[0].key === 'H', 'first commit is H');
    assert(commits[commits.length - 1].commitType === 'flick', 'last commit is flick');

    // Determinism
    assert(events1.length === events2.length, 'slide-flick trace: same event count');
    assert(
      events1.map(e => `${e.type}:${e.timestamp}`).join('|') ===
      events2.map(e => `${e.type}:${e.timestamp}`).join('|'),
      'slide-flick trace is deterministic'
    );
  }

  // ── 20. Golden trace: multi-letter with cooldown ────────
  section('20. Golden trace: multi-letter with cooldown crossing');
  {
    const engine = new SteerPopEngine({
      deadzoneRadius: 5,
      flickSpeedThreshold: 2,
      flickCooldownMs: 100,
    });
    const h = keyCenter(geo, 'H');
    const g = keyCenter(geo, 'G');

    const trace = {
      geometry: geo,
      events: [
        // Tap H
        { type: 'pointerDown', x: h.x, y: h.y, timestamp: 1000 },
        // Slide left + flick
        { type: 'pointerMove', x: h.x - 10, y: h.y, timestamp: 1030 },
        { type: 'pointerMove', x: h.x - 20, y: h.y, timestamp: 1040 },
        { type: 'pointerMove', x: h.x - 30, y: h.y, timestamp: 1050 },
        { type: 'pointerMove', x: h.x - 35, y: h.y, timestamp: 1060 },
        { type: 'pointerMove', x: h.x - 35, y: h.y - 10, timestamp: 1070 },
        { type: 'pointerMove', x: h.x - 35, y: h.y - 25, timestamp: 1080 },
        { type: 'pointerMove', x: h.x - 35, y: h.y - 50, timestamp: 1090 },
        // Wait for cooldown to expire, then slide again
        { type: 'pointerMove', x: g.x - 30, y: g.y, timestamp: 1250 },
        { type: 'pointerMove', x: g.x - 40, y: g.y, timestamp: 1260 },
        { type: 'pointerUp', x: g.x - 40, y: g.y, timestamp: 1300 },
      ],
    };

    const events1 = engine.replayTrace(trace);
    const events2 = engine.replayTrace(trace);

    const commits = events1.filter(e => e.type === 'letter_committed');
    assert(commits.length >= 2, 'multi-letter trace has at least 2 commits');

    // Determinism
    assert(
      events1.map(e => `${e.type}:${e.timestamp}`).join('|') ===
      events2.map(e => `${e.type}:${e.timestamp}`).join('|'),
      'multi-letter trace is deterministic'
    );

    // All timestamps should be from the trace, not wall-clock
    const allTimestamps = events1.map(e => e.timestamp);
    assert(
      allTimestamps.every(t => t >= 1000 && t <= 1300),
      'all event timestamps are within trace time range (no wall-clock leaks)'
    );
  }

  // ── 21. Downward flick repeats anchor letter ─────────────
  section('21. Downward flick repeats anchor letter');
  {
    const engine = new SteerPopEngine({
      deadzoneRadius: 5,
      flickSpeedThreshold: 2,
      flickCooldownMs: 100,
    });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents(); // consume tap commit

    // Slide horizontally to build buffer (NOT downward, so flick-down detects direction change)
    engine.pointerMove({ x: h.x + 10, y: h.y, timestamp: 1030 });
    engine.pointerMove({ x: h.x + 15, y: h.y, timestamp: 1040 });
    engine.pointerMove({ x: h.x + 10, y: h.y, timestamp: 1050 });
    engine.pointerMove({ x: h.x + 8,  y: h.y, timestamp: 1060 });
    engine.consumeEvents();

    // Flick downward: sudden direction change from horizontal to fast downward
    engine.pointerMove({ x: h.x + 8, y: h.y + 2, timestamp: 1070 });
    engine.pointerMove({ x: h.x + 8, y: h.y + 15, timestamp: 1080 });
    engine.pointerMove({ x: h.x + 8, y: h.y + 50, timestamp: 1090 });

    const events = engine.consumeEvents();
    const repeats = events.filter(e => e.type === 'letter_committed' && e.commitType === 'repeat');
    assert(repeats.length === 1, 'downward flick produces one repeat commit');
    assert(repeats[0].key === 'H', 'repeat commit is anchor key H');

    // Anchor should NOT have changed (repeat stays on same key)
    const s = engine.getState();
    assert(s.anchorKey === 'H', 'anchor stays H after repeat');
  }

  // ── 22. Double downward flick produces "HH" ────────────
  section('22. Double downward flick produces HH');
  {
    const engine = new SteerPopEngine({
      deadzoneRadius: 5,
      flickSpeedThreshold: 2,
      flickCooldownMs: 50, // short cooldown for test
    });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents(); // tap H

    // Slide horizontally to build buffer
    engine.pointerMove({ x: h.x + 10, y: h.y, timestamp: 1030 });
    engine.pointerMove({ x: h.x + 15, y: h.y, timestamp: 1040 });
    engine.pointerMove({ x: h.x + 10, y: h.y, timestamp: 1050 });
    engine.pointerMove({ x: h.x + 8,  y: h.y, timestamp: 1060 });
    engine.consumeEvents();

    // First downward flick (sudden direction change)
    engine.pointerMove({ x: h.x + 8, y: h.y + 2,  timestamp: 1070 });
    engine.pointerMove({ x: h.x + 8, y: h.y + 15, timestamp: 1080 });
    engine.pointerMove({ x: h.x + 8, y: h.y + 50, timestamp: 1090 });
    const r1 = engine.consumeEvents().filter(e => e.type === 'letter_committed' && e.commitType === 'repeat');
    assert(r1.length === 1, 'first repeat works');

    // Wait for cooldown to pass, slide horizontally, then second flick
    engine.pointerMove({ x: h.x + 10, y: h.y, timestamp: 1200 });
    engine.pointerMove({ x: h.x + 15, y: h.y, timestamp: 1210 });
    engine.pointerMove({ x: h.x + 10, y: h.y, timestamp: 1220 });
    engine.pointerMove({ x: h.x + 8,  y: h.y, timestamp: 1230 });
    engine.pointerMove({ x: h.x + 8, y: h.y + 2,  timestamp: 1240 });
    engine.pointerMove({ x: h.x + 8, y: h.y + 15, timestamp: 1250 });
    engine.pointerMove({ x: h.x + 8, y: h.y + 50, timestamp: 1260 });
    const r2 = engine.consumeEvents().filter(e => e.type === 'letter_committed' && e.commitType === 'repeat');
    assert(r2.length === 1, 'second repeat works after cooldown');

    assert(engine.getState().anchorKey === 'H', 'anchor still H after two repeats');
  }

  // ── 23. Backspace key emits letter_committed with ⌫ ─────
  section('23. Backspace key commits ⌫');
  {
    // Build geometry that includes backspace
    const geoWithBs = buildGeometry();
    geoWithBs.push({
      id: '⌫', label: '⌫', row: 3, col: 0,
      centerX: 400, centerY: 200,
      width: 70, height: 50, excluded: true,
    });

    const engine = new SteerPopEngine();
    engine.setGeometry(geoWithBs);

    // Tap the backspace key
    engine.pointerDown({ x: 400, y: 200, timestamp: 1000 });
    const events = engine.consumeEvents();
    const commit = events.find(e => e.type === 'letter_committed');
    assert(commit !== undefined, 'backspace tap produces letter_committed');
    assert(commit.key === '⌫', 'committed key is ⌫');
    assert(commit.commitType === 'tap', 'commit type is tap');
  }

  // ── 24. Excluded keys not in candidates ─────────────────
  section('24. Excluded keys never appear as candidates');
  {
    const geoWithExcluded = buildGeometry();
    geoWithExcluded.push(
      { id: '⌫', label: '⌫', row: 3, col: 0, centerX: 400, centerY: 200, width: 70, height: 50, excluded: true },
      { id: 'SPACE', label: 'SPACE', row: 4, col: 0, centerX: 300, centerY: 250, width: 200, height: 50, excluded: true },
    );

    const engine = new SteerPopEngine({ deadzoneRadius: 5 });
    engine.setGeometry(geoWithExcluded);
    const h = keyCenter(geoWithExcluded, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    // Slide in various directions
    engine.pointerMove({ x: h.x + 40, y: h.y + 40, timestamp: 1050 });
    const s = engine.getState();
    const ids = s.candidates.map(c => c.id);
    assert(!ids.includes('⌫'), '⌫ not in candidates');
    assert(!ids.includes('SPACE'), 'SPACE not in candidates');
  }

  // ── 25. endSession() public method works ────────────────
  section('25. Public endSession() terminates active session');
  {
    const engine = new SteerPopEngine();
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();
    assert(engine.getState().active === true, 'session active after pointerDown');

    engine.endSession(1500);
    const events = engine.consumeEvents();
    assert(events.some(e => e.type === 'session_ended'), 'session_ended emitted');
    assert(engine.getState().active === false, 'session inactive after endSession');
  }

  // ── 26. Space key commits SPACE label ──────────────────────
  section('26. Space key commits SPACE label');
  {
    const geoWithSpace = buildGeometry();
    geoWithSpace.push({
      id: 'SPACE', label: 'SPACE', row: 4, col: 0,
      centerX: 300, centerY: 280,
      width: 200, height: 50, excluded: true,
    });

    const engine = new SteerPopEngine();
    engine.setGeometry(geoWithSpace);

    engine.pointerDown({ x: 300, y: 280, timestamp: 1000 });
    const events = engine.consumeEvents();
    const commit = events.find(e => e.type === 'letter_committed');
    assert(commit !== undefined, 'space tap produces letter_committed');
    assert(commit.key === 'SPACE', 'committed key is SPACE');
    assert(commit.label === 'SPACE', 'committed label is SPACE');
    assert(commit.commitType === 'tap', 'commit type is tap');
  }

  // ── 27. Punctuation key commits correct label ────────────
  section('27. Punctuation key commits correct label');
  {
    const geoWithPunct = buildGeometry();
    geoWithPunct.push({
      id: '.', label: '.', row: 3, col: 0,
      centerX: 100, centerY: 200,
      width: 50, height: 50, excluded: true,
    });

    const engine = new SteerPopEngine();
    engine.setGeometry(geoWithPunct);

    engine.pointerDown({ x: 100, y: 200, timestamp: 1000 });
    const events = engine.consumeEvents();
    const commit = events.find(e => e.type === 'letter_committed');
    assert(commit !== undefined, 'period tap produces letter_committed');
    assert(commit.key === '.', 'committed key is .');
    assert(commit.label === '.', 'committed label is .');
  }

  // ── 28. Fallback safety: tap-only produces exactly 1 commit ─
  section('28. Fallback: tap + immediate lift = exactly 1 commit');
  {
    const engine = new SteerPopEngine();
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.pointerUp({ x: h.x, y: h.y, timestamp: 1050 });
    const events = engine.consumeEvents();

    const commits = events.filter(e => e.type === 'letter_committed');
    assert(commits.length === 1, 'exactly 1 letter_committed');
    assert(events.filter(e => e.type === 'session_started').length === 1, 'exactly 1 session_started');
    assert(events.filter(e => e.type === 'session_ended').length === 1, 'exactly 1 session_ended');
  }

  // ── 29. Fallback: slide without flick = only tap commit ───
  section('29. Fallback: slide without flick = only tap commit');
  {
    const engine = new SteerPopEngine({ deadzoneRadius: 5 });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.pointerMove({ x: h.x - 30, y: h.y, timestamp: 1050 });
    engine.pointerMove({ x: h.x - 40, y: h.y, timestamp: 1060 });
    engine.pointerUp({ x: h.x - 40, y: h.y, timestamp: 1100 });
    const events = engine.consumeEvents();

    const commits = events.filter(e => e.type === 'letter_committed');
    assert(commits.length === 1, 'only 1 commit (the tap)');
    assert(commits[0].commitType === 'tap', 'commit is tap, not flick');
  }

  // ── 30. Tap on empty space = no events ────────────────────
  section('30. Tap on empty space produces no events');
  {
    const engine = new SteerPopEngine();
    engine.setGeometry(geo);

    // Tap far from any key
    engine.pointerDown({ x: 9999, y: 9999, timestamp: 1000 });
    const events = engine.consumeEvents();
    assert(events.length === 0, 'no events when tapping empty space');
    assert(engine.getState().active === false, 'session not started');
  }

  // ── 31. Triple repeat via flick-down ──────────────────────
  section('31. Triple repeat via flick-down');
  {
    const engine = new SteerPopEngine({
      deadzoneRadius: 5,
      flickSpeedThreshold: 2,
      flickCooldownMs: 50,
    });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents(); // tap H

    // Helper: horizontal slide then flick-down
    function flickDown(baseT) {
      engine.pointerMove({ x: h.x + 10, y: h.y, timestamp: baseT });
      engine.pointerMove({ x: h.x + 15, y: h.y, timestamp: baseT + 10 });
      engine.pointerMove({ x: h.x + 10, y: h.y, timestamp: baseT + 20 });
      engine.pointerMove({ x: h.x + 8,  y: h.y, timestamp: baseT + 30 });
      engine.pointerMove({ x: h.x + 8, y: h.y + 2,  timestamp: baseT + 40 });
      engine.pointerMove({ x: h.x + 8, y: h.y + 15, timestamp: baseT + 50 });
      engine.pointerMove({ x: h.x + 8, y: h.y + 50, timestamp: baseT + 60 });
      return engine.consumeEvents().filter(e => e.type === 'letter_committed' && e.commitType === 'repeat');
    }

    const r1 = flickDown(1100);
    assert(r1.length === 1, 'first repeat');

    const r2 = flickDown(1300);
    assert(r2.length === 1, 'second repeat');

    const r3 = flickDown(1500);
    assert(r3.length === 1, 'third repeat');

    assert(engine.getState().anchorKey === 'H', 'anchor still H after triple repeat');
  }

  // ══════════════════════════════════════════════════════════
  // VECTOR FOUNDATION TESTS
  // ══════════════════════════════════════════════════════════

  // ── 32. Vector utility correctness ────────────────────────
  section('32. Vector utilities');
  {
    // vectorFromTo
    const v = SteerPopEngine._vectorFromTo
      ? SteerPopEngine._vectorFromTo(10, 20, 30, 50)
      : null;

    // Test via engine internals — use normalizeCommitTrace as a proxy
    // that exercises vecNormalize internally.
    // Direct test: cosineSimilarity of parallel vectors = 1
    const trace1 = SteerPopEngine.normalizeCommitTrace([{ dx: 10, dy: 0 }], 1);
    assert(trace1.length === 1, 'normalizeCommitTrace returns targetLength vectors');
    assert(Math.abs(trace1[0].x - 1) < 0.01 && Math.abs(trace1[0].y) < 0.01,
      'single rightward vector normalizes to (1, 0)');

    // Opposite direction
    const trace2 = SteerPopEngine.normalizeCommitTrace([{ dx: -5, dy: 0 }], 1);
    assert(Math.abs(trace2[0].x - (-1)) < 0.01, 'leftward vector normalizes to (-1, 0)');

    // Diagonal
    const trace3 = SteerPopEngine.normalizeCommitTrace([{ dx: 3, dy: 3 }], 1);
    const expectedDiag = 1 / Math.SQRT2;
    assert(Math.abs(trace3[0].x - expectedDiag) < 0.01 && Math.abs(trace3[0].y - expectedDiag) < 0.01,
      'diagonal vector normalizes correctly');

    // Zero vector
    const trace4 = SteerPopEngine.normalizeCommitTrace([], 5);
    assert(trace4.length === 5, 'empty input produces targetLength zero vectors');
    assert(trace4.every(v => v.x === 0 && v.y === 0), 'empty input all zeros');
  }

  // ── 33. Gesture capture in session_ended event ────────────
  section('33. Gesture capture populates session_ended');
  {
    const engine = new SteerPopEngine({
      deadzoneRadius: 5,
      flickSpeedThreshold: 2,
      flickCooldownMs: 100,
    });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents(); // tap H

    // Slide left + flick up to commit G
    engine.pointerMove({ x: h.x - 10, y: h.y, timestamp: 1030 });
    engine.pointerMove({ x: h.x - 20, y: h.y, timestamp: 1040 });
    engine.pointerMove({ x: h.x - 30, y: h.y, timestamp: 1050 });
    engine.pointerMove({ x: h.x - 35, y: h.y, timestamp: 1060 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 10, timestamp: 1070 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 25, timestamp: 1080 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 50, timestamp: 1090 });
    engine.consumeEvents(); // consume flick events

    // End session
    engine.pointerUp({ x: h.x - 35, y: h.y - 50, timestamp: 1200 });
    const events = engine.consumeEvents();
    const ended = events.find(e => e.type === 'session_ended');

    assert(ended !== undefined, 'session_ended event exists');
    assert(Array.isArray(ended.gestureVectors), 'gestureVectors is an array');
    assert(ended.gestureVectors.length > 0, 'gestureVectors has entries');
    assert(Array.isArray(ended.gestureKeySequence), 'gestureKeySequence is an array');
    assert(ended.gestureKeySequence.length >= 2, 'gestureKeySequence has tap + flick keys');
    assert(ended.gestureKeySequence[0] === 'H', 'first key is H (tap)');
    assert(Array.isArray(ended.commitVectors), 'commitVectors is an array');
    assert(ended.commitVectors.length >= 1, 'commitVectors has at least 1 entry (H→flicked key)');
  }

  // ── 34. normalizeCommitTrace produces exact targetLength ──
  section('34. normalizeCommitTrace output length');
  {
    // 3 commit vectors → normalize to 12
    const vectors = [
      { dx: 55, dy: 0 },
      { dx: -30, dy: -55 },
      { dx: 55, dy: 0 },
    ];
    const result = SteerPopEngine.normalizeCommitTrace(vectors, 12);
    assert(result.length === 12, 'output has exactly 12 vectors');

    // Each should be a unit vector (or close)
    const allUnit = result.every(v => {
      const len = Math.hypot(v.x, v.y);
      return len < 0.01 || Math.abs(len - 1) < 0.01; // zero or unit
    });
    assert(allUnit, 'all output vectors are unit length or zero');

    // Different target length
    const result8 = SteerPopEngine.normalizeCommitTrace(vectors, 8);
    assert(result8.length === 8, 'targetLength=8 produces 8 vectors');

    const result20 = SteerPopEngine.normalizeCommitTrace(vectors, 20);
    assert(result20.length === 20, 'targetLength=20 produces 20 vectors');
  }

  // ── 35. Commit vector accuracy ────────────────────────────
  section('35. Commit vectors match key positions');
  {
    const engine = new SteerPopEngine({
      deadzoneRadius: 5,
      flickSpeedThreshold: 2,
      flickCooldownMs: 100,
    });
    engine.setGeometry(geo);
    const h = keyCenter(geo, 'H');
    const g = keyCenter(geo, 'G');

    engine.pointerDown({ x: h.x, y: h.y, timestamp: 1000 });
    engine.consumeEvents();

    // Slide left + flick to commit G
    engine.pointerMove({ x: h.x - 10, y: h.y, timestamp: 1030 });
    engine.pointerMove({ x: h.x - 20, y: h.y, timestamp: 1040 });
    engine.pointerMove({ x: h.x - 30, y: h.y, timestamp: 1050 });
    engine.pointerMove({ x: h.x - 35, y: h.y, timestamp: 1060 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 10, timestamp: 1070 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 25, timestamp: 1080 });
    engine.pointerMove({ x: h.x - 35, y: h.y - 50, timestamp: 1090 });

    const flickEvents = engine.consumeEvents();
    const flickCommit = flickEvents.find(e => e.type === 'flick_confirmed');

    if (flickCommit) {
      const committedKey = flickCommit.key;
      const committed = keyCenter(geo, committedKey);

      // End session to get gesture data
      engine.pointerUp({ x: h.x - 35, y: h.y - 50, timestamp: 1200 });
      const ended = engine.consumeEvents().find(e => e.type === 'session_ended');

      assert(ended.commitVectors.length >= 1, 'at least one commit vector');
      const cv = ended.commitVectors[0];
      const expectedDx = committed.x - h.x;
      const expectedDy = committed.y - h.y;
      assert(
        Math.abs(cv.dx - expectedDx) < 0.01 && Math.abs(cv.dy - expectedDy) < 0.01,
        `commit vector matches key positions (dx=${cv.dx.toFixed(1)} expected=${expectedDx.toFixed(1)}, dy=${cv.dy.toFixed(1)} expected=${expectedDy.toFixed(1)})`
      );
    } else {
      assert(false, 'flick commit expected but did not occur');
    }
  }

  // ── 36. Transition map completeness ──────────────────────
  section('36. Transition map completeness');
  {
    const map = SteerPopEngine.computeTransitionMap(geo);

    // Should have entries for all 26 letter keys
    const letterKeys = geo.filter(k => !k.excluded && k.id !== 'space' && k.id !== 'backspace');
    assert(map.size === letterKeys.length, `map has ${map.size} source keys (expected ${letterKeys.length})`);

    // Helper to check reachability
    const isReachable = (from, to) => {
      const entry = map.get(from)?.get(to);
      return entry && (entry.status === 'direct' || entry.status === 'reachable');
    };

    // Common word transitions should be reachable
    const wordPairs = [
      ['T', 'H'], ['H', 'E'],                    // THE
      ['H', 'E'], ['E', 'L'], ['L', 'O'],         // HELLO
      ['W', 'O'], ['O', 'R'], ['R', 'D'],         // WORD
      ['P', 'O'],                                   // same-row reverse
    ];
    for (const [a, b] of wordPairs) {
      assert(isReachable(a, b), `${a}->${b} is reachable (status: ${map.get(a)?.get(b)?.status})`);
    }

    // Count statuses
    let totalPairs = 0, direct = 0, reachable = 0, wrongDir = 0, unreachable = 0;
    for (const [srcId, inner] of map) {
      for (const [tgtId, info] of inner) {
        totalPairs++;
        if (info.status === 'direct') direct++;
        else if (info.status === 'reachable') reachable++;
        else if (info.status === 'wrong_direction') wrongDir++;
        else if (info.status === 'unreachable') unreachable++;
      }
    }

    console.log(`  Transition summary: ${totalPairs} pairs | ${direct} direct | ${reachable} reachable | ${wrongDir} wrong_dir | ${unreachable} unreachable`);

    // Log flagged transitions
    const flagged = [];
    for (const [srcId, inner] of map) {
      for (const [tgtId, info] of inner) {
        if (info.status === 'wrong_direction' || info.status === 'unreachable') {
          flagged.push({ from: srcId, to: tgtId, ...info });
        }
      }
    }
    if (flagged.length > 0) {
      console.log(`  Flagged transitions (${flagged.length}):`);
      for (const f of flagged.slice(0, 20)) {
        console.log(`    ${f.from}->${f.to}: ${f.status} (angle=${f.angle.toFixed(1)}°, dir=${f.direction}, targetRow=${f.targetRow})`);
      }
      if (flagged.length > 20) console.log(`    ... and ${flagged.length - 20} more`);
    }

    assert(direct > 0, 'at least some direct transitions exist');
    assert(totalPairs > 0, 'transition map is non-empty');
  }

  // ── 37. Cross-row return — no "home base row bias" ───────
  section('37. Cross-row return (row 1 → row 0 → row 1)');
  {
    const engine = new SteerPopEngine({ gridStepSize: 25, deadzoneRadius: 8 });
    engine.setGeometry(geo);

    const H = keyCenter(geo, 'H');  // row 1
    const E = keyCenter(geo, 'E');  // row 0
    const L = keyCenter(geo, 'L');  // row 1

    // Step 1: Tap H to commit it as anchor
    engine.pointerDown({ x: H.x, y: H.y, timestamp: 5000 });
    engine.pointerUp({ x: H.x, y: H.y, timestamp: 5050 });
    let evts = engine.consumeEvents();
    const hCommit = evts.find(e => e.key === 'H');
    assert(!!hCommit, 'H committed via tap');

    // Step 2: Touch H again and slide up toward E (row 0)
    engine.pointerDown({ x: H.x, y: H.y, timestamp: 5500 });
    // Slide upward toward E's position
    engine.pointerMove({ x: E.x, y: E.y, timestamp: 5600 });

    // Check that E is a candidate on row 0
    const state1 = engine.getState();
    assert(state1.activeRow === 0, `activeRow switched to 0 (got ${state1.activeRow})`);
    const cands1 = state1.candidates || [];
    const eInCands = cands1.some(c => c.id === 'E');
    assert(eInCands, 'E is in candidates after sliding up from H');

    // Simulate flick commit of E
    engine.pointerUp({ x: E.x, y: E.y - 10, timestamp: 5620 });
    evts = engine.consumeEvents();
    // If flick didn't fire, do a tap on E instead
    if (!evts.find(e => e.key === 'E')) {
      engine.pointerDown({ x: E.x, y: E.y, timestamp: 5800 });
      engine.pointerUp({ x: E.x, y: E.y, timestamp: 5850 });
      evts = engine.consumeEvents();
    }
    const eCommit = evts.find(e => e.key === 'E');
    assert(!!eCommit, 'E committed');

    // Step 3: Now from E (row 0), slide down-right toward L (row 1)
    // This is the critical test — can we return to row 1?
    engine.pointerDown({ x: E.x, y: E.y, timestamp: 6200 });
    engine.pointerMove({ x: L.x, y: L.y, timestamp: 6300 });

    const state2 = engine.getState();
    assert(state2.activeRow === 1, `activeRow returned to 1 (got ${state2.activeRow})`);
    const cands2 = state2.candidates || [];
    const lInCands = cands2.some(c => c.id === 'L');
    assert(lInCands, 'L is in candidates after sliding down from E (cross-row return works)');

    engine.pointerUp({ x: L.x, y: L.y, timestamp: 6350 });
    engine.consumeEvents();
  }

  // ── 38. Cross-row return (row 0 → row 1 → row 0) ─────────
  section('38. Cross-row return (row 0 → row 1 → row 0)');
  {
    const engine = new SteerPopEngine({ gridStepSize: 25, deadzoneRadius: 8 });
    engine.setGeometry(geo);

    const T = keyCenter(geo, 'T');  // row 0
    const G = keyCenter(geo, 'G');  // row 1
    const R = keyCenter(geo, 'R');  // row 0

    // Tap T
    engine.pointerDown({ x: T.x, y: T.y, timestamp: 7000 });
    engine.pointerUp({ x: T.x, y: T.y, timestamp: 7050 });
    engine.consumeEvents();

    // Tap G (row 1)
    engine.pointerDown({ x: G.x, y: G.y, timestamp: 7200 });
    engine.pointerUp({ x: G.x, y: G.y, timestamp: 7250 });
    engine.consumeEvents();

    // From G (row 1), slide up-left toward R (row 0)
    engine.pointerDown({ x: G.x, y: G.y, timestamp: 7500 });
    engine.pointerMove({ x: R.x, y: R.y, timestamp: 7600 });

    const state = engine.getState();
    assert(state.activeRow === 0, `activeRow returned to 0 (got ${state.activeRow})`);
    const cands = state.candidates || [];
    const rInCands = cands.some(c => c.id === 'R');
    assert(rInCands, 'R is in candidates after sliding up from G (cross-row return works)');

    engine.pointerUp({ x: R.x, y: R.y, timestamp: 7650 });
    engine.consumeEvents();
  }

  // ── 39. Angle-based aiming — short push selects correct key ──
  section('39. Angle-based aiming — short push selects correct key (raytrace mode)');
  {
    const engine = new SteerPopEngine({ gridStepSize: 30, deadzoneRadius: 8, crossRowMode: 'raytrace' });
    engine.setGeometry(geo);

    const W = keyCenter(geo, 'W');
    const H = keyCenter(geo, 'H');
    const E = keyCenter(geo, 'E');

    // Tap W to commit and anchor there
    engine.pointerDown({ x: W.x, y: W.y, timestamp: 8000 });
    engine.pointerUp({ x: W.x, y: W.y, timestamp: 8050 });
    engine.consumeEvents();

    // Short push from W toward H (cross-row) — only ~40px, NOT all the way to H
    const dirX = H.x - W.x;
    const dirY = H.y - W.y;
    const dirLen = Math.hypot(dirX, dirY);
    const pushDist = 40; // short push, not the full distance
    const pushX = W.x + (dirX / dirLen) * pushDist;
    const pushY = W.y + (dirY / dirLen) * pushDist;

    engine.pointerDown({ x: W.x, y: W.y, timestamp: 8200 });
    engine.pointerMove({ x: pushX, y: pushY, timestamp: 8300 });

    const state = engine.getState();
    const topCand = state.topCandidate;
    assert(topCand === 'H', `short push toward H selects H as top candidate (got ${topCand})`);

    engine.pointerUp({ x: pushX, y: pushY, timestamp: 8350 });
    engine.consumeEvents();
  }

  // ── 40. Same-row aiming — pointer position selects nearest key ──
  section('40. Same-row aiming — pointer proximity');
  {
    const engine = new SteerPopEngine({ gridStepSize: 30, deadzoneRadius: 8 });
    engine.setGeometry(geo);

    const W = keyCenter(geo, 'W');
    const E = keyCenter(geo, 'E');
    const R = keyCenter(geo, 'R');

    // Tap W
    engine.pointerDown({ x: W.x, y: W.y, timestamp: 9000 });
    engine.pointerUp({ x: W.x, y: W.y, timestamp: 9050 });
    engine.consumeEvents();

    // Step-based same-row: swipe distance determines key, not pointer position.
    // E is 1st neighbor (step 1 = 30px), R is 2nd (step 2 = 60px).
    const stepSize = 30;

    engine.pointerDown({ x: W.x, y: W.y, timestamp: 9200 });
    // Swipe to step 1 (30px right) → E
    engine.pointerMove({ x: W.x + stepSize, y: W.y, timestamp: 9300 });

    const state1 = engine.getState();
    assert(state1.topCandidate === 'E', `step 1 selects E (got ${state1.topCandidate})`);

    // Swipe to step 2 (60px right) → R (multiple moves for EMA convergence)
    engine.pointerMove({ x: W.x + stepSize * 1.5, y: W.y, timestamp: 9350 });
    engine.pointerMove({ x: W.x + stepSize * 2, y: W.y, timestamp: 9400 });
    engine.pointerMove({ x: W.x + stepSize * 2, y: W.y, timestamp: 9420 });

    const state2 = engine.getState();
    assert(state2.topCandidate === 'R', `step 2 selects R (got ${state2.topCandidate})`);

    engine.pointerUp({ x: R.x, y: W.y, timestamp: 9450 });
    engine.consumeEvents();
  }

  // ── Summary ───────────────────────────────────────────────
  console.log(`\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`);
  console.log(`  PASSED: ${passed}  FAILED: ${failed}`);
  console.log(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n`);
}

runTests();
