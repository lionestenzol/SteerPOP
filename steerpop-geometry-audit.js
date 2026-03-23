/**
 * SteerPop Geometry Audit
 * Computes and reports all key positions, pairwise distances/angles,
 * reachability status, and flags anomalies across geometry variants.
 *
 * Run: node steerpop-geometry-audit.js
 */

import { SteerPopEngine } from './steerpop-engine.js';

// ─────────────────────────────────────────────────────────────
// GEOMETRY BUILDERS
// ─────────────────────────────────────────────────────────────

function buildTestGeometry() {
  const KEY_W = 50, GAP = 5;
  const ROWS = [
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['Z','X','C','V','B','N','M'],
  ];
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
  return { name: 'Test (50px keys, 5px gap, 15px stagger)', keys };
}

function buildDevModeGeometry() {
  const KEY_W = 52, GAP = 4, PAD = 20;
  const ROWS = ['QWERTYUIOP'.split(''), 'ASDFGHJKL'.split(''), 'ZXCVBNM'.split('')];
  const ROW_OFFSETS = [0, 0.5 * (KEY_W + GAP), 1.5 * (KEY_W + GAP)];
  const keys = [];
  for (let r = 0; r < ROWS.length; r++) {
    for (let c = 0; c < ROWS[r].length; c++) {
      const x = PAD + ROW_OFFSETS[r] + c * (KEY_W + GAP) + KEY_W / 2;
      const y = PAD + r * (KEY_W + GAP) + KEY_W / 2;
      keys.push({
        id: ROWS[r][c], label: ROWS[r][c], row: r, col: c,
        centerX: x, centerY: y, width: KEY_W, height: KEY_W, excluded: false,
      });
    }
  }
  return { name: 'Dev Mode (52px keys, 4px gap, half-key stagger)', keys };
}

function buildAdapterGeometry() {
  // Approximate the web-adapter geometry (CSS flex layout, ~57px keys)
  const KEY_W = 57, GAP = 4;
  const ROWS = [
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['Z','X','C','V','B','N','M'],
  ];
  const EXCLUDED = new Set(['.', ',', "'", '⌫', 'SPACE']);
  const keys = [];
  ROWS.forEach((row, ri) => {
    const totalW = row.length * KEY_W + (row.length - 1) * GAP;
    const startX = (400 - totalW) / 2; // centered in ~400px viewport
    row.forEach((label, ci) => {
      keys.push({
        id: label, label, row: ri, col: ci,
        centerX: startX + ci * (KEY_W + GAP) + KEY_W / 2,
        centerY: ri * (KEY_W + GAP) + KEY_W / 2,
        width: KEY_W, height: KEY_W,
        excluded: EXCLUDED.has(label),
      });
    });
  });
  return { name: 'Adapter (57px keys, 4px gap, centered)', keys };
}

// ─────────────────────────────────────────────────────────────
// AUDIT
// ─────────────────────────────────────────────────────────────

