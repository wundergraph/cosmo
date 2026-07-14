import { describe, expect, it } from 'vitest';

import { PlanPrinter } from './prettyPrint';
import type { QueryPlan } from './types';

describe('PlanPrinter defer boundaries', () => {
  it('prints defer labels and response paths around planned children', async () => {
    const plan: QueryPlan = {
      version: '1',
      kind: 'Sequence',
      children: [
        {
          kind: 'Sequence',
          defer: { id: 3, label: 'Mood', path: ['employee'] },
          children: [
            {
              kind: 'Single',
              fetch: {
                kind: 'Entity',
                subgraphName: 'mood',
                subgraphId: 'mood-id',
                path: 'employee',
                query: 'query { _entities { ... on Employee { currentMood } } }',
              },
            },
          ],
        },
      ],
    };

    const output = await new PlanPrinter().print(plan);

    expect(output).toContain('Defer(label: "Mood", path: "employee") {');
    expect(output).toContain('EntityFetch(service: "mood") {');
    expect(output.indexOf('Defer(')).toBeLessThan(output.indexOf('EntityFetch('));
  });

  it('keeps ordinary plans free of defer syntax', async () => {
    const plan: QueryPlan = {
      version: '1',
      kind: 'Single',
      children: [],
      fetch: {
        kind: 'Single',
        subgraphName: 'employees',
        subgraphId: 'employees-id',
        query: 'query { employees { id } }',
      },
    };

    expect(await new PlanPrinter().print(plan)).not.toContain('Defer');
  });
});
