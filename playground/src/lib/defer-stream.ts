import { meros } from 'meros/browser';

type PendingEntry = { path: unknown[]; label?: string };

type V02Payload = {
  data?: unknown;
  errors?: unknown;
  extensions?: unknown;
  pending?: Array<PendingEntry & { id: string }>;
  incremental?: Array<{ id: string; data?: unknown; errors?: unknown; extensions?: unknown }>;
  hasNext?: boolean;
};

type PathBasedPart = Record<string, unknown>;

export type DeferTimeline = {
  state: 'streaming' | 'complete';
  arrived: { label: string; atMs: number }[];
};

// Incremental payloads refer to earlier pending entries by id, so the map must outlive a single part.
const toPathBased = (payload: V02Payload, pending: Map<string, PendingEntry>): PathBasedPart[] => {
  for (const entry of payload.pending ?? []) {
    pending.set(entry.id, { path: entry.path, label: entry.label });
  }

  if (payload.incremental) {
    return payload.incremental.map((item) => {
      const meta = pending.get(item.id);
      return {
        data: item.data,
        errors: item.errors,
        extensions: item.extensions,
        path: meta?.path ?? [],
        label: meta?.label,
        hasNext: payload.hasNext,
      };
    });
  }

  if (payload.data !== undefined || payload.errors !== undefined) {
    return [{ data: payload.data, errors: payload.errors, extensions: payload.extensions, hasNext: payload.hasNext }];
  }

  return [];
};

// onTimeline fires when a labelled part arrives or the state changes, not on every chunk.
// meros does not cancel the body when the consumer stops early, so the body is read through a reader
// this function owns and cancels in its finally.
export async function* readDeferStream(
  response: Response,
  onTimeline?: (timeline: DeferTimeline) => void,
): AsyncGenerator<PathBasedPart[]> {
  const reader = response.body?.getReader();
  if (!reader) {
    return;
  }

  try {
    const chunks = await meros(new Response(pullFrom(reader), { headers: response.headers }), { multiple: true });
    if (chunks instanceof Response) {
      return;
    }
    yield* parseChunks(chunks, onTimeline);
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed.
    }
  }
}

const pullFrom = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
  });

async function* parseChunks(
  chunks: AsyncIterable<ReadonlyArray<{ json: boolean; body: unknown }>>,
  onTimeline?: (timeline: DeferTimeline) => void,
): AsyncGenerator<PathBasedPart[]> {
  const pending = new Map<string, PendingEntry>();
  const started = performance.now();
  const arrived: DeferTimeline['arrived'] = [];
  let state: DeferTimeline['state'] = 'streaming';

  onTimeline?.({ state, arrived: [] });

  for await (const chunk of chunks) {
    const parts: PathBasedPart[] = [];
    for (const part of chunk) {
      if (part.json) {
        parts.push(...toPathBased(part.body as V02Payload, pending));
      }
    }

    const nextState = parts[parts.length - 1]?.hasNext === true ? 'streaming' : 'complete';
    let changed = nextState !== state;
    state = nextState;
    for (const part of parts) {
      if (typeof part.label === 'string') {
        arrived.push({ label: part.label, atMs: performance.now() - started });
        changed = true;
      }
    }
    if (changed) {
      onTimeline?.({ state, arrived: [...arrived] });
    }

    if (parts.length > 0) {
      yield parts;
    }
  }

  if (state !== 'complete') {
    state = 'complete';
    onTimeline?.({ state, arrived: [...arrived] });
  }
}
