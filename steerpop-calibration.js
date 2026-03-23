/**
 * SteerPop Calibration Harness
 * Tests engine accuracy under noise, speed variation, and parameter sweeps.
 * Run: node steerpop-calibration.js
 */

import { SteerPopEngine } from './steerpop-engine.js';

// ─────────────────────────────────────────────────────────────
// GEOMETRY
// ─────────────────────────────────────────────────────────────

const KEY_W = 50, GAP = 5;
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
  if (!k) return null;
  return { x: k.centerX, y: k.centerY };
}

// ─────────────────────────────────────────────────────────────
// SEEDED RANDOM
// ─────────────────────────────────────────────────────────────

function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

// ─────────────────────────────────────────────────────────────
// CORPUS
// ─────────────────────────────────────────────────────────────

const CORPUS = {
  tier1: ['the','be','to','of','and','in','that','have','it','for','not','on','with','he','as','you','do','at'],
  tier2: ['this','but','his','by','from','they','we','say','her','she','or','an','will','my','one','all','would','there','their','what'],
  tier3: ['about','which','when','make','can','like','time','just','know','take','people','into','year','your','good','some','could','them','see','other'],
  edge: ['back','catch','bridge','quick','then','them','from','form','your'],
};

const ALL_WORDS = [...CORPUS.tier1, ...CORPUS.tier2, ...CORPUS.tier3, ...CORPUS.edge];
const AMBIGUOUS_PAIRS = [['then','them'],['from','form'],['your','you']];

// ─────────────────────────────────────────────────────────────
// NOISE PROFILES
// ─────────────────────────────────────────────────────────────

const NOISE_PROFILES = {
  clean:    { jitter: 1.5, offsetPx: 0,  speedScale: 1.0 },
  light:    { jitter: 4,   offsetPx: 3,  speedScale: 1.0 },
  moderate: { jitter: 8,   offsetPx: 6,  speedScale: 1.2 },
  heavy:    { jitter: 12,  offsetPx: 10, speedScale: 0.7 },
  fast:     { jitter: 3,   offsetPx: 2,  speedScale: 2.0 },
  slow:     { jitter: 2,   offsetPx: 1,  speedScale: 0.5 },
};

// ─────────────────────────────────────────────────────────────
// TRACE GENERATOR (with noise support)
// ─────────────────────────────────────────────────────────────

function generateTrace(geo, word, noise = {}, seed = 42) {
  const { jitter = 1.5, offsetPx = 0, speedScale = 1.0 } = noise;
  const flickStrength = 35;
  const slideSteps = 6;
  const rand = seededRandom(seed);

  const letters = word.toUpperCase().split('').filter(ch => geo.find(k => k.id === ch));
  if (letters.length === 0) return null;

  // Constant offset bias for this word (simulates mis-calibrated touch)
  const offsetAngle = rand() * Math.PI * 2;
  const ox = Math.cos(offsetAngle) * offsetPx;
  const oy = Math.sin(offsetAngle) * offsetPx;

  const keys = letters.map(ch => {
    const pos = keyCenter(geo, ch);
    return { id: ch, x: pos.x + ox, y: pos.y + oy };
  });

  const events = [];
  let t = 0;
  const dt = (ms) => Math.max(1, Math.round(ms / speedScale));

  // Tap first letter (use un-offset position for tap accuracy)
  const firstReal = keyCenter(geo, letters[0]);
  events.push({ type: 'pointerDown', x: firstReal.x + ox, y: firstReal.y + oy, timestamp: t });
  t += dt(50);

  for (let i = 1; i < keys.length; i++) {
    const from = keys[i - 1];
    const to = keys[i];
    const isRepeat = letters[i] === letters[i - 1];

    if (isRepeat) {
      for (let d = 0; d < 5; d++) {
        events.push({ type: 'pointerMove', x: from.x, y: from.y, timestamp: t }); t += dt(16);
      }
      events.push({ type: 'pointerMove', x: from.x, y: from.y + flickStrength * 0.23, timestamp: t }); t += dt(10);
      events.push({ type: 'pointerMove', x: from.x, y: from.y + flickStrength * 0.57, timestamp: t }); t += dt(10);
      events.push({ type: 'pointerMove', x: from.x, y: from.y + flickStrength, timestamp: t }); t += dt(10);
      t += dt(400);
      continue;
    }

    for (let s = 1; s <= slideSteps; s++) {
      const frac = s / slideSteps;
      events.push({
        type: 'pointerMove',
        x: from.x + (to.x - from.x) * frac + (rand() - 0.5) * jitter * 2,
        y: from.y + (to.y - from.y) * frac + (rand() - 0.5) * jitter * 2,
        timestamp: t,
      });
      t += dt(16);
    }
    // Dwell
    for (let d = 0; d < 4; d++) {
      events.push({ type: 'pointerMove', x: to.x, y: to.y, timestamp: t }); t += dt(25);
    }
    // Flick up
    events.push({ type: 'pointerMove', x: to.x, y: to.y - flickStrength * 0.23, timestamp: t }); t += dt(10);
    events.push({ type: 'pointerMove', x: to.x, y: to.y - flickStrength * 0.57, timestamp: t }); t += dt(10);
    events.push({ type: 'pointerMove', x: to.x, y: to.y - flickStrength, timestamp: t }); t += dt(10);
    t += dt(400);
  }

  const last = events[events.length - 1];
  events.push({ type: 'pointerUp', x: last.x, y: last.y, timestamp: t });
  return { events, geometry: geo };
}

