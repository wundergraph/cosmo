import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { z } from 'zod';
import { useZodForm } from '../hooks/use-form';

test('submits parsed output and reports field errors with Zod v4', async () => {
  const schema = z.object({
    name: z.string().trim().min(1, 'Name is required'),
    count: z.string().transform(Number),
    labels: z.array(z.string()).default([]),
  });
  const submitted = vi.fn();
  const invalid = vi.fn();
  function Form() {
    const form = useZodForm({ schema, defaultValues: { name: '  Ada  ', count: '42' } });
    return (
      <form onSubmit={form.handleSubmit(submitted, invalid)}>
        <button type="button" onClick={() => form.setValue('name', ' ')}>
          Clear
        </button>
      </form>
    );
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Form />));
    await act(async () =>
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(submitted.mock.calls[0][0]).toEqual({ name: 'Ada', count: 42, labels: [] });
    await act(async () => container.querySelector('button')!.click());
    await act(async () =>
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(invalid.mock.calls[0][0]).toMatchObject({ name: { message: 'Name is required' } });
  } finally {
    await act(async () => root.unmount());
  }
});
