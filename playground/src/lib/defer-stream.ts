import { meros } from 'meros/browser';
import { z } from 'zod';

const pendingEntrySchema = z.object({
  id: z.string(),
  path: z.array(z.unknown()),
  label: z.string().optional(),
});

const v02PayloadSchema = z.object({
  data: z.unknown(),
  errors: z.unknown(),
  extensions: z.unknown(),
  pending: z.array(pendingEntrySchema).optional(),
  incremental: z
    .array(
      z.object({
        id: z.string(),
        data: z.unknown(),
        errors: z.unknown(),
        extensions: z.unknown(),
      }),
    )
    .optional(),
  hasNext: z.boolean().optional(),
});

type PendingEntry = z.infer<typeof pendingEntrySchema>;

type PathBasedPart = {
  data?: unknown;
  errors?: unknown;
  extensions?: unknown;
  path?: unknown[];
  label?: string;
  hasNext?: boolean;
};

export type DeferTimeline = {
  state: 'streaming' | 'complete';
  arrived: { label: string; atMs: number }[];
};

// Incremental payloads refer to earlier pending entries by id, so the map must outlive a single part.
function toPathBased(body: unknown, pending: Map<string, PendingEntry>): PathBasedPart[] {
  const payload = v02PayloadSchema.parse(body);

  for (const entry of payload.pending ?? []) {
    pending.set(entry.id, entry);
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
}

// onTimeline fires when a labelled part arrives or the state changes, not on every chunk.
// onInitialPart fires once with the first payload, which is the only one carrying response extensions such as the trace.
export async function* readDeferStream(
  response: Response,
  onTimeline?: (timeline: DeferTimeline) => void,
  onInitialPart?: (initial: PathBasedPart) => void,
): AsyncGenerator<PathBasedPart[]> {
  const chunks = await meros(response, { multiple: true });
  if (chunks instanceof Response) {
    return;
  }

  const pending = new Map<string, PendingEntry>();
  const started = performance.now();
  const arrived: DeferTimeline['arrived'] = [];
  let state: DeferTimeline['state'] = 'streaming';

  onTimeline?.({ state, arrived: [] });

  let initialReported = false;
  for await (const chunk of chunks) {
    const parts: PathBasedPart[] = [];
    for (const part of chunk) {
      if (part.json) {
        parts.push(...toPathBased(part.body, pending));
      }
    }

    if (!initialReported && parts.length > 0) {
      initialReported = true;
      onInitialPart?.(parts[0]);
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
