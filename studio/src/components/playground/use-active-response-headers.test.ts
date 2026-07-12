import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useActiveResponseHeaders } from './use-active-response-headers';

describe('useActiveResponseHeaders', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('switches headers when two tabs have the same response', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    let currentHeaders: string | undefined;
    const Harness = ({ activeHeader, activeResponse }: { activeHeader: string; activeResponse: string }) => {
      currentHeaders = useActiveResponseHeaders(activeResponse, activeHeader);
      return null;
    };
    const response = '{"data":{"same":true}}';

    await act(async () => {
      root.render(createElement(Harness, { activeHeader: '{"X-Tab":"A"}', activeResponse: response }));
    });
    expect(currentHeaders).toBe('{"X-Tab":"A"}');

    await act(async () => {
      root.render(createElement(Harness, { activeHeader: '{"X-Tab":"B"}', activeResponse: response }));
    });
    expect(currentHeaders).toBe('{"X-Tab":"B"}');

    await act(async () => root.unmount());
  });
});
