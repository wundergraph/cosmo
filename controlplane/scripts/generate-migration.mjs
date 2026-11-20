/**
 * Wraps `drizzle-kit generate` so arguments like `--name` reach drizzle-kit rather than being appended to a chained
 * command, then prunes the snapshots.
 */
import { spawnSync } from 'node:child_process';

const { status } = spawnSync('drizzle-kit', ['generate', '--config=drizzle.config.ts', ...process.argv.slice(2)], {
  stdio: 'inherit',
});

if (status === 0) {
  await import('./prune-migration-snapshots.mjs');
} else {
  process.exitCode = status ?? 1;
}
