import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { QueryEditor } from '../src/components/playground/defer-advisor/defer-pills-render';
import { DeferStore } from '../src/components/playground/defer-advisor/defer-store';

const fakeEditor = () => {
  const doc = { replaceRange: vi.fn() };
  const editor = {
    on: vi.fn(),
    off: vi.fn(),
    getValue: vi.fn(() => ''),
    getDoc: vi.fn(() => doc),
    setValue: vi.fn(),
  };
  return { editor, asQueryEditor: editor as unknown as QueryEditor };
};

const bound = () => {
  const { editor, asQueryEditor } = fakeEditor();
  const store = new DeferStore();
  store.bind(asQueryEditor);
  const [, listener] = editor.on.mock.calls[0];
  return { editor, store, listener };
};

describe('DeferStore', () => {
  beforeEach(() => {
    // Writes schedule a repaint, which needs a frame callback the Node test environment does not have.
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('unbinding removes the change listener it registered', () => {
    const { editor, asQueryEditor } = fakeEditor();
    const store = new DeferStore();
    const unbind = store.bind(asQueryEditor);
    unbind();

    const [, listener] = editor.on.mock.calls[0];
    expect(editor.off).toHaveBeenCalledWith('change', listener);
  });

  test('a manual edit clears the latencies and failures', () => {
    const { store, listener } = bound();
    store.finishAnalysis({ a: 10 }, { b: 'boom' });

    listener(null, { origin: '+input' });

    expect(store.snapshot.latencies).toBeNull();
    expect(store.snapshot.probeFailures).toEqual({});
  });

  test('a write from the panel keeps the latencies', () => {
    const { editor, store, listener } = bound();
    store.finishAnalysis({ a: 10 }, {});

    editor.getDoc().replaceRange.mockImplementation((_text, _from, _to, origin) => listener(null, { origin }));
    store.writeQuery('{ a @defer }');

    expect(store.snapshot.latencies).toEqual({ a: 10 });
  });

  test('a manual edit clears a stale error even when there are no latencies', () => {
    const { store, listener } = bound();
    store.failAnalysis('boom');

    listener(null, { origin: '+input' });

    expect(store.snapshot.error).toBeNull();
  });

  test('a formatting-only edit keeps the latencies', () => {
    const { editor, store, listener } = bound();
    store.startAnalysis('http://a', null, '{ a @defer { b } }');
    store.finishAnalysis({ a: 10 }, {});

    editor.getValue.mockReturnValue('{\n  a @defer {\n    b\n  }\n}  # comment');
    listener(null, { origin: '+input' });

    expect(store.snapshot.latencies).toEqual({ a: 10 });
  });

  test('an edit outside the measured fields keeps the latencies', () => {
    const { editor, store, listener } = bound();
    store.startAnalysis('http://a', null, '{ a { b } }\n\nfragment Unused on T { x }');
    store.finishAnalysis({ a: 10 }, {});

    editor.getValue.mockReturnValue('{ a { b } }\n\nfragment Unused on T { x y }');
    listener(null, { origin: '+input' });

    expect(store.snapshot.latencies).toEqual({ a: 10 });
  });

  test('an unrelated edit after a panel write keeps the latencies', () => {
    const { editor, store, listener } = bound();
    store.startAnalysis('http://a', null, '{ a { b } }\n\nfragment Unused on T { x }');
    store.finishAnalysis({ a: 10 }, {});

    // The panel adds @defer inside the measured field, which changes what gets probed.
    editor.getValue.mockReturnValue('{ a @defer { b } }\n\nfragment Unused on T { x }');
    listener(null, { origin: 'defer-advisor' });

    editor.getValue.mockReturnValue('{ a @defer { b } }\n\nfragment Unused on T { x y }');
    listener(null, { origin: '+input' });

    expect(store.snapshot.latencies).toEqual({ a: 10 });
  });

  test('an edit inside a measured field clears the latencies', () => {
    const { editor, store, listener } = bound();
    store.startAnalysis('http://a', null, '{ a { b } }\n\nfragment Unused on T { x }');
    store.finishAnalysis({ a: 10 }, {});

    editor.getValue.mockReturnValue('{ a { b c } }\n\nfragment Unused on T { x }');
    listener(null, { origin: '+input' });

    expect(store.snapshot.latencies).toBeNull();
  });

  test('an edit that changes the query clears the latencies', () => {
    const { editor, store, listener } = bound();
    store.startAnalysis('http://a', null, '{ a @defer { b } }');
    store.finishAnalysis({ a: 10 }, {});

    editor.getValue.mockReturnValue('{ a @defer { c } }');
    listener(null, { origin: '+input' });

    expect(store.snapshot.latencies).toBeNull();
  });

  test('a routing URL change clears the analysis, the same URL keeps it', () => {
    const store = new DeferStore();
    store.startAnalysis('http://a', null, '{ a }');
    store.finishAnalysis({ a: 10 }, {});

    store.invalidateIfUrlChanged('http://a');
    expect(store.snapshot.latencies).toEqual({ a: 10 });

    store.invalidateIfUrlChanged('http://b');
    expect(store.snapshot.latencies).toBeNull();
  });
});
