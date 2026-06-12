import 'set.prototype.difference/auto';
import { cloneDeep } from 'lodash';
import { describe, expect, test } from 'vitest';

import { CompactMap, CompactSet } from '../../src/utils/compact-collections';

describe('CompactMap', () => {
  test.each([0, 1, 3])('cloneDeep preserves entries, prototype, and independence at size %s', (size) => {
    const wrapper = new CompactMap<string, { value: number }>();
    for (let i = 0; i < size; i++) {
      wrapper.set(`k${i}`, { value: i });
    }

    const clone = cloneDeep(wrapper);

    expect(clone).toBeInstanceOf(CompactMap);
    expect([...clone]).toStrictEqual([...wrapper]);

    clone.set('clone-only', { value: 100 });
    expect(clone.get('clone-only')).toStrictEqual({ value: 100 });
    expect(wrapper.has('clone-only')).toBe(false);

    if (size > 0) {
      clone.get('k0')!.value = 200;
      expect(wrapper.get('k0')).toStrictEqual({ value: 0 });
    }
  });

  test('matches native Map for one-entry construction and reads', () => {
    const wrapper = new CompactMap<string, number>('a', 1);
    const native = new Map<string, number>([['a', 1]]);

    expect(wrapper.size).toStrictEqual(native.size);
    expect(wrapper.get('a')).toStrictEqual(native.get('a'));
    expect(wrapper.get('missing')).toStrictEqual(native.get('missing'));
    expect(wrapper.has('a')).toStrictEqual(native.has('a'));
    expect(wrapper.has('missing')).toStrictEqual(native.has('missing'));
    expect([...wrapper.entries()]).toStrictEqual([...native.entries()]);
    expect([...wrapper.keys()]).toStrictEqual([...native.keys()]);
    expect([...wrapper.values()]).toStrictEqual([...native.values()]);
    expect([...wrapper]).toStrictEqual([...native]);
    expect(Array.from(wrapper)).toStrictEqual(Array.from(native));
    expect([...new Map(wrapper)]).toStrictEqual([...native]);
    expect(wrapper.values().next()).toStrictEqual(native.values().next());
  });

  test('updates slot key in place and appends second key in native order', () => {
    const wrapper = new CompactMap<string, number>('a', 1);
    const native = new Map<string, number>([['a', 1]]);

    expect(wrapper.set('a', 2)).toStrictEqual(wrapper);
    native.set('a', 2);
    wrapper.set('b', 3);
    native.set('b', 3);

    expect(wrapper.size).toStrictEqual(native.size);
    expect([...wrapper]).toStrictEqual([...native]);
    expect([...wrapper.keys()]).toStrictEqual([...native.keys()]);
    expect([...wrapper.values()]).toStrictEqual([...native.values()]);
  });

  test('promotes first overflow entry when deleting slot key', () => {
    const wrapper = new CompactMap<string, number>('a', 1);
    const native = new Map<string, number>([['a', 1]]);
    wrapper.set('b', 2).set('c', 3);
    native.set('b', 2).set('c', 3);

    expect(wrapper.delete('a')).toStrictEqual(native.delete('a'));

    expect(wrapper.size).toStrictEqual(native.size);
    expect([...wrapper]).toStrictEqual([...native]);
    expect(wrapper.values().next()).toStrictEqual(native.values().next());
  });

  test('deletes to empty, re-adds, clears, and supports forEach', () => {
    const wrapper = new CompactMap<string, number>('a', 1);
    const native = new Map<string, number>([['a', 1]]);

    expect(wrapper.delete('a')).toStrictEqual(native.delete('a'));
    wrapper.set('b', 2);
    native.set('b', 2);

    const wrapperForEach: Array<[string, number, boolean]> = [];
    const nativeForEach: Array<[string, number, boolean]> = [];
    const thisArg = { marker: true };

    wrapper.forEach(function (value, key, map) {
      wrapperForEach.push([key, value, this === thisArg && map === wrapper]);
    }, thisArg);
    native.forEach(function (value, key, map) {
      nativeForEach.push([key, value, this === thisArg && map === native]);
    }, thisArg);

    expect(wrapper.size).toStrictEqual(native.size);
    expect([...wrapper]).toStrictEqual([...native]);
    expect(wrapperForEach).toStrictEqual(nativeForEach);

    wrapper.clear();
    native.clear();

    expect(wrapper.size).toStrictEqual(native.size);
    expect([...wrapper]).toStrictEqual([...native]);
    expect(wrapper.get('b')).toStrictEqual(native.get('b'));
    expect(wrapper.has('b')).toStrictEqual(native.has('b'));
  });

  test('matches native read methods at sizes zero, one, and two', () => {
    const wrapper = new CompactMap<string, number>();
    const native = new Map<string, number>();

    for (const [key, value] of [
      ['a', 1],
      ['b', 2],
    ] as const) {
      expect(wrapper.size).toStrictEqual(native.size);
      expect([...wrapper.entries()]).toStrictEqual([...native.entries()]);
      expect([...wrapper.keys()]).toStrictEqual([...native.keys()]);
      expect([...wrapper.values()]).toStrictEqual([...native.values()]);
      wrapper.set(key, value);
      native.set(key, value);
    }

    expect(wrapper.size).toStrictEqual(native.size);
    expect([...wrapper.entries()]).toStrictEqual([...native.entries()]);
    expect([...wrapper.keys()]).toStrictEqual([...native.keys()]);
    expect([...wrapper.values()]).toStrictEqual([...native.values()]);
  });
});

