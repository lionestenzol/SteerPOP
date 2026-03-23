/**
 * SteerPop Typing Simulation Tests
 * Generates realistic pointer traces for words and verifies committed output.
 *
 * @module steerpop-typing-test
 */

import { SteerPopEngine } from './steerpop-engine.js';

// ─────────────────────────────────────────────────────────────
// TEST GEOMETRY (mirrors steerpop-test.js)
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
  if (!k) throw new Error(`Key "${id}" not found in geometry`);
  return { x: k.centerX, y: k.centerY };
}

// ─────────────────────────────────────────────────────────────
// SEEDED RANDOM (for deterministic jitter)
// ─────────────────────────────────────────────────────────────

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ─────────────────────────────────────────────────────────────
// TRACE GENERATOR
// ─────────────────────────────────────────────────────────────

/**
 * Generate a realistic pointer trace for typing a word.
 *
 * For each letter after the first:
 *   1. Slide from current anchor toward target key (6 intermediate moves)
 *   2. Dwell near target (2 frames for confidence)
 *   3. Flick up (3 rapid upward moves)
 *   4. Wait for cooldown
 *
 * @param {Array} geo - Key geometry array
 * @param {string} word - Word to type (letters only)
 * @param {object} opts - { seed, jitter, slideSteps, flickStrength }
 * @returns {{ events: Array, geometry: Array }}
 */
function generateWordTrace(geo, word, opts = {}) {
  const {
    seed = 42,
    jitter = 1.5,       // px of random jitter on slide moves
    slideSteps = 6,     // intermediate moves per letter transition
    flickStrength = 35,  // px of upward flick displacement
    gridStep = 30,       // px per step for same-row navigation
  } = opts;
  const GRID_STEP = gridStep;

  const rand = seededRandom(seed);
  const events = [];
  let t = 0;

  const letters = word.toUpperCase().split('');
  const keys = letters.map(ch => {
    const pos = keyCenter(geo, ch);
    return { id: ch, x: pos.x, y: pos.y };
  });

  // Tap first letter (Layer 0 commit)
  events.push({ type: 'pointerDown', x: keys[0].x, y: keys[0].y, timestamp: t });
  t += 50;

  // For each subsequent letter: slide → dwell → flick (or flick-down for repeats)
  for (let i = 1; i < keys.length; i++) {
    const from = keys[i - 1];
    const to = keys[i];
    const isRepeat = from.id === to.id;

    if (isRepeat) {
      // Repeated letter: flick DOWN from anchor position
      // Need idle moves first to fill velocity buffer (flick check requires 5 samples)
      for (let d = 0; d < 5; d++) {
        events.push({ type: 'pointerMove', x: from.x, y: from.y, timestamp: t }); t += 16;
      }
      // Flick down: 3 rapid downward moves
      events.push({ type: 'pointerMove', x: from.x, y: from.y + flickStrength * 0.23, timestamp: t }); t += 10;
      events.push({ type: 'pointerMove', x: from.x, y: from.y + flickStrength * 0.57, timestamp: t }); t += 10;
      events.push({ type: 'pointerMove', x: from.x, y: from.y + flickStrength, timestamp: t }); t += 10;
      t += 400; // cooldown
      continue;
    }

    // Look up row info for cross-row handling
    const fromKey = geo.find(k => k.id === from.id);
    const toKey = geo.find(k => k.id === to.id);
    const crossRow = fromKey.row !== toKey.row;

    // Compute slide target position
    let targetX, targetY;
    if (crossRow) {
      // Cross-row: slide toward the actual key position (ray projection handles aiming)
      targetX = to.x;
      targetY = to.y;
    } else {
      // Same-row: step-based — swipe distance = step index × gridStepSize
      // Find the target's sequential index from anchor
      const rowKeys = geo.filter(k => k.row === fromKey.row && !k.excluded);
      const dir = to.x > from.x ? 1 : -1;
      const sorted = dir > 0
        ? rowKeys.filter(k => k.centerX > fromKey.centerX).sort((a, b) => a.centerX - b.centerX)
        : rowKeys.filter(k => k.centerX < fromKey.centerX).sort((a, b) => b.centerX - a.centerX);
      const stepIndex = sorted.findIndex(k => k.id === to.id);
      const stepDist = (stepIndex + 1) * GRID_STEP; // +1 because index 0 = 1st neighbor
      targetX = from.x + dir * stepDist;
      targetY = from.y; // same row, no vertical movement
    }

    // Slide toward target in steps
    for (let s = 1; s <= slideSteps; s++) {
      const frac = s / slideSteps;
      let mx = from.x + (targetX - from.x) * frac + (rand() - 0.5) * jitter * 2;
      let my = from.y + (targetY - from.y) * frac + (rand() - 0.5) * jitter * 2;

      events.push({ type: 'pointerMove', x: mx, y: my, timestamp: t });
      t += 16;
    }

    // Dwell near target — extra frames for EMA convergence + confidence build
    for (let d = 0; d < 4; d++) {
      events.push({ type: 'pointerMove', x: targetX, y: targetY, timestamp: t }); t += 25;
    }

    // Flick up: 3 rapid upward moves
    const fy = targetY;
    events.push({ type: 'pointerMove', x: targetX, y: fy - flickStrength * 0.23, timestamp: t }); t += 10;
    events.push({ type: 'pointerMove', x: targetX, y: fy - flickStrength * 0.57, timestamp: t }); t += 10;
    events.push({ type: 'pointerMove', x: targetX, y: fy - flickStrength, timestamp: t }); t += 10;

    // Cooldown wait
    t += 400;
  }

  // End session
  const last = events[events.length - 1];
  events.push({ type: 'pointerUp', x: last.x, y: last.y, timestamp: t });

  return { events, geometry: geo };
}

