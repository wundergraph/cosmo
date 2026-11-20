import { execa } from 'execa';

export interface CommandRequest {
  file: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface CommandOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface TestRequest {
  command: string;
  cwd: string;
  env: Record<string, string>;
}

/** Everything Forge runs outside its own process, so tests can replace Go, git and the user's tests. */
export interface System {
  run(request: CommandRequest): Promise<CommandOutcome>;
  /** Runs the user's test command in a shell, streaming its output to stderr. */
  runTest(request: TestRequest): Promise<{ exitCode: number }>;
  /** Downloads a document. A request that never got an answer has status 0 and the reason as its body. */
  fetchText(url: string): Promise<{ status: number; body: string }>;
}

const commandNotFound = 127;

export const createSystem = (): System => ({
  async run({ file, args, cwd, env }) {
    const outcome = await execa(file, args, { cwd, env, reject: false });
    if (outcome.exitCode === undefined) {
      return { exitCode: commandNotFound, stdout: '', stderr: outcome.shortMessage ?? '' };
    }
    return { exitCode: outcome.exitCode, stdout: outcome.stdout, stderr: outcome.stderr };
  },
  async runTest({ command, cwd, env }) {
    const outcome = await execa(command, { cwd, env, shell: true, reject: false, stdio: ['ignore', 2, 2] });
    return { exitCode: outcome.exitCode ?? commandNotFound };
  },
  async fetchText(url) {
    try {
      const response = await fetch(url);
      return { status: response.status, body: await response.text() };
    } catch (error) {
      return { status: 0, body: error instanceof Error ? error.message : String(error) };
    }
  },
});