function auditGeometry(geo) {
  const { name, keys } = geo;
  const nonExcluded = keys.filter(k => !k.excluded);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  GEOMETRY: ${name}`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`  Keys: ${keys.length} total, ${nonExcluded.length} active, ${keys.length - nonExcluded.length} excluded`);

  // ── Key positions ──────────────────────────────────
  console.log('\n── Key Positions ──');
  const byRow = new Map();
  for (const k of nonExcluded) {
    if (!byRow.has(k.row)) byRow.set(k.row, []);
    byRow.get(k.row).push(k);
  }
  for (const [row, rowKeys] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    rowKeys.sort((a, b) => a.centerX - b.centerX);
    const positions = rowKeys.map(k => `${k.id}(${k.centerX.toFixed(0)},${k.centerY.toFixed(0)})`).join('  ');
    console.log(`  Row ${row}: ${positions}`);
  }

  // ── Row metrics ────────────────────────────────────
  console.log('\n── Row Metrics ──');
  const rowCenters = [];
  for (const [row, rowKeys] of byRow) {
    const avgY = rowKeys.reduce((s, k) => s + k.centerY, 0) / rowKeys.length;
    const spacings = [];
    const sorted = rowKeys.slice().sort((a, b) => a.centerX - b.centerX);
    for (let i = 1; i < sorted.length; i++) {
      spacings.push(sorted[i].centerX - sorted[i - 1].centerX);
    }
    const avgSpacing = spacings.length > 0 ? spacings.reduce((a, b) => a + b) / spacings.length : 0;
    const minSpacing = spacings.length > 0 ? Math.min(...spacings) : 0;
    const maxSpacing = spacings.length > 0 ? Math.max(...spacings) : 0;
    rowCenters.push({ row, y: avgY });
    console.log(`  Row ${row}: ${rowKeys.length} keys, avgY=${avgY.toFixed(1)}, keySpacing=${avgSpacing.toFixed(1)} (min=${minSpacing.toFixed(1)}, max=${maxSpacing.toFixed(1)})`);
  }
  rowCenters.sort((a, b) => a.row - b.row);
  for (let i = 1; i < rowCenters.length; i++) {
    const gap = rowCenters[i].y - rowCenters[i - 1].y;
    console.log(`  Row ${rowCenters[i - 1].row}→${rowCenters[i].row} vertical gap: ${gap.toFixed(1)}px`);
  }

  // ── Transition map ─────────────────────────────────
  const map = SteerPopEngine.computeTransitionMap(keys);
  let direct = 0, wrongDir = 0, unreachable = 0;
  const issues = [];
  const distStats = { min: Infinity, max: 0, total: 0, count: 0 };
  const sameRowDists = [];
  const crossRowDists = [];

  for (const [srcId, inner] of map) {
    const srcKey = nonExcluded.find(k => k.id === srcId);
    for (const [tgtId, info] of inner) {
      const tgtKey = nonExcluded.find(k => k.id === tgtId);

      if (info.status === 'direct') direct++;
      else if (info.status === 'wrong_direction') wrongDir++;
      else unreachable++;

      distStats.min = Math.min(distStats.min, info.distance);
      distStats.max = Math.max(distStats.max, info.distance);
      distStats.total += info.distance;
      distStats.count++;

      if (srcKey && tgtKey) {
        if (srcKey.row === tgtKey.row) sameRowDists.push(info.distance);
        else crossRowDists.push(info.distance);
      }

      // Flag issues
      if (info.status !== 'direct') {
        // Check if adjacent keys are unreachable
        if (srcKey && tgtKey && srcKey.row === tgtKey.row) {
          const colDist = Math.abs(srcKey.col - tgtKey.col);
          if (colDist === 1) {
            issues.push(`⚠ Adjacent same-row ${srcId}→${tgtId} is ${info.status} (dir=${info.direction}, targetRow=${info.targetRow})`);
          }
        }
        // Check if row neighbors are unreachable
        if (srcKey && tgtKey && Math.abs(srcKey.row - tgtKey.row) === 1) {
          const xDist = Math.abs(srcKey.centerX - tgtKey.centerX);
          if (xDist < 60) {
            issues.push(`⚠ Close cross-row ${srcId}→${tgtId} is ${info.status} (dist=${info.distance.toFixed(0)}, dir=${info.direction})`);
          }
        }
      }
    }
  }

  console.log('\n── Transition Map Summary ──');
  console.log(`  Total pairs: ${direct + wrongDir + unreachable}`);
  console.log(`  Direct: ${direct} (${(direct / (direct + wrongDir + unreachable) * 100).toFixed(1)}%)`);
  console.log(`  Wrong direction: ${wrongDir}`);
  console.log(`  Unreachable: ${unreachable}`);

  console.log('\n── Distance Stats ──');
  console.log(`  Min: ${distStats.min.toFixed(1)}px`);
  console.log(`  Max: ${distStats.max.toFixed(1)}px`);
  console.log(`  Avg: ${(distStats.total / distStats.count).toFixed(1)}px`);
  if (sameRowDists.length > 0) {
    const avgSame = sameRowDists.reduce((a, b) => a + b) / sameRowDists.length;
    console.log(`  Same-row avg: ${avgSame.toFixed(1)}px (${sameRowDists.length} pairs)`);
  }
  if (crossRowDists.length > 0) {
    const avgCross = crossRowDists.reduce((a, b) => a + b) / crossRowDists.length;
    console.log(`  Cross-row avg: ${avgCross.toFixed(1)}px (${crossRowDists.length} pairs)`);
  }

  // ── Per-key reachability ───────────────────────────
  console.log('\n── Per-Key Reachability ──');
  for (const k of nonExcluded) {
    const inner = map.get(k.id);
    if (!inner) continue;
    let d = 0, wd = 0, ur = 0;
    for (const [, info] of inner) {
      if (info.status === 'direct') d++;
      else if (info.status === 'wrong_direction') wd++;
      else ur++;
    }
    const total = d + wd + ur;
    const pct = (d / total * 100).toFixed(0);
    const flag = d < total * 0.8 ? ' ⚠ LOW' : '';
    console.log(`  ${k.id}: ${d}/${total} direct (${pct}%)${flag}`);
  }

  // ── Issues ─────────────────────────────────────────
  if (issues.length > 0) {
    console.log('\n── Issues Found ──');
    for (const issue of issues) {
      console.log(`  ${issue}`);
    }
  } else {
    console.log('\n  ✓ No adjacency/reachability issues found');
  }

  // ── Cross-row angle analysis ───────────────────────
  console.log('\n── Cross-Row Angle Ranges ──');
  for (const srcRow of [0, 1, 2]) {
    for (const tgtRow of [0, 1, 2]) {
      if (srcRow === tgtRow) continue;
      const angles = [];
      for (const src of (byRow.get(srcRow) || [])) {
        const inner = map.get(src.id);
        if (!inner) continue;
        for (const tgt of (byRow.get(tgtRow) || [])) {
          const info = inner.get(tgt.id);
          if (info) angles.push(info.angle);
        }
      }
      if (angles.length === 0) continue;
      const min = Math.min(...angles).toFixed(1);
      const max = Math.max(...angles).toFixed(1);
      console.log(`  Row ${srcRow}→${tgtRow}: ${min}° to ${max}° (${angles.length} pairs)`);
    }
  }

  return { direct, wrongDir, unreachable, issues };
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║           STEERPOP GEOMETRY AUDIT — ALL LAYOUTS                     ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');

const geometries = [
  buildTestGeometry(),
  buildDevModeGeometry(),
  buildAdapterGeometry(),
];

const results = [];
for (const geo of geometries) {
  results.push(auditGeometry(geo));
}

console.log(`\n${'═'.repeat(70)}`);
console.log('  CROSS-GEOMETRY COMPARISON');
console.log(`${'═'.repeat(70)}`);

for (let i = 0; i < geometries.length; i++) {
  const { name } = geometries[i];
  const r = results[i];
  const total = r.direct + r.wrongDir + r.unreachable;
  console.log(`  ${name}`);
  console.log(`    Direct: ${r.direct}/${total} (${(r.direct / total * 100).toFixed(1)}%)  Wrong-dir: ${r.wrongDir}  Unreachable: ${r.unreachable}  Issues: ${r.issues.length}`);
}

console.log('\n  Done.\n');