// ─────────────────────────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────────────────────────

function testWord(geo, word, opts = {}) {
  const trace = generateWordTrace(geo, word, opts);
  const engine = new SteerPopEngine();
  engine.setGeometry(geo);
  const events = engine.replayTrace(trace);

  const committed = events
    .filter(e => e.type === 'letter_committed')
    .map(e => e.label)
    .join('');

  const expected = word.toUpperCase();
  return { word, expected, got: committed, pass: committed === expected };
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

function run() {
  const geo = buildGeometry();
  let passed = 0, failed = 0;

  const TEST_WORDS = [
    // Same-row (row 0)
    'we', 'rip', 'tire', 'power',
    // Same-row (row 1)
    'ash', 'lad', 'flask',
    // Cross-row
    'the', 'hello', 'world', 'type',
    // Long words
    'strong', 'planet',
    // Edge keys
    'quiz', 'pop',
    // Repeated letters (first letter repeats handled by tap, others need re-approach)
    'all', 'see',
  ];

  console.log('═══════════════════════════════════════');
  console.log('  SteerPOP Typing Simulation Tests');
  console.log('═══════════════════════════════════════\n');

  for (const word of TEST_WORDS) {
    const result = testWord(geo, word);
    const icon = result.pass ? '✓' : '✗';
    const status = result.pass ? '' : ` (got "${result.got}")`;
    console.log(`  ${icon} "${word}" → ${result.expected}${status}`);
    if (result.pass) passed++; else failed++;
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`  PASSED: ${passed}  FAILED: ${failed}`);
  console.log(`═══════════════════════════════════════\n`);

  // Determinism check: same seed = same output
  console.log('── Determinism check ──');
  const r1 = testWord(geo, 'hello', { seed: 99 });
  const r2 = testWord(geo, 'hello', { seed: 99 });
  const detMatch = r1.got === r2.got;
  console.log(`  ${detMatch ? '✓' : '✗'} same seed produces identical output ("${r1.got}" = "${r2.got}")`);
  if (detMatch) passed++; else failed++;

  // Different seeds should still produce correct output
  const r3 = testWord(geo, 'hello', { seed: 1234 });
  console.log(`  ${r3.pass ? '✓' : '✗'} different seed still correct ("${r3.got}")`);
  if (r3.pass) passed++; else failed++;

  console.log(`\n════════════════════════════════════════`);
  console.log(`  TOTAL: PASSED: ${passed}  FAILED: ${failed}`);
  console.log(`════════════════════════════════════════\n`);
}

run();
