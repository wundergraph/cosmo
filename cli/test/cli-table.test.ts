import { describe, test, expect, vi } from 'vitest';
import { CLITable } from '../src/cli-table.js';
import * as wrapTextModule from '../src/wrap-text.js';

// cli-table3 default overhead: padding-left(1) + padding-right(1)
const DEFAULT_OVERHEAD = 2;

describe('CLITable', () => {
  test('push wraps string cells using wrapText based on colWidths', () => {
    const spy = vi.spyOn(wrapTextModule, 'wrapText');
    const table = new CLITable({
      head: ['NAME', 'MESSAGE'],
      colWidths: [30, 120],
    });

    table.push(['my-graph', 'some error message']);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith('my-graph', 30 - DEFAULT_OVERHEAD);
    expect(spy).toHaveBeenCalledWith('some error message', 120 - DEFAULT_OVERHEAD);
  });

  test('push skips wrapText for non-string cells and null widths', () => {
    const spy = vi.spyOn(wrapTextModule, 'wrapText');
    const table = new CLITable({
      head: ['COUNT', 'AUTO', 'MESSAGE'],
      colWidths: [10, null, 30],
    });

    table.push([42, 'not wrapped', 'wrapped']);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('wrapped', 30 - DEFAULT_OVERHEAD);
  });

  test('does not deadlock on large text (#2619)', () => {
    const table = new CLITable({
      head: ['ERROR_MESSAGE'],
      colWidths: [120],
    });
    const largeText = 'error '.repeat(100).trim();
    const t0 = Date.now();
    table.push([largeText]);
    table.toString();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(500);
  }, 5000);
});
