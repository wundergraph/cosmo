/**
 * drizzle-kit only diffs against the latest snapshot, so older ones are dead weight. Keeping just that one means a new
 * migration shows up in review as a rename with a small diff rather than a 10k-line file. `db:drop` restores the
 * previous snapshot from git when it needs it.
 *
 * Keys are sorted because `generate --custom` writes them in a different order to `generate`, which would otherwise
 * turn that diff into hundreds of lines of noise.
 */
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const metaDir = path.join(import.meta.dirname, '../migrations/meta');

const snapshots = (await readdir(metaDir)).filter((file) => file.endsWith('_snapshot.json')).sort();
const latest = path.join(metaDir, snapshots.pop());

const sortKeys = (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
    : value;

await Promise.all([
  ...snapshots.map((file) => rm(path.join(metaDir, file))),
  writeFile(latest, JSON.stringify(JSON.parse(await readFile(latest, 'utf8'), sortKeys), null, 2)),
]);
