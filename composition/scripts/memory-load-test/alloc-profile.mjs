/**
 * Sampling allocation profile of a scenario: where does composition allocate memory?
 *
 *   pnpm build
 *   node scripts/memory-load-test/alloc-profile.mjs <scenario> [iterations=10]
 *
 * Prints the total allocation per composition, the top self-allocating frames, and the top inclusive frames in the
 * composition code. The raw profile is written to alloc-<scenario>.heapprofile and can be loaded in Chrome DevTools
 * (Memory > Load).
 */
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { getScenario } from './scenarios.mjs';

const [, , scenarioName = 'base', iterationsArg = '10'] = process.argv;
const scenario = getScenario(scenarioName);
const iterations = Number(iterationsArg);

// warm up the JIT so the profile is not dominated by compilation
for (let i = 0; i < 3; i++) {
  scenario();
}

const session = new Session();
session.connect();
await session.post('HeapProfiler.enable');
await session.post('HeapProfiler.startSampling', {
  samplingInterval: 16384,
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true,
});
const start = performance.now();
for (let i = 0; i < iterations; i++) {
  scenario();
}
const elapsed = performance.now() - start;
const { profile } = await session.post('HeapProfiler.stopSampling');
const profilePath = `alloc-${scenarioName}.heapprofile`;
writeFileSync(profilePath, JSON.stringify(profile));

const selfBytesByFrame = new Map();
const inclusiveBytesByFrame = new Map();
let totalBytes = 0;
function frameKey(node) {
  const url = node.callFrame.url.replace(/^.*\/(composition|graphql|lodash|@graphql-tools)\//, '$1/');
  return `${node.callFrame.functionName || '(anonymous)'} ${url}:${node.callFrame.lineNumber + 1}`;
}
function walk(node, ancestors) {
  const key = frameKey(node);
  selfBytesByFrame.set(key, (selfBytesByFrame.get(key) ?? 0) + node.selfSize);
  totalBytes += node.selfSize;
  for (const frame of new Set([key, ...ancestors])) {
    inclusiveBytesByFrame.set(frame, (inclusiveBytesByFrame.get(frame) ?? 0) + node.selfSize);
  }
  for (const child of node.children) {
    walk(child, [...ancestors, key]);
  }
}
walk(profile.head, []);

const mb = (bytes) => (bytes / 1048576).toFixed(1).padStart(8) + 'MB';
const percent = (bytes) => ((100 * bytes) / totalBytes).toFixed(1).padStart(5) + '%';
console.log(
  `[${scenarioName}] ${iterations} iterations in ${elapsed.toFixed(0)}ms;` +
    ` sampled allocation ${mb(totalBytes)} => ${mb(totalBytes / iterations)} per iteration (profile: ${profilePath})`,
);
console.log('\nTop self-allocating frames:');
for (const [key, bytes] of [...selfBytesByFrame].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`  ${mb(bytes)} ${percent(bytes)}  ${key}`);
}
console.log('\nTop inclusive frames (composition code only):');
for (const [key, bytes] of [...inclusiveBytesByFrame]
  .filter(([key]) => key.includes('composition/dist'))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30)) {
  console.log(`  ${mb(bytes)} ${percent(bytes)}  ${key}`);
}
