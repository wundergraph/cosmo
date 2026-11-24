import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useEmbedTheme } from '@/hooks/use-embed-theme';

const router = vi.hoisted(() => ({ current: { query: {} as Record<string, string> } }));

vi.mock('next/router', () => ({ useRouter: () => router.current }));

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('The theme of a page Hub frames', () => {
  test('is the theme Hub asks for', async () => {
    router.current = { query: { embed: '1', theme: 'dark' } };
    const { result } = renderHook(() => useEmbedTheme());

    await waitFor(() => expect(result.current).toBe('dark'));
  });

  test('stays Hub’s theme after the framed page navigates to a URL without it', async () => {
    router.current = { query: { embed: '1', theme: 'dark' } };
    const { result, rerender } = renderHook(() => useEmbedTheme());
    await waitFor(() => expect(result.current).toBe('dark'));

    router.current = { query: { embed: '1' } };
    rerender();

    await waitFor(() => expect(result.current).toBe('dark'));
  });

  test('is left to Studio outside Hub’s frame', async () => {
    router.current = { query: { theme: 'dark' } };
    const { result } = renderHook(() => useEmbedTheme());

    await waitFor(() => expect(result.current).toBeUndefined());
  });
});
