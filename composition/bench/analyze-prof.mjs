#!/usr/bin/env node
// Aggregate a .cpuprofile: self-time by function and by category.
// Usage: node analyze-prof.mjs <file.cpuprofile> [topN]
import { readFileSync } from 'node:fs';

const [, , file, topNArg] = process.argv;
const topN = Number(topNArg ?? 30);
const prof = JSON.parse(readFileSync(file, 'utf8'));

const nodesById = new Map(prof.nodes.map((n) => [n.id, n]));
const selfMicros = new Map();
const total = prof.samples.length;
const interval = (prof.endTime - prof.startTime) / total; // micros per sample
for (const id of prof.samples) {
  selfMicros.set(id, (selfMicros.get(id) ?? 0) + interval);
}

function categorize(cf) {
  const url = cf.url ?? '';
  const name = cf.functionName || '(anonymous)';
  if (name === '(garbage collector)') return 'GC';
  if (name === '(program)' || name === '(idle)') return 'node-internal';
  if (url.includes('/dist/')) {
    const m = url.match(/\/dist\/(.+)\.js/);
    return `lib:${m ? m[1] : url}`;
  }
  if (url.includes('node_modules/graphql/')) return 'dep:graphql-js';
  if (url.includes('@graphql-tools')) return 'dep:graphql-tools';
  if (url.includes('node_modules')) return 'dep:other';
  if (url.startsWith('node:')) return 'node-builtin';
  if (url.includes('bench')) return 'bench-harness';
  return 'other';
}

const byFunc = new Map();
const byCat = new Map();
const byFile = new Map();
for (const [id, micros] of selfMicros) {
  const n = nodesById.get(id);
  if (!n) continue;
  const cf = n.callFrame;
  const shortUrl = (cf.url ?? '').replace(/^.*\/(composition|node_modules)\//, '$1/');
  const key = `${cf.functionName || '(anonymous)'} @ ${shortUrl}:${cf.lineNumber}`;
  byFunc.set(key, (byFunc.get(key) ?? 0) + micros);
  const cat = categorize(cf);
  byCat.set(cat, (byCat.get(cat) ?? 0) + micros);
  const fileKey = cat.startsWith('lib:') ? cat : (shortUrl || cat);
  byFile.set(fileKey, (byFile.get(fileKey) ?? 0) + micros);
}

const totalMicros = total * interval;
const fmt = (micros) => `${(micros / 1000).toFixed(1)}ms ${((100 * micros) / totalMicros).toFixed(1)}%`;

console.log(`total profiled: ${(totalMicros / 1000).toFixed(0)}ms, samples=${total}\n`);
console.log('== by category ==');
for (const [k, v] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) console.log(`${fmt(v).padStart(16)}  ${k}`);
console.log(`\n== top ${topN} functions by self time ==`);
for (const [k, v] of [...byFunc.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)) console.log(`${fmt(v).padStart(16)}  ${k}`);
console.log(`\n== top 25 files by self time ==`);
for (const [k, v] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${fmt(v).padStart(16)}  ${k}`);
