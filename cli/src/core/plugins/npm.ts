import { execa } from 'execa';
import { failure, ok } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';

/** Runs npm with `args` in `cwd`. Injected so tests can stand in for npm. */
export type NpmRunner = (args: string[], cwd: string) => Promise<Result<string>>;

export const runNpm: NpmRunner = async (args, cwd) => {
  const result = await execa('npm', args, { cwd, reject: false });
  if (result.failed) {
    const detail = (result.stderr || result.stdout || result.message || '').trim();
    return failure(`npm ${args.join(' ')} failed: ${detail}`);
  }
  return ok(result.stdout);
};
