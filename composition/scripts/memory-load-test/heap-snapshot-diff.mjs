/**
 * Compares two V8 heap snapshots (e.g. the warm and end snapshots written by load-test.mjs) and lists the object
 * classes that grew the most, by count and by self size.
 *
 *   node --max-old-space-size=4096 scripts/memory-load-test/heap-snapshot-diff.mjs <before.heapsnapshot> <after.heapsnapshot>
 *
 * Growth only in "(code)" and "(hidden)" is JIT code and V8 internals, not a leak in JavaScript objects.
 */
import { readFileSync } from 'node:fs';

const [, , beforePath, afterPath] = process.argv;
if (!beforePath || !afterPath) {
  console.error('usage: heap-snapshot-diff.mjs <before.heapsnapshot> <after.heapsnapshot>');
  process.exit(1);
}

const ANONYMOUS_TYPES = new Set([
  'array',
  'bigint',
  'closure',
  'code',
  'concatenated string',
  'hidden',
  'native',
  'number',
  'object shape',
  'regexp',
  'sliced string',
  'string',
  'symbol',
]);

function aggregate(path) {
  const snapshot = JSON.parse(readFileSync(path, 'utf8'));
  const nodeFields = snapshot.snapshot.meta.node_fields;
  const nodeTypes = snapshot.snapshot.meta.node_types[0];
  const fieldCount = nodeFields.length;
  const typeIndex = nodeFields.indexOf('type');
  const nameIndex = nodeFields.indexOf('name');
  const sizeIndex = nodeFields.indexOf('self_size');
  const { nodes, strings } = snapshot;
  const byClass = new Map();
  let total = 0;
  for (let i = 0; i < nodes.length; i += fieldCount) {
    const type = nodeTypes[nodes[i + typeIndex]];
    const name = ANONYMOUS_TYPES.has(type) ? `(${type})` : strings[nodes[i + nameIndex]];
    const key = `${type}:${name}`;
    const entry = byClass.get(key) ?? { count: 0, size: 0 };
    entry.count++;
    entry.size += nodes[i + sizeIndex];
    total += nodes[i + sizeIndex];
    byClass.set(key, entry);
  }
  return { byClass, total };
}

const before = aggregate(beforePath);
const after = aggregate(afterPath);
const rows = [];
for (const [key, b] of after.byClass) {
  const a = before.byClass.get(key) ?? { count: 0, size: 0 };
  rows.push({ key, deltaCount: b.count - a.count, deltaSize: b.size - a.size, count: b.count, size: b.size });
}
rows.sort((x, y) => y.deltaSize - x.deltaSize);
const kb = (bytes) => (bytes / 1024).toFixed(1) + 'KB';
console.log(
  `total self size: before=${(before.total / 1048576).toFixed(2)}MB after=${(after.total / 1048576).toFixed(2)}MB delta=${kb(after.total - before.total)}`,
);
console.log('top growth by self size:');
for (const row of rows.filter((row) => row.deltaSize !== 0 || row.deltaCount !== 0).slice(0, 40)) {
  console.log(
    `  ${row.key.padEnd(60)} count ${String(row.deltaCount).padStart(8)}  size ${kb(row.deltaSize).padStart(11)}` +
      `  (after: ${row.count} objects, ${kb(row.size)})`,
  );
}
