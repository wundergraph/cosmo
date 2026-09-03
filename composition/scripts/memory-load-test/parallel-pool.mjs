/**
 * Simulates the controlplane composition worker pool inside a memory-limited pod: several worker processes compose
 * concurrently while this process watches their combined RSS. If the total exceeds the budget, all workers are killed
 * and the run is reported as OOM (what the kernel does to a pod). A worker that dies on its own (e.g. a V8
 * "heap out of memory" when a heap cap is too small for one composition) is reported as well.
 *
 *   pnpm build
 *   node scripts/memory-load-test/parallel-pool.mjs --scenario custom-contracts --workers 4 --tasks 2 --budget-mb 4096 [--heap-cap-mb 700]
 *
 * --heap-cap-mb passes --max-old-space-size to every worker, i.e. the per-process cap the controlplane can set through
 * the pool's execArgv. COMPOSITION_DIST and COMPOSITION_SUBGRAPHS are passed through to the workers.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}
const scenario = args.get('scenario') ?? 'contracts';
const workers = Number(args.get('workers') ?? 4);
const tasks = Number(args.get('tasks') ?? 2);
const budgetMb = Number(args.get('budget-mb') ?? 4096);
const heapCapMb = args.has('heap-cap-mb') ? Number(args.get('heap-cap-mb')) : undefined;
const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'parallel-worker.mjs');

const rssMb = (pid) => {
  try {
    const match = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
    return match ? Number(match[1]) / 1024 : 0;
  } catch {
    return 0;
  }
};

console.log(
  `scenario=${scenario} workers=${workers} tasks/worker=${tasks} budget=${budgetMb}MB` +
    (heapCapMb ? ` heap cap per worker=${heapCapMb}MB` : ' (no heap cap, like the controlplane today)'),
);
const start = performance.now();
const children = [];
let completed = 0;
let failure;
for (let w = 0; w < workers; w++) {
  const child = spawn(
    process.execPath,
    [...(heapCapMb ? [`--max-old-space-size=${heapCapMb}`] : []), workerPath, scenario, String(tasks)],
    { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
  );
  child.stdout.on('data', (data) => {
    for (const line of String(data).trim().split('\n')) {
      completed++;
      console.log(`  worker ${w}: ${line} (${((performance.now() - start) / 1000).toFixed(1)}s elapsed)`);
    }
  });
  let stderr = '';
  child.stderr.on('data', (data) => (stderr += data));
  child.on('exit', (code, signal) => {
    if (code !== 0 && !failure && signal !== 'SIGKILL') {
      const reason = /heap out of memory/i.test(stderr) ? 'V8 heap out of memory' : `exit code ${code}`;
      failure = `worker ${w} died: ${reason}\n${stderr
        .split('\n')
        .filter((l) => /FATAL|heap|Error/.test(l))
        .slice(0, 3)
        .join('\n')}`;
    }
  });
  children.push(child);
}

let maxTotalMb = 0;
const sampler = setInterval(() => {
  const perWorker = children.map((child) => (child.exitCode === null ? rssMb(child.pid) : 0));
  const total = perWorker.reduce((a, b) => a + b, 0);
  maxTotalMb = Math.max(maxTotalMb, total);
  if (total > budgetMb && !failure) {
    failure = `OOM: combined worker RSS ${total.toFixed(0)}MB exceeded the ${budgetMb}MB budget (per worker: ${perWorker.map((v) => v.toFixed(0)).join(', ')}MB); the pod would have been OOM-killed`;
    for (const child of children) {
      child.kill('SIGKILL');
    }
  }
}, 100);

await Promise.all(children.map((child) => new Promise((resolve) => child.on('exit', resolve))));
clearInterval(sampler);
const seconds = ((performance.now() - start) / 1000).toFixed(1);
if (failure) {
  console.log(
    `RESULT: FAILED after ${seconds}s with ${completed}/${workers * tasks} tasks completed; peak combined RSS ${maxTotalMb.toFixed(0)}MB\n${failure}`,
  );
  process.exit(1);
}
console.log(
  `RESULT: OK, ${completed}/${workers * tasks} tasks completed in ${seconds}s; peak combined RSS ${maxTotalMb.toFixed(0)}MB`,
);
