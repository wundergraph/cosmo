import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as Sentry from '@sentry/node';
import { openSpanRegistry, withRequestSpans, withSpan } from '../src/core/tracing.js';

type TransactionEvent = {
  transaction?: string;
  contexts?: { trace?: { trace_id?: string } };
  spans?: { description?: string; status?: string; data?: Record<string, unknown> }[];
};

/**
 * Append-only, and never cleared: `Sentry.init` is process-wide, so there is one
 * transport for the whole file. Each test selects its own transaction by trace id
 * instead of owning the buffer, so concurrent tests cannot see or clear each other's.
 */
const sentTransactions: TransactionEvent[] = [];

function capturingTransport() {
  return {
    send: (envelope: any) => {
      const items = envelope[1] as [{ type: string }, unknown][];
      for (const [itemHeader, payload] of items) {
        if (itemHeader.type === 'transaction') {
          sentTransactions.push(payload as TransactionEvent);
        }
      }
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  };
}

/** Waits past the exporter's debounced flush, then returns this trace's transaction. */
async function transactionOf(traceId: string): Promise<TransactionEvent | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  await Sentry.flush(2000);
  return sentTransactions.find((t) => t.contexts?.trace?.trace_id === traceId);
}

function spanNames(tx: TransactionEvent | undefined): string[] {
  return (tx?.spans ?? []).map((s) => s.description ?? '').sort();
}

/** Runs `fn` inside a root span, and resolves with that span's trace id. */
async function inRequest(fn: (root: Sentry.Span) => Promise<void>): Promise<string> {
  let traceId = '';
  await Sentry.startSpanManual({ name: 'http.server' }, async (root) => {
    traceId = Sentry.spanToJSON(root).trace_id ?? '';
    await fn(root);
    root.end();
  });
  return traceId;
}

beforeAll(() => {
  Sentry.init({
    dsn: 'https://public@example.ingest.sentry.io/1',
    tracesSampleRate: 1,
    transport: capturingTransport,
    integrations: [],
    defaultIntegrations: false,
    openTelemetrySpanProcessors: [openSpanRegistry],
  });
});

afterAll(async () => {
  await Sentry.close(2000);
});

describe('span export when a request is aborted', () => {
  test('exports spans that completed before the abort', async () => {
    const controller = new AbortController();

    const traceId = await inRequest(async () => {
      await withRequestSpans(controller.signal, async () => {
        await withSpan('Auth.authenticate', async () => {});
      });
    });

    expect(spanNames(await transactionOf(traceId))).toContain('Auth.authenticate');
  });

  test('exports a span that is still running when the request aborts', async () => {
    const controller = new AbortController();

    const traceId = await inRequest(async () => {
      await withRequestSpans(controller.signal, async () => {
        await withSpan('Auth.authenticate', async () => {});

        // Never settles: the handler does not observe the abort signal.
        const hung = withSpan('SubgraphRepository.update', () => new Promise(() => {}));
        expect(hung).toBeInstanceOf(Promise);

        controller.abort();
      });
    });

    expect(spanNames(await transactionOf(traceId))).toEqual(['Auth.authenticate', 'SubgraphRepository.update']);
  });

  test('marks force-ended spans as deadline_exceeded so they are distinguishable', async () => {
    const controller = new AbortController();

    const traceId = await inRequest(async () => {
      await withRequestSpans(controller.signal, async () => {
        const hung = withSpan('SubgraphRepository.update', () => new Promise(() => {}));
        expect(hung).toBeInstanceOf(Promise);

        await new Promise((resolve) => setImmediate(resolve));
        controller.abort();
      });
    });

    const tx = await transactionOf(traceId);
    const forced = tx?.spans?.find((s) => s.description === 'SubgraphRepository.update');
    expect(forced?.status).toBe('deadline_exceeded');
  });

  test('reports the whole nested chain of spans open at the abort, not just the outermost', async () => {
    const controller = new AbortController();

    const traceId = await inRequest(async () => {
      await withRequestSpans(controller.signal, async () => {
        const hung = withSpan('SubgraphRepository.update', async () => {
          await withSpan('FederatedGraphRepository.compose', async () => {
            await withSpan('ComposeGraphsPool.composeGraphsInWorker', () => new Promise(() => {}));
          });
        });
        expect(hung).toBeInstanceOf(Promise);

        // Let the nested spans open before the deadline fires.
        await new Promise((resolve) => setImmediate(resolve));
        controller.abort();
      });
    });

    expect(spanNames(await transactionOf(traceId))).toEqual([
      'ComposeGraphsPool.composeGraphsInWorker',
      'FederatedGraphRepository.compose',
      'SubgraphRepository.update',
    ]);
  });

  test('reports spans opened by auto-instrumentation, not only those from withSpan', async () => {
    const controller = new AbortController();

    const traceId = await inRequest(async () => {
      await withRequestSpans(controller.signal, async () => {
        // As an instrumentation would create it: straight on the tracer.
        Sentry.startInactiveSpan({ name: 'pg.query' });
        await new Promise((resolve) => setImmediate(resolve));
        controller.abort();
      });
    });

    expect(spanNames(await transactionOf(traceId))).toContain('pg.query');
  });
});