// ─────────────────────────────────────────────────────────────
// METRICS
// ─────────────────────────────────────────────────────────────

function letterAccuracy(expected, got) {
  // Longest common subsequence ratio
  const m = expected.length, n = got.length;
  if (m === 0) return n === 0 ? 1 : 0;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = expected[i - 1] === got[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n] / m;
}

function testWord(geo, word, config, noise, seed = 42) {
  const letters = word.toUpperCase().split('').filter(ch => geo.find(k => k.id === ch));
  if (letters.length <= 1) return { word, expected: letters.join(''), got: letters.join(''), correct: true, letterAccuracy: 1, totalSwitches: 0, lateSwitches: 0, avgConfidence: 1, minConfidence: 1, commitCount: letters.length };

  const trace = generateTrace(geo, word, noise, seed);
  if (!trace) return null;

  const engine = new SteerPopEngine(config);
  engine.setGeometry(geo);
  const events = engine.replayTrace(trace);

  const committed = events.filter(e => e.type === 'letter_committed').map(e => e.label).join('');
  const expected = letters.join('');
  const switches = events.filter(e => e.type === 'target_changed').length;

  return {
    word,
    expected,
    got: committed,
    correct: committed === expected,
    letterAccuracy: letterAccuracy(expected, committed),
    totalSwitches: switches,
    commitCount: events.filter(e => e.type === 'letter_committed').length,
  };
}

// ─────────────────────────────────────────────────────────────
// RUNNERS
// ─────────────────────────────────────────────────────────────

function runCorpus(geo, words, config, noise, seedBase = 42) {
  return words.map((w, i) => testWord(geo, w, config, noise, seedBase + i));
}

