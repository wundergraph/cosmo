import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { minimumVisibleDurationNs, TraceContext, TraceView } from './trace-view';

vi.mock('reactflow', () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="react-flow">{children}</div>,
}));

vi.mock('react-move-hook', () => ({
  useMovable: () => () => {},
}));

vi.mock('./fetch-flow', () => ({
  ARTCustomEdge: {},
  FetchFlow: () => <div data-testid="fetch-flow" />,
  ReactFlowARTFetchNode: () => null,
  ReactFlowARTMultiFetchNode: () => null,
}));

vi.mock('./fetch-waterfall', () => ({
  FetchWaterfall: () => <div data-testid="fetch-waterfall" />,
}));

describe('minimumVisibleDurationNs', () => {
  it('clamps zero or missing durations to a visible minimum', () => {
    expect(minimumVisibleDurationNs()).toBe(1000);
    expect(minimumVisibleDurationNs(0)).toBe(1000);
    expect(minimumVisibleDurationNs(2500)).toBe(2500);
  });
});

describe('TraceView', () => {
  it('keeps the waterfall tab selected when the initial trace view is waterfall', () => {
    const response = JSON.stringify({
      data: {
        item: { id: '1' },
      },
      extensions: {
        trace: {
          version: '2',
          info: {
            trace_start_unix: 1,
            parse_stats: {
              duration_since_start_nanoseconds: 0,
              duration_nanoseconds: 1,
            },
            normalize_stats: {
              duration_since_start_nanoseconds: 1,
              duration_nanoseconds: 1,
            },
            validate_stats: {
              duration_since_start_nanoseconds: 2,
              duration_nanoseconds: 1,
            },
            planner_stats: {
              duration_since_start_nanoseconds: 3,
              duration_nanoseconds: 1,
            },
          },
          fetches: {
            id: 'fetch-1',
            type: 'Single',
            data_source_id: 'sg-1',
            trace: {
              duration_since_start_nanoseconds: 4,
              duration_nanoseconds: 0,
              cache_trace: {
                duration_since_start_nanoseconds: 4,
                duration_nanoseconds: 0,
              },
            },
            children: [],
          },
        },
      },
    });

    render(
      <TraceContext.Provider
        value={{
          query: 'query { item(id: "1") { id } }',
          subgraphs: [{ id: 'sg-1', name: 'items' }],
          headers: '{"X-WG-TRACE":"true"}',
          response,
          plan: undefined,
          planError: '',
          clientValidationEnabled: true,
          setClientValidationEnabled: () => {},
          forcedTheme: undefined,
        }}
      >
        <TraceView />
      </TraceContext.Provider>,
    );

    expect(screen.getByTestId('fetch-waterfall')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /waterfall view/i })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tab', { name: /tree view/i })).toHaveAttribute('data-state', 'inactive');
  });
});
