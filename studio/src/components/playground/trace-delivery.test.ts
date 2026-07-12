import { describe, expect, it } from 'vitest';

import { getTraceDeliveryNotice } from './trace-delivery';

describe('getTraceDeliveryNotice', () => {
  it('distinguishes waiting, partial, complete, and interrupted traces', () => {
    expect(getTraceDeliveryNotice({ phase: 'streaming', hasTrace: false })?.kind).toBe('waiting');
    expect(getTraceDeliveryNotice({ phase: 'streaming', hasTrace: true })?.kind).toBe('partial');
    expect(getTraceDeliveryNotice({ phase: 'complete', hasTrace: true })).toBeUndefined();
    expect(getTraceDeliveryNotice({ phase: 'incomplete', hasTrace: true })?.kind).toBe('incomplete');
    expect(getTraceDeliveryNotice({ phase: 'cancelled', hasTrace: false })?.kind).toBe('incomplete');
  });

  it('does not label a terminal single-frame or all-pruned result as partial', () => {
    expect(getTraceDeliveryNotice({ phase: 'streaming', hasTrace: true, hasNext: false })).toBeUndefined();
  });
});
