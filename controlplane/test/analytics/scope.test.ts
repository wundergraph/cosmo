import { describe, expect, test } from 'vitest';
import type { EngineGraph } from '../../src/core/repositories/analytics/query/engine.js';
import { applyGraphFilter } from '../../src/core/util/analytics/scope.js';

const alpha: EngineGraph = { id: 'g-alpha', name: 'alpha', namespace: 'default' };
const beta: EngineGraph = { id: 'g-beta', name: 'beta', namespace: 'default' };

const graphFilter = (operator: 'eq' | 'neq' | 'in' | 'not_in', values: string[]) => ({
  field: 'graph',
  operator,
  values,
  type: 'string' as const,
});

describe('Graph filters', () => {
  test('narrow the graphs a query reads', () => {
    expect(applyGraphFilter([alpha, beta], [graphFilter('eq', ['alpha'])])).toEqual([alpha]);
    expect(applyGraphFilter([alpha, beta], [graphFilter('neq', ['alpha'])])).toEqual([beta]);
    expect(applyGraphFilter([alpha, beta], [graphFilter('in', ['alpha', 'beta'])])).toEqual([alpha, beta]);
    expect(applyGraphFilter([alpha, beta], [graphFilter('not_in', ['beta'])])).toEqual([alpha]);
    expect(applyGraphFilter([alpha, beta], [])).toEqual([alpha, beta]);
  });
});
