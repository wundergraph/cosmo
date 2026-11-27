/**
 * Replaces `drizzle-kit drop`, which offers every migration and fails halfway through on any whose snapshot has been
 * pruned. This only drops the latest, and first restores the previous snapshot from git, since `generate` would
 * otherwise diff against an empty schema and recreate every table.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const migrationsDir = path.join(import.meta.dirname, '../migrations');
const journalPath = path.join(migrationsDir, 'meta/_journal.json');
const snapshotFile = (tag) => `meta/${tag.split('_')[0]}_snapshot.json`;

const git = (...args) =>
  execFileSync('git', args, { cwd: migrationsDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const showInGit = (revision, file) => {
  try {
    return git('show', `${revision}:./${file}`);
  } catch {
    return undefined;
  }
};

/**
 * The snapshot is either still in HEAD (pruned but not yet committed) or in the parent of the commit that pruned it.
 * One that was pruned before ever being committed is gone for good.
 */
const restoreFromGit = async (file) => {
  const prunedIn = git('log', '-1', '--format=%H', '--diff-filter=D', '--', file).trim();
  const contents = showInGit('HEAD', file) ?? (prunedIn ? showInGit(`${prunedIn}^`, file) : undefined);
  if (!contents) {
    throw new Error(`Can't find ${file} in git, so dropping would leave nothing for generate to diff against`);
  }
  await writeFile(path.join(migrationsDir, file), contents);
};

const journal = JSON.parse(await readFile(journalPath, 'utf8'));
const latest = journal.entries.at(-1);
const previous = journal.entries.at(-2);

if (!existsSync(path.join(migrationsDir, snapshotFile(previous.tag)))) {
  await restoreFromGit(snapshotFile(previous.tag));
}

await Promise.all([
  rm(path.join(migrationsDir, `${latest.tag}.sql`)),
  rm(path.join(migrationsDir, snapshotFile(latest.tag))),
  writeFile(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) }, null, 2)),
]);

// The restored snapshot may predate key sorting.
await import('./prune-migration-snapshots.mjs');

console.log(`Dropped ${latest.tag}`);
