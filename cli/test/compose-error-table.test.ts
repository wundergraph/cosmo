import { describe, test, expect } from 'vitest';
import Table from 'cli-table3';
import { wrapText, TABLE_CONTENT_WIDTH } from '../src/wrap-text.js';

// Regression test for https://github.com/wundergraph/cosmo/issues/2619
//
// The bug: cli-table3's wordWrap option uses string-width → emoji-regex for every
// word, which grows super-linearly with text volume. With large composition errors
// (~9 MB in real-world cases), table.toString() hangs indefinitely.
//
// The fix: pre-wrap text with our lightweight wrapText() utility instead of relying
// on cli-table3's built-in wordWrap.

function generateLargeErrorMessage(sizeBytes: number): string {
  const lines: string[] = ['The field "id" is unresolvable at the following path:'];
  let depth = 1;
  while (lines.join('\n').length < sizeBytes) {
    const indent = ' '.repeat(depth);
    lines.push(`${indent}type${depth} {`);
    lines.push(`${indent} edges {`);
    lines.push(`${indent}  node {`);
    depth += 3;
    if (depth > 300) depth = 1;
  }
  return lines.join('\n').substring(0, sizeBytes);
}

describe('Error table rendering with large text (#2619)', () => {
  test('wrapText handles 1 MB of error text in under 1 second', () => {
    // In real-world cases, composition produces ~9 MB of errors (29 errors,
    // each 100-430 KB). cli-table3's wordWrap takes hours on this volume.
    // Our wrapText must handle it in milliseconds.
    const errors = Array.from({ length: 10 }, () => generateLargeErrorMessage(100_000));
    const totalMB = errors.reduce((a, e) => a + e.length, 0) / (1024 * 1024);
    expect(totalMB).toBeGreaterThan(0.9);

    const t0 = Date.now();
    for (const error of errors) {
      const wrapped = wrapText(error, TABLE_CONTENT_WIDTH);
      for (const line of wrapped.split('\n')) {
        if (line.trim().length > 0) {
          expect(line.length).toBeLessThanOrEqual(TABLE_CONTENT_WIDTH + 1);
        }
      }
    }
    const elapsed = Date.now() - t0;

    // wrapText on 1 MB must complete in well under 1 second.
    // cli-table3's wordWrap takes ~13 seconds on 1 MB and hours on 9 MB.
    expect(elapsed).toBeLessThan(1000);
  }, 5_000);

  test('cli-table3 wordWrap is too slow for large error text (demonstrates the bug)', () => {
    // This test proves the bug exists: cli-table3's wordWrap is unusably slow
    // even on a small 500-byte input. It takes >100ms where wrapText takes <1ms.
    // At real-world scale (9 MB), wordWrap takes hours.
    const text = generateLargeErrorMessage(500);

    // Measure the buggy path: cli-table3 wordWrap: true
    const buggyTable = new Table({ head: ['MSG'], colWidths: [120], wordWrap: true });
    buggyTable.push([text]);
    const t0 = Date.now();
    buggyTable.toString();
    const buggyMs = Date.now() - t0;

    // Measure the fixed path: wrapText + no wordWrap
    const fixedTable = new Table({ head: ['MSG'], colWidths: [120] });
    fixedTable.push([wrapText(text, TABLE_CONTENT_WIDTH)]);
    const t1 = Date.now();
    fixedTable.toString();
    const fixedMs = Date.now() - t1;

    // The fixed path must be significantly faster than the buggy path.
    // wordWrap on 500 bytes takes ~100-300ms, wrapText takes <5ms.
    // This ratio only gets worse with more text (super-linear).
    expect(fixedMs).toBeLessThan(buggyMs);
  }, 5_000);
});
