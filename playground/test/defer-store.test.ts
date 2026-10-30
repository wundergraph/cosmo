// @vitest-environment jsdom
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
  const query = fakeEditor();
  const variables = fakeEditor();
  const headers = fakeEditor();
  const store = new DeferStore();
  store.bind({ query: query.asQueryEditor, variables: variables.asQueryEditor, headers: headers.asQueryEditor });
  const [, listener] = query.editor.on.mock.calls[0];
  return { editor: query.editor, variables: variables.editor, headers: headers.editor, store, listener };
};

describe('DeferStore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('unbinding removes the change listener it registered', () => {
    const { editor, asQueryEditor } = fakeEditor();
    const store = new DeferStore();
    const unbind = store.bind({ query: asQueryEditor });
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
    store.startAnalysis({ routingUrl: 'http://a', query: '{ a @defer { b } }' });
    store.finishAnalysis({ a: 10 }, {});

    editor.getValue.mockReturnValue('{\n  a @defer {\n    b\n  }\n}  # comment');
    listener(null, { origin: '+input' });

    expect(store.snapshot.latencies).toEqual({ a: 10 });
  });

  test('an edit outside the measured fields keeps the latencies', () => {
    const { editor, store, listener } = bound();
    store.startAnalysis({ routingUrl: 'http://a', query: '{ a { b } }\n\nfragment Unused on T { x }' });
    store.finishAnalysis({ a: 10 }, {});

    editor.getValue.mockReturnValue('{ a { b } }\n\nfragment Unused on T { x y }');
    listener(null, { origin: '+input' });

    expect(store.snapshot.latencies).toEqual({ a: 10 });
  });

  test('an unrelated edit after the panel inserts @defer keeps the latencies', () => {
    const { editor, store, listener } = bound();
    store.startAnalysis({ routingUrl: 'http://a', query: '{ a { b } }\n\nfragment Unused on T { x }' });
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
    store.startAnalysis({ routingUrl: 'http://a', query: '{ a { b } }\n\nfragment Unused on T { x }' });
    store.finishAnalysis({ a: 10 }, {});

    editor.getValue.mockReturnValue('{ a { b c } }\n\nfragment Unused on T { x }');
    listener(null, { origin: '+input' });

    expect(store.snapshot.latencies).toBeNull();
  });

  test('an edit that changes the query clears the latencies', () => {
    const { editor, store, listener } = bound();
    store.startAnalysis({ routingUrl: 'http://a', query: '{ a @defer { b } }' });
    store.finishAnalysis({ a: 10 }, {});

    editor.getValue.mockReturnValue('{ a @defer { c } }');
    listener(null, { origin: '+input' });

    expect(store.snapshot.latencies).toBeNull();
  });

  test('a routing URL change clears the analysis, the same URL keeps it', () => {
    const store = new DeferStore();
    store.startAnalysis({ routingUrl: 'http://a', query: '{ a }' });
    store.finishAnalysis({ a: 10 }, {});

    store.invalidateIfUrlChanged('http://a');
    expect(store.snapshot.latencies).toEqual({ a: 10 });

    store.invalidateIfUrlChanged('http://b');
    expect(store.snapshot.latencies).toBeNull();
  });

  test.each(['variables', 'headers'] as const)('a %s edit clears the latencies', (name) => {
    const editors = bound();
    editors.store.startAnalysis({ routingUrl: 'http://a', query: '{ a }' });
    editors.store.finishAnalysis({ a: 10 }, {});

    editors[name].getValue.mockReturnValue('{ "changed": true }');
    const [, listener] = editors[name].on.mock.calls[0];
    listener(null, { origin: '+input' });

    expect(editors.store.snapshot.latencies).toBeNull();
  });

  test('each tab keeps its own analysis', () => {
    const { editor, store, listener } = bound();
    store.setTabs('one', ['one', 'two']);
    editor.getValue.mockReturnValue('{ a }');
    store.startAnalysis({ routingUrl: 'http://a', query: '{ a }' });
    store.finishAnalysis({ a: 10 }, {});

    editor.getValue.mockReturnValue('{ b }');
    listener(null, { origin: 'setValue' });
    store.setTabs('two', ['one', 'two']);
    vi.advanceTimersToNextFrame();
    expect(store.snapshot.latencies).toBeNull();

    editor.getValue.mockReturnValue('{ a }');
    listener(null, { origin: 'setValue' });
    store.setTabs('one', ['one', 'two']);
    vi.advanceTimersToNextFrame();
    expect(store.snapshot.latencies).toEqual({ a: 10 });
  });

  test("switching to a tab with the same query does not show the other tab's latencies", () => {
    const { editor, store } = bound();
    editor.getValue.mockReturnValue('{ a }');
    store.setTabs('one', ['one', 'two']);
    store.startAnalysis({ routingUrl: 'http://a', query: '{ a }' });
    store.finishAnalysis({ a: 10 }, {});

    store.setTabs('two', ['one', 'two']);

    expect(store.snapshot.latencies).toBeNull();
  });

  test('a programmatic rewrite of the query on the same tab clears the latencies', () => {
    const { editor, store, listener } = bound();
    store.setTabs('one', ['one']);
    store.startAnalysis({ routingUrl: 'http://a', query: '{ a }' });
    store.finishAnalysis({ a: 10 }, {});

    editor.getValue.mockReturnValue('{ b }');
    listener(null, { origin: 'setValue' });
    vi.advanceTimersToNextFrame();

    expect(store.snapshot.latencies).toBeNull();
  });

  test('closing a tab drops its analysis', () => {
    const { editor, store } = bound();
    editor.getValue.mockReturnValue('{ a }');
    store.setTabs('one', ['one', 'two']);
    store.startAnalysis({ routingUrl: 'http://a', query: '{ a }' });
    store.finishAnalysis({ a: 10 }, {});

    store.setTabs('two', ['two']);
    store.setTabs('one', ['one', 'two']);

    expect(store.snapshot.latencies).toBeNull();
  });

  test('a probe that finishes after a tab switch writes to the tab it started on', () => {
    const { editor, store } = bound();
    editor.getValue.mockReturnValue('{ a }');
    store.setTabs('one', ['one', 'two']);
    const tabId = store.startAnalysis({ routingUrl: 'http://a', query: '{ a }' });

    store.setTabs('two', ['one', 'two']);
    store.finishAnalysis({ a: 10 }, {}, tabId);
    expect(store.snapshot.latencies).toBeNull();

    store.setTabs('one', ['one', 'two']);
    expect(store.snapshot.latencies).toEqual({ a: 10 });
  });

  test('closing the middle of three analysed tabs keeps the other two', () => {
    const { editor, store, listener } = bound();
    const analyse = (tab: string, query: string, latency: number) => {
      editor.getValue.mockReturnValue(query);
      store.setTabs(tab, ['one', 'two', 'three']);
      store.startAnalysis({ routingUrl: 'http://a', query: query });
      store.finishAnalysis({ [query]: latency }, {});
    };
    analyse('one', '{ a }', 1);
    analyse('two', '{ b }', 2);
    analyse('three', '{ c }', 3);

    store.setTabs('two', ['one', 'two', 'three']);
    editor.getValue.mockReturnValue('{ a }');
    listener(null, { origin: 'setValue' });
    store.setTabs('one', ['one', 'three']);
    vi.advanceTimersToNextFrame();
    expect(store.snapshot.latencies).toEqual({ '{ a }': 1 });

    editor.getValue.mockReturnValue('{ c }');
    listener(null, { origin: 'setValue' });
    store.setTabs('three', ['one', 'three']);
    vi.advanceTimersToNextFrame();
    expect(store.snapshot.latencies).toEqual({ '{ c }': 3 });
  });
});
