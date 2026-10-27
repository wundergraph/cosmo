import { describe, expect, test, vi } from 'vitest';
import type { QueryEditor } from '../src/components/playground/defer-advisor/defer-pills-render';
import { DeferController } from '../src/components/playground/defer-advisor/defer-controller';

const fakeEditor = () => {
  const editor = {
    on: vi.fn(),
    off: vi.fn(),
    getValue: vi.fn(() => ''),
    setValue: vi.fn(),
  };
  return { editor, asQueryEditor: editor as unknown as QueryEditor };
};

describe('DeferController', () => {
  test('dispose removes the change listener it registered', () => {
    const { editor, asQueryEditor } = fakeEditor();
    const controller = new DeferController(asQueryEditor);
    controller.dispose();

    const [, listener] = editor.on.mock.calls[0];
    expect(editor.off).toHaveBeenCalledWith('change', listener);
  });

  test('a manual edit clears the latencies and failures', () => {
    const { editor, asQueryEditor } = fakeEditor();
    const controller = new DeferController(asQueryEditor);
    controller.finishAnalysis({ a: 10 }, { b: 'boom' });

    const [, listener] = editor.on.mock.calls[0];
    listener();

    expect(controller.snapshot.latencies).toBeNull();
    expect(controller.snapshot.probeFailures).toEqual({});
  });

  test('a write from the panel keeps the latencies', () => {
    // The write schedules a repaint, which needs a frame callback the Node test environment does not have.
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const { editor, asQueryEditor } = fakeEditor();
    const controller = new DeferController(asQueryEditor);
    controller.finishAnalysis({ a: 10 }, {});

    // The editor fires its change event synchronously inside setValue, which is the case writeQuery exists for.
    const [, listener] = editor.on.mock.calls[0];
    editor.setValue.mockImplementation(() => listener());
    controller.writeQuery('{ a @defer }');

    expect(controller.snapshot.latencies).toEqual({ a: 10 });
  });
});
