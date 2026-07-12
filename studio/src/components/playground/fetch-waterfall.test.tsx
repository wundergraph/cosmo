/** @vitest-environment jsdom */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/insights-helpers', () => ({
  nsToTime: () => '0 ms',
}));
vi.mock('@/lib/utils', async () => {
  const { clsx } = await import('clsx');
  return { cn: clsx };
});

import { FetchWaterfall } from './fetch-waterfall';
import type { ARTFetchNode } from './types';

const completedDefer: ARTFetchNode = {
  id: 'defer-1',
  type: 'Sequence',
  children: [],
  singleFlightUsed: false,
  singleFlightSharedResponse: false,
  loadSkipped: false,
  defer: {
    id: 1,
    label: 'pricing_priceHistory',
    path: ['storefront'],
    status: 'completed',
  },
};

describe('FetchWaterfall', () => {
  it('keeps a defer status inside the Request column when the nested label is too wide', () => {
    document.body.innerHTML = renderToStaticMarkup(
      <FetchWaterfall
        fetch={completedDefer}
        level={5}
        globalDuration={1n}
        globalStartTime={0n}
        isParentDetailsOpen={false}
        paneWidth={360}
      />,
    );

    const status = [...document.querySelectorAll('div, span')].find((element) => element.textContent === 'completed');
    if (!status) {
      throw new Error('completed defer status not rendered');
    }

    expect(status.classList).toContain('shrink-0');
    expect(status.previousElementSibling?.classList).toContain('truncate');
    expect(status.closest('.border-r')?.classList).toContain('overflow-hidden');
  });
});
