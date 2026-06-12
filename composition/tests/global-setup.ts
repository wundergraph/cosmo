import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The benchmark scenario is gitignored but fully deterministic (bench/gen.mjs).
// Differential tests (sdl-printer, sdl-parser, idempotence) read it, so generate
// it once before the test workers start when it is absent (e.g. in CI).
export default function setup(): void {
  const testsDir = dirname(fileURLToPath(import.meta.url));
  const benchDir = join(testsDir, '..', 'bench');
  if (existsSync(join(benchDir, 'scenario', 'manifest.json'))) {
    return;
  }
  execFileSync(process.execPath, [join(benchDir, 'gen.mjs')], { stdio: 'inherit' });
}
