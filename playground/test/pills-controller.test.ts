import { describe, expect, test, vi } from 'vitest';
import type { QueryEditor } from '../src/components/playground/defer-advisor/defer-pills-render';
import { PillController } from '../src/components/playground/defer-advisor/pills-controller';

const fakeEditor = () => {
  const editor = {
    on: vi.fn(),
    off: vi.fn(),
    getValue: vi.fn(() => ''),
    setValue: vi.fn(),
  };
  return { editor, asQueryEditor: editor as unknown as QueryEditor };
};

describe('PillController', () => {
  test('dispose removes the change listener it registered', () => {
    const { editor, asQueryEditor } = fakeEditor();
    const controller = new PillController(asQueryEditor);
    controller.dispose();

    const [, listener] = editor.on.mock.calls[0];
    expect(editor.off).toHaveBeenCalledWith('change', listener);
  });
});