describe('CompactSet', () => {
  test.each([0, 1, 3])('cloneDeep preserves values, prototype, and independence at size %s', (size) => {
    const wrapper = new CompactSet<{ value: number }>();
    const values: Array<{ value: number }> = [];
    for (let i = 0; i < size; i++) {
      const value = { value: i };
      values.push(value);
      wrapper.add(value);
    }

    const clone = cloneDeep(wrapper);

    expect(clone).toBeInstanceOf(CompactSet);
    expect([...clone]).toStrictEqual([...wrapper]);

    const cloneOnly = { value: 100 };
    clone.add(cloneOnly);
    expect(clone.has(cloneOnly)).toBe(true);
    expect(wrapper.has(cloneOnly)).toBe(false);

    if (size > 0) {
      clone.values().next().value.value = 200;
      expect(values[0]).toStrictEqual({ value: 0 });
    }
  });

  test('matches native Set for one-entry construction and reads', () => {
    const wrapper = new CompactSet<string>('a');
    const native = new Set<string>(['a']);

    expect(wrapper.size).toStrictEqual(native.size);
    expect(wrapper.has('a')).toStrictEqual(native.has('a'));
    expect(wrapper.has('missing')).toStrictEqual(native.has('missing'));
    expect([...wrapper.entries()]).toStrictEqual([...native.entries()]);
    expect([...wrapper.keys()]).toStrictEqual([...native.keys()]);
    expect([...wrapper.values()]).toStrictEqual([...native.values()]);
    expect([...wrapper]).toStrictEqual([...native]);
    expect(Array.from(wrapper)).toStrictEqual(Array.from(native));
    expect([...new Set(wrapper)]).toStrictEqual([...native]);
    expect(wrapper.values().next()).toStrictEqual(native.values().next());
  });

  test('keeps size stable for duplicate add and appends second value in native order', () => {
    const wrapper = new CompactSet<string>('a');
    const native = new Set<string>(['a']);

    expect(wrapper.add('a')).toStrictEqual(wrapper);
    native.add('a');
    wrapper.add('b');
    native.add('b');

    expect(wrapper.size).toStrictEqual(native.size);
    expect([...wrapper]).toStrictEqual([...native]);
    expect([...wrapper.keys()]).toStrictEqual([...native.keys()]);
    expect([...wrapper.values()]).toStrictEqual([...native.values()]);
  });

  test('promotes first overflow value when deleting slot value', () => {
    const wrapper = new CompactSet<string>('a');
    const native = new Set<string>(['a']);
    wrapper.add('b').add('c');
    native.add('b').add('c');

    expect(wrapper.delete('a')).toStrictEqual(native.delete('a'));

    expect(wrapper.size).toStrictEqual(native.size);
    expect([...wrapper]).toStrictEqual([...native]);
    expect(wrapper.values().next()).toStrictEqual(native.values().next());
  });

  test('deletes to empty, re-adds, clears, and supports forEach', () => {
    const wrapper = new CompactSet<string>('a');
    const native = new Set<string>(['a']);

    expect(wrapper.delete('a')).toStrictEqual(native.delete('a'));
    wrapper.add('b');
    native.add('b');

    const wrapperForEach: Array<[string, string, boolean]> = [];
    const nativeForEach: Array<[string, string, boolean]> = [];
    const thisArg = { marker: true };

    wrapper.forEach(function (value, key, set) {
      wrapperForEach.push([key, value, this === thisArg && set === wrapper]);
    }, thisArg);
    native.forEach(function (value, key, set) {
      nativeForEach.push([key, value, this === thisArg && set === native]);
    }, thisArg);

    expect(wrapper.size).toStrictEqual(native.size);
    expect([...wrapper]).toStrictEqual([...native]);
    expect(wrapperForEach).toStrictEqual(nativeForEach);

    wrapper.clear();
    native.clear();

    expect(wrapper.size).toStrictEqual(native.size);
    expect([...wrapper]).toStrictEqual([...native]);
    expect(wrapper.has('b')).toStrictEqual(native.has('b'));
  });

  test('supports native set difference in both directions', () => {
    const wrapper = new CompactSet<string>('a').add('b');
    const native = new Set<string>(['b', 'c']);

    expect([...wrapper.difference(native)]).toStrictEqual([...new Set(['a'])]);
    expect([...native.difference(wrapper)]).toStrictEqual([...new Set(['c'])]);
  });

  test('matches native read methods at sizes zero, one, and two', () => {
    const wrapper = new CompactSet<string>();
    const native = new Set<string>();

    for (const value of ['a', 'b'] as const) {
      expect(wrapper.size).toStrictEqual(native.size);
      expect([...wrapper.entries()]).toStrictEqual([...native.entries()]);
      expect([...wrapper.keys()]).toStrictEqual([...native.keys()]);
      expect([...wrapper.values()]).toStrictEqual([...native.values()]);
      wrapper.add(value);
      native.add(value);
    }

    expect(wrapper.size).toStrictEqual(native.size);
    expect([...wrapper.entries()]).toStrictEqual([...native.entries()]);
    expect([...wrapper.keys()]).toStrictEqual([...native.keys()]);
    expect([...wrapper.values()]).toStrictEqual([...native.values()]);
  });
});
