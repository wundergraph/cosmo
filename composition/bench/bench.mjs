#!/usr/bin/env node
// Benchmark for the LOCAL @wundergraph/composition build (../dist).
//
// Composes the deterministic 150-subgraph scenario in ./scenario and reports
// per-phase timings (parse / federate / SDL emit) plus an end-to-end median.
// Verifies the produced supergraph SDL against ./golden.graphql on every run
// so a perf change can never silently change semantics.
//
// Usage:
//   node composition/bench/gen.mjs   (once, generates ./scenario deterministically)
//   pnpm --filter @wundergraph/composition build
//   node composition/bench/bench.mjs
//
// Env knobs:
//   BENCH_ITERATIONS  timed iterations (default 7)
//   BENCH_WARMUP      warmup iterations (default 2)
//   BENCH_SKIP_GOLDEN set to 1 to skip the golden comparison
//   BENCH_OUT         write the produced supergraph SDL to this path

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = join(__dirname, 'scenario');
const GOLDEN_PATH = join(__dirname, 'golden.graphql');
const COMPOSITION_DIST = process.env.BENCH_DIST
  ? join(process.env.BENCH_DIST, 'index.js')
  : join(__dirname, '..', 'dist', 'index.js');

const compRequire = createRequire(join(__dirname, '..', 'package.json'));
const { lexicographicSortSchema } = await import(
  pathToFileURL(compRequire.resolve('graphql')).href
);
const { printSchemaWithDirectives } = await import(
  pathToFileURL(compRequire.resolve('@graphql-tools/utils')).href
);

const normalizeString = (input) => input.replace(/\s+/g, ' ').trim();
const schemaToSortedNormalizedString = (schema) =>
  normalizeString(printSchemaWithDirectives(lexicographicSortSchema(schema)));

const { federateSubgraphs, parse } = await import(pathToFileURL(COMPOSITION_DIST).href).catch((err) => {
  console.error(`Failed to import composition lib from ${COMPOSITION_DIST}\nRun: pnpm --filter @wundergraph/composition build`);
  throw err;
});

// --- Load scenario (not timed) ----------------------------------------------
const manifest = JSON.parse(readFileSync(join(SCENARIO_DIR, 'manifest.json'), 'utf8'));
const rawSubgraphs = manifest.subgraphs.map((sg) => ({
  name: sg.name,
  url: sg.url ?? '',
  sdl: readFileSync(join(SCENARIO_DIR, sg.file), 'utf8'),
}));
let totalBytes = 0;
for (const sg of rawSubgraphs) totalBytes += Buffer.byteLength(sg.sdl);
console.error(`Loaded ${rawSubgraphs.length} subgraphs (${(totalBytes / 1024).toFixed(0)} KiB SDL)`);

// --- One end-to-end run with per-phase timing --------------------------------
function runOnce() {
  const tParse0 = process.hrtime.bigint();
  const subgraphs = rawSubgraphs.map((sg) => ({
    name: sg.name,
    url: sg.url,
    definitions: parse(sg.sdl),
  }));
  const tParse1 = process.hrtime.bigint();

  const result = federateSubgraphs({ subgraphs });
  const tFed1 = process.hrtime.bigint();

  let sdl = '';
  if (result.success && process.env.BENCH_NO_EMIT !== '1') {
    sdl = schemaToSortedNormalizedString(result.federatedGraphSchema);
  }
  const tEmit1 = process.hrtime.bigint();

  return {
    success: result.success,
    errors: result.success ? [] : (result.errors ?? []),
    warnings: result.warnings ?? [],
    sdl,
    parseMs: Number(tParse1 - tParse0) / 1e6,
    federateMs: Number(tFed1 - tParse1) / 1e6,
    emitMs: Number(tEmit1 - tFed1) / 1e6,
    totalMs: Number(tEmit1 - tParse0) / 1e6,
  };
}

// --- Warmup + correctness gate ------------------------------------------------
const WARMUP = Number(process.env.BENCH_WARMUP ?? 2);
let warm;
for (let i = 0; i < WARMUP; i++) warm = runOnce();
if (!warm.success) {
  const errors = warm.errors;
  console.error(`Composition FAILED with ${errors.length} errors. First:\n${errors[0]?.message}`);
  process.exit(1);
}
console.error(`Composition OK: warnings=${warm.warnings.length}`);

if (process.env.BENCH_OUT) {
  writeFileSync(process.env.BENCH_OUT, warm.sdl);
  console.error(`wrote supergraph SDL (${warm.sdl.length} bytes) to ${process.env.BENCH_OUT}`);
}

if (process.env.BENCH_SKIP_GOLDEN !== '1') {
  const golden = normalizeString(readFileSync(GOLDEN_PATH, 'utf8'));
  if (warm.sdl !== golden) {
    console.error(`GOLDEN MISMATCH: produced ${warm.sdl.length} bytes, golden ${golden.length} bytes`);
    writeFileSync(join(__dirname, 'out-mismatch.graphql'), warm.sdl);
    console.error(`wrote mismatching output to bench/out-mismatch.graphql`);
    process.exit(2);
  }
  console.error('Golden output check: PASS');
}

// --- Timed iterations ---------------------------------------------------------
const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 7);
const samples = [];
for (let i = 0; i < ITERATIONS; i++) {
  if (globalThis.gc) globalThis.gc();
  const r = runOnce();
  if (!r.success) {
    console.error(`Iteration ${i} unexpectedly failed composition`);
    process.exit(1);
  }
  samples.push(r);
  const heapMb = (process.memoryUsage().heapUsed / 1048576).toFixed(0);
  console.error(
    `  iter ${i}: total=${r.totalMs.toFixed(1)}ms parse=${r.parseMs.toFixed(1)}ms federate=${r.federateMs.toFixed(1)}ms emit=${r.emitMs.toFixed(1)}ms heap=${heapMb}MB`,
  );
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const totals = samples.map((s) => s.totalMs);
const m = {
  total: median(totals),
  parse: median(samples.map((s) => s.parseMs)),
  federate: median(samples.map((s) => s.federateMs)),
  emit: median(samples.map((s) => s.emitMs)),
};
console.error(
  `min=${Math.min(...totals).toFixed(1)}ms max=${Math.max(...totals).toFixed(1)}ms median=${m.total.toFixed(1)}ms over ${samples.length} iters`,
);
console.log(`TOTAL_MEDIAN_MS=${m.total.toFixed(1)}`);
console.log(`PARSE_MEDIAN_MS=${m.parse.toFixed(1)}`);
console.log(`FEDERATE_MEDIAN_MS=${m.federate.toFixed(1)}`);
console.log(`EMIT_MEDIAN_MS=${m.emit.toFixed(1)}`);
