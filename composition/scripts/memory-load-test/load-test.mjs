/**
 * Memory load test: runs a composition scenario many times back to back and reports heap growth.
 *
 *   pnpm build
 *   node --expose-gc scripts/memory-load-test/load-test.mjs <scenario> [iterations=300] [snapshotDir]
 *
 * - With --expose-gc, a full GC runs before every measurement, so a steadily growing "heapUsed" is a leak
 *   (memory that survives GC), whereas a flat value means every composition is fully collectable.
 * - Set NOGC=1 to skip the forced GC and report the peak heap instead (what a process without GC pressure uses).
 * - If snapshotDir is given, a heap snapshot is written after the warm-up and after the last iteration;
 *   compare them with heap-snapshot-diff.mjs and heap-retainers.mjs.
 * - COMPOSITION_DIST=/path/to/other/dist/index.js runs the scenarios against a different build for A/B comparisons.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import v8 from 'node:v8';
import { getScenario, scenarios } from './scenarios.mjs';

const [, , scenarioName, iterationsArg = '300', snapshotDir] = process.argv;
if (!scenarioName) {
  console.error(
    `usage: node --expose-gc load-test.mjs <${Object.keys(scenarios).join('|')}> [iterations] [snapshotDir]`,
  );
  process.exit(1);
}
const scenario = getScenario(scenarioName);
const iterations = Number(iterationsArg);
const forceGc = !process.env.NOGC;
if (forceGc && typeof global.gc !== 'function') {
  console.error('run with node --expose-gc (or set NOGC=1 to measure the peak heap without forced GC)');
  process.exit(1);
}
if (snapshotDir) {
  mkdirSync(snapshotDir, { recursive: true });
}

const mb = (bytes) => (bytes / 1048576).toFixed(2) + 'MB';

function measure() {
  if (forceGc) {
    global.gc();
    global.gc();
  }
  return process.memoryUsage();
}

const warmupIterations = Math.min(10, iterations);
const reportEvery = Math.max(1, Math.floor(iterations / 10));
const start = performance.now();
const rows = [];
let peakHeapUsed = 0;
for (let i = 1; i <= iterations; i++) {
  scenario();
  peakHeapUsed = Math.max(peakHeapUsed, process.memoryUsage().heapUsed);
  if (i === warmupIterations && snapshotDir) {
    measure();
    v8.writeHeapSnapshot(join(snapshotDir, `${scenarioName}-warm.heapsnapshot`));
  }
  if (i === warmupIterations || i % reportEvery === 0) {
    const usage = measure();
    rows.push({ i, heapUsed: usage.heapUsed });
    console.log(
      `${scenarioName}\titeration=${String(i).padStart(5)}\theapUsed=${mb(usage.heapUsed)}\trss=${mb(usage.rss)}\texternal=${mb(usage.external)}`,
    );
  }
}
if (snapshotDir) {
  measure();
  v8.writeHeapSnapshot(join(snapshotDir, `${scenarioName}-end.heapsnapshot`));
}

const first = rows.find((row) => row.i === warmupIterations);
const last = rows.at(-1);
const growth = last.heapUsed - first.heapUsed;
const perIteration = last.i > first.i ? growth / (last.i - first.i) : 0;
console.log(
  `${scenarioName}\t${forceGc ? 'heapUsed after GC grew by' : 'heapUsed grew by'} ${mb(growth)} between iteration ${first.i} and ${last.i}` +
    ` (${(perIteration / 1024).toFixed(1)}KB per iteration); avg ${((performance.now() - start) / iterations).toFixed(0)}ms per iteration`,
);
if (!forceGc) {
  console.log(`${scenarioName}\tpeak heapUsed without forced GC: ${mb(peakHeapUsed)}`);
}