function summarize(results) {
  const correct = results.filter(r => r && r.correct).length;
  const total = results.length;
  const avgLetter = results.reduce((s, r) => s + (r ? r.letterAccuracy : 0), 0) / total;
  const avgSwitches = results.reduce((s, r) => s + (r ? r.totalSwitches : 0), 0) / total;
  return { correct, total, pct: (correct / total * 100).toFixed(1), avgLetter: avgLetter.toFixed(3), avgSwitches: avgSwitches.toFixed(1) };
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

function main() {
  const geo = buildGeometry();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           STEERPOP CALIBRATION REPORT                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // ── 1. Noise tolerance ─────────────────────────────
  console.log('\n── Noise Tolerance (default config) ──');
  console.log(`  ${'Profile'.padEnd(12)} ${'Accuracy'.padEnd(14)} ${'Letter'.padEnd(10)} ${'Switches'.padEnd(10)}`);
  console.log(`  ${'─'.repeat(46)}`);

  const noiseResults = {};
  for (const [name, profile] of Object.entries(NOISE_PROFILES)) {
    const results = runCorpus(geo, ALL_WORDS, {}, profile);
    const s = summarize(results);
    noiseResults[name] = { results, summary: s };
    const tag = name === 'clean' && s.correct < s.total ? ' ⚠' : '';
    console.log(`  ${name.padEnd(12)} ${(s.correct + '/' + s.total + ' (' + s.pct + '%)').padEnd(14)} ${('LCS ' + s.avgLetter).padEnd(10)} ${('avg ' + s.avgSwitches).padEnd(10)}${tag}`);
  }

  // ── 2. Worst words under noise ─────────────────────
  console.log('\n── Worst Words (first failure by noise level) ──');
  const degradation = [];
  for (const word of ALL_WORDS) {
    let firstFail = null;
    for (const name of ['clean', 'light', 'moderate', 'heavy']) {
      const r = noiseResults[name].results.find(r => r.word === word);
      if (r && !r.correct) { firstFail = name; break; }
    }
    if (firstFail) degradation.push({ word, failsAt: firstFail });
  }
  degradation.sort((a, b) => {
    const order = { clean: 0, light: 1, moderate: 2, heavy: 3 };
    return order[a.failsAt] - order[b.failsAt];
  });
  if (degradation.length === 0) {
    console.log('  ✓ All words survive through heavy noise');
  } else {
    for (const d of degradation.slice(0, 15)) {
      const r = noiseResults[d.failsAt].results.find(r => r.word === d.word);
      console.log(`  ${d.word.padEnd(10)} fails at ${d.failsAt.padEnd(10)} got "${r.got}" (expected "${r.expected}")`);
    }
    if (degradation.length > 15) console.log(`  ... and ${degradation.length - 15} more`);
  }

  // ── 3. Ambiguous pairs ─────────────────────────────
  console.log('\n── Ambiguous Pairs (clean + moderate) ──');
  for (const [w1, w2] of AMBIGUOUS_PAIRS) {
    const r1c = testWord(geo, w1, {}, NOISE_PROFILES.clean);
    const r2c = testWord(geo, w2, {}, NOISE_PROFILES.clean);
    const r1m = testWord(geo, w1, {}, NOISE_PROFILES.moderate, 99);
    const r2m = testWord(geo, w2, {}, NOISE_PROFILES.moderate, 99);
    const icon1c = r1c.correct ? '✓' : '✗';
    const icon2c = r2c.correct ? '✓' : '✗';
    const icon1m = r1m.correct ? '✓' : '✗';
    const icon2m = r2m.correct ? '✓' : '✗';
    console.log(`  ${w1}/${w2}:  clean ${icon1c}/${icon2c}  moderate ${icon1m}/${icon2m}`);
  }

  // ── 4. Parameter sweep ─────────────────────────────
  console.log('\n── Parameter Sweep (one-at-a-time) ──');

  const SWEEP = {
    hysteresis:     [0.15, 0.2, 0.25, 0.3, 0.4],
    smoothingAlpha: [0.4, 0.5, 0.6, 0.7, 0.8],
    momentumWeight: [0, 0.1, 0.15, 0.2, 0.3],
    hotRadius:      [0.15, 0.2, 0.3, 0.4],
    lingerMs:       [0, 40, 80, 120],
  };

  const defaults = {
    hysteresis: 0.3, smoothingAlpha: 0.6, momentumWeight: 0.15, hotRadius: 0.3, lingerMs: 80,
  };

  for (const [param, values] of Object.entries(SWEEP)) {
    console.log(`\n  ${param}:`);
    let bestVal = null, bestScore = -1;

    for (const val of values) {
      const config = { ...defaults, [param]: val };
      const cleanR = runCorpus(geo, ALL_WORDS, config, NOISE_PROFILES.clean);
      const modR = runCorpus(geo, ALL_WORDS, config, NOISE_PROFILES.moderate, 100);
      const cs = summarize(cleanR);
      const ms = summarize(modR);
      // Combined score: 60% clean accuracy + 40% moderate accuracy
      const score = parseFloat(cs.pct) * 0.6 + parseFloat(ms.pct) * 0.4;
      const current = val === defaults[param] ? ' ← current' : '';
      const best = score > bestScore;
      if (best) { bestScore = score; bestVal = val; }
      console.log(`    ${String(val).padEnd(6)} clean=${cs.pct.padEnd(7)}% mod=${ms.pct.padEnd(7)}% combined=${score.toFixed(1)}${current}`);
    }
    console.log(`    → best: ${bestVal}${bestVal === defaults[param] ? ' (current default)' : ' ⚡ IMPROVEMENT'}`);
  }

  // ── 5. Tier breakdown ──────────────────────────────
  console.log('\n── Tier Breakdown (moderate noise) ──');
  for (const [tier, words] of Object.entries(CORPUS)) {
    const results = runCorpus(geo, words, {}, NOISE_PROFILES.moderate, 200);
    const s = summarize(results);
    console.log(`  ${tier.padEnd(8)} ${s.correct}/${s.total} (${s.pct}%)`);
  }

  console.log('\n' + '═'.repeat(62));
  console.log('  Done.');
  console.log('═'.repeat(62) + '\n');
}

main();
