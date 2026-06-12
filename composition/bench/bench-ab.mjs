#!/usr/bin/env node
// Paired A/B benchmark: interleaves subprocess runs of bench.mjs against two
// dist builds so both sides see identical machine conditions. Robust to
// external load: reports per-pair deltas and the median of pair ratios.
//
// Usage:
//   node composition/bench/bench-ab.mjs <distA> <distB> [pairs]
// e.g.
//   node composition/bench/bench-ab.mjs /tmp/dist-baseline composition/dist 5

import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH = join(__dirname, 'bench.mjs');

const [, , distAArg, distBArg, pairsArg] = process.argv;
if (!distAArg || !distBArg) {
  console.error('usage: bench-ab.mjs <distA> <distB> [pairs]');
  process.exit(1);
}
const distA = resolve(distAArg);
const distB = resolve(distBArg);
const PAIRS = Number(pairsArg ?? 5);

function runOnce(dist) {
  const out = execFileSync(process.execPath, ['--expose-gc', BENCH], {
    env: {
      ...process.env,
      BENCH_DIST: dist,
      BENCH_WARMUP: process.env.BENCH_WARMUP ?? '2',
      BENCH_ITERATIONS: process.env.BENCH_ITERATIONS ?? '3',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const get = (k) => Number(out.match(new RegExp(`${k}=([\\d.]+)`))?.[1]);
  return {
    total: get('TOTAL_MEDIAN_MS'),
    parse: get('PARSE_MEDIAN_MS'),
    federate: get('FEDERATE_MEDIAN_MS'),
    emit: get('EMIT_MEDIAN_MS'),
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const as = [];
const bs = [];
for (let i = 0; i < PAIRS; i++) {
  // alternate order within pairs to cancel drift: A,B then B,A
  if (i % 2 === 0) {
    as.push(runOnce(distA));
    bs.push(runOnce(distB));
  } else {
    bs.push(runOnce(distB));
    as.push(runOnce(distA));
  }
  const a = as[as.length - 1];
  const b = bs[bs.length - 1];
  console.error(
    `pair ${i}: A total=${a.total.toFixed(1)} federate=${a.federate.toFixed(1)} | B total=${b.total.toFixed(1)} federate=${b.federate.toFixed(1)} | ratio total=${(b.total / a.total).toFixed(3)} federate=${(b.federate / a.federate).toFixed(3)}`,
  );
}

const ratioTotals = as.map((a, i) => bs[i].total / a.total);
const ratioFed = as.map((a, i) => bs[i].federate / a.federate);
const mA = { total: median(as.map((x) => x.total)), federate: median(as.map((x) => x.federate)), emit: median(as.map((x) => x.emit)), parse: median(as.map((x) => x.parse)) };
const mB = { total: median(bs.map((x) => x.total)), federate: median(bs.map((x) => x.federate)), emit: median(bs.map((x) => x.emit)), parse: median(bs.map((x) => x.parse)) };

console.error(`\nA (${distAArg}): total=${mA.total.toFixed(1)}ms parse=${mA.parse.toFixed(1)} federate=${mA.federate.toFixed(1)} emit=${mA.emit.toFixed(1)}`);
console.error(`B (${distBArg}): total=${mB.total.toFixed(1)}ms parse=${mB.parse.toFixed(1)} federate=${mB.federate.toFixed(1)} emit=${mB.emit.toFixed(1)}`);
console.log(`AB_MEDIAN_RATIO_TOTAL=${median(ratioTotals).toFixed(4)}`);
console.log(`AB_MEDIAN_RATIO_FEDERATE=${median(ratioFed).toFixed(4)}`);
console.log(`A_TOTAL_MS=${mA.total.toFixed(1)}`);
console.log(`B_TOTAL_MS=${mB.total.toFixed(1)}`);
console.log(`A_FEDERATE_MS=${mA.federate.toFixed(1)}`);
console.log(`B_FEDERATE_MS=${mB.federate.toFixed(1)}`);
