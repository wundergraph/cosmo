import { TraceContext, TraceView } from '@/components/playground/trace-view';
import { nsToTime } from '@/lib/insights-helpers';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/components/playground/fetch-flow', () => ({
  FetchFlow: () => null,
  ARTCustomEdge: () => null,
  ReactFlowARTFetchNode: () => null,
  ReactFlowARTMultiFetchNode: () => null,
}));

const stats = (sinceStart: number, duration: number) => ({
  duration_nanoseconds: duration,
  duration_since_start_nanoseconds: sinceStart,
});

const fetchNode = (kind: string, sourceName: string, sinceStart: number, load: number) => ({
  kind,
  path: '',
  source_id: `${sourceName}-id`,
  source_name: sourceName,
  trace: {
    input: { body: { query: `query { ${sourceName} { id } }` } },
    output: { data: {} },
    duration_since_start_nanoseconds: sinceStart,
    duration_load_nanoseconds: load,
    single_flight_used: false,
    single_flight_shared_response: false,
    load_skipped: false,
  },
});

const traceResponse = (fetches: unknown) =>
  JSON.stringify({
    data: { employees: [] },
    extensions: {
      trace: {
        version: '1',
        info: {
          trace_start_time: '2026-10-08T20:52:25Z',
          trace_start_unix: 1791492745,
          parse_stats: stats(21979, 6168),
          normalize_stats: stats(31564, 24284),
          validate_stats: stats(56079, 36888),
          planner_stats: stats(93029, 596430),
        },
        fetches,
      },
    },
  });

const renderWaterfall = (response: string) => {
  render(
    <TraceContext.Provider
      value={{
        query: 'query Employees { employees { id } }',
        subgraphs: [
          { id: 'employees-id', name: 'employees' },
          { id: 'products-id', name: 'products' },
        ],
        headers: JSON.stringify({ 'X-WG-TRACE': 'true' }),
        response,
        clientValidationEnabled: true,
        setClientValidationEnabled: () => {},
      }}
    >
      <TraceView />
    </TraceContext.Provider>,
  );
  fireEvent.mouseDown(screen.getByText('Waterfall View'), { button: 0 });
};

describe('TraceView waterfall', () => {
  afterEach(cleanup);

  test('shows timing when the trace root is a single fetch', () => {
    renderWaterfall(traceResponse({ kind: 'Single', fetch: fetchNode('Single', 'employees', 801163, 40420731) }));

    expect(screen.getByText('employees')).toBeTruthy();
    expect(screen.getAllByText(nsToTime(BigInt(40420731))).length).toBeGreaterThan(0);
    expect(screen.getByText(nsToTime(BigInt(801163 + 40420731)))).toBeTruthy();
  });

  test('shows timing for every fetch when the trace root is a sequence', () => {
    renderWaterfall(
      traceResponse({
        kind: 'Sequence',
        children: [
          { kind: 'Single', fetch: fetchNode('Single', 'employees', 1244945, 11628355) },
          { kind: 'Single', fetch: fetchNode('Entity', 'products', 12984860, 25977002) },
        ],
      }),
    );

    expect(screen.getByText('employees')).toBeTruthy();
    expect(screen.getByText('products')).toBeTruthy();
    expect(screen.getAllByText(nsToTime(BigInt(11628355))).length).toBeGreaterThan(0);
    expect(screen.getAllByText(nsToTime(BigInt(25977002))).length).toBeGreaterThan(0);
    expect(screen.getByText(nsToTime(BigInt(12984860 + 25977002)))).toBeTruthy();
  });
});
