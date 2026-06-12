const EMPTY: unique symbol = Symbol('empty');

export class CompactMap<K, V> implements Map<K, V> {
  private k0: K | typeof EMPTY;
  private v0: V | undefined;
  private overflow: Map<K, V> | undefined;

  constructor(...entry: [] | [K] | [K, V]) {
    if (entry.length === 2) {
      const [key, value] = entry;
      this.k0 = key;
      this.v0 = value;
      return;
    }
    this.k0 = EMPTY;
    this.v0 = undefined;
  }

  static from<K, V>(source: Iterable<readonly [K, V]>): CompactMap<K, V> {
    const output = new CompactMap<K, V>();
    for (const [key, value] of source) {
      output.set(key, value);
    }
    return output;
  }

  static fromWithObjectValues<K, V extends object>(source: Iterable<readonly [K, V]>): CompactMap<K, V> {
    const output = new CompactMap<K, V>();
    for (const [key, value] of source) {
      output.set(key, { ...value });
    }
    return output;
  }

  get size(): number {
    return (this.k0 === EMPTY ? 0 : 1) + (this.overflow?.size ?? 0);
  }

  get [Symbol.toStringTag](): string {
    return 'Map';
  }

  clear(): void {
    this.k0 = EMPTY;
    this.v0 = undefined;
    this.overflow = undefined;
  }

  delete(key: K): boolean {
    if (this.k0 === key) {
      if (this.overflow?.size) {
        const first = this.overflow.entries().next();
        if (!first.done) {
          const [nextKey, nextValue] = first.value;
          this.overflow.delete(nextKey);
          this.k0 = nextKey;
          this.v0 = nextValue;
          if (!this.overflow.size) {
            this.overflow = undefined;
          }
          return true;
        }
      }
      this.k0 = EMPTY;
      this.v0 = undefined;
      return true;
    }
    const deleted = this.overflow?.delete(key) ?? false;
    if (deleted && !this.overflow?.size) {
      this.overflow = undefined;
    }
    return deleted;
  }

  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
    if (this.k0 !== EMPTY) {
      Reflect.apply(callbackfn, thisArg, [this.v0, this.k0, this]);
    }
    this.overflow?.forEach((value, key) => {
      Reflect.apply(callbackfn, thisArg, [value, key, this]);
    });
  }

  get(key: K): V | undefined {
    if (this.k0 === key) {
      return this.v0;
    }
    return this.overflow?.get(key);
  }

  has(key: K): boolean {
    if (this.k0 === key) {
      return true;
    }
    return this.overflow?.has(key) ?? false;
  }

  set(key: K, value: V): this {
    if (this.k0 === key) {
      this.v0 = value;
      return this;
    }
    if (this.k0 === EMPTY) {
      this.k0 = key;
      this.v0 = value;
      return this;
    }
    if (this.overflow?.has(key)) {
      this.overflow.set(key, value);
      return this;
    }
    this.overflow ??= new Map<K, V>();
    this.overflow.set(key, value);
    return this;
  }

  entries(): MapIterator<[K, V]> {
    return this.entriesIterator() as ReturnType<Map<K, V>['entries']>;
  }

  keys(): MapIterator<K> {
    return this.keysIterator() as ReturnType<Map<K, V>['keys']>;
  }

  values(): MapIterator<V> {
    return this.valuesIterator() as ReturnType<Map<K, V>['values']>;
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  private *entriesIterator(): IterableIterator<[K, V | undefined]> {
    if (this.k0 !== EMPTY) {
      yield [this.k0, this.v0];
    }
    if (this.overflow) {
      yield* this.overflow.entries();
    }
  }

  private *keysIterator(): IterableIterator<K> {
    if (this.k0 !== EMPTY) {
      yield this.k0;
    }
    if (this.overflow) {
      yield* this.overflow.keys();
    }
  }

  private *valuesIterator(): IterableIterator<V | undefined> {
    if (this.k0 !== EMPTY) {
      yield this.v0;
    }
    if (this.overflow) {
      yield* this.overflow.values();
    }
  }
}

export class CompactSet<T> implements Set<T> {
  private e0: T | typeof EMPTY;
  private overflow: Set<T> | undefined;

  constructor(...entry: [] | [T]) {
    if (entry.length === 1) {
      const [first] = entry;
      this.e0 = first;
      return;
    }
    this.e0 = EMPTY;
  }

  static from<T>(source: Iterable<T>): CompactSet<T> {
    const output = new CompactSet<T>();
    for (const value of source) {
      output.add(value);
    }
    return output;
  }

  get size(): number {
    return (this.e0 === EMPTY ? 0 : 1) + (this.overflow?.size ?? 0);
  }

  get [Symbol.toStringTag](): string {
    return 'Set';
  }

  add(value: T): this {
    if (this.e0 === value) {
      return this;
    }
    if (this.e0 === EMPTY) {
      this.e0 = value;
      return this;
    }
    if (this.overflow?.has(value)) {
      return this;
    }
    this.overflow ??= new Set<T>();
    this.overflow.add(value);
    return this;
  }

  clear(): void {
    this.e0 = EMPTY;
    this.overflow = undefined;
  }

  delete(value: T): boolean {
    if (this.e0 === value) {
      if (this.overflow?.size) {
        const first = this.overflow.values().next();
        if (!first.done) {
          const nextValue = first.value;
          this.overflow.delete(nextValue);
          this.e0 = nextValue;
          if (!this.overflow.size) {
            this.overflow = undefined;
          }
          return true;
        }
      }
      this.e0 = EMPTY;
      return true;
    }
    const deleted = this.overflow?.delete(value) ?? false;
    if (deleted && !this.overflow?.size) {
      this.overflow = undefined;
    }
    return deleted;
  }

  forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void {
    if (this.e0 !== EMPTY) {
      callbackfn.call(thisArg, this.e0, this.e0, this);
    }
    this.overflow?.forEach((value) => {
      callbackfn.call(thisArg, value, value, this);
    });
  }

  has(value: T): boolean {
    if (this.e0 === value) {
      return true;
    }
    return this.overflow?.has(value) ?? false;
  }

  entries(): SetIterator<[T, T]> {
    return this.entriesIterator() as ReturnType<Set<T>['entries']>;
  }

  keys(): SetIterator<T> {
    return this.valuesIterator() as ReturnType<Set<T>['keys']>;
  }

  values(): SetIterator<T> {
    return this.valuesIterator() as ReturnType<Set<T>['values']>;
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.values();
  }

  union<U>(other: ReadonlySetLike<U>): Set<T | U> {
    return new Set(this).union(other);
  }

  intersection<U>(other: ReadonlySetLike<U>): Set<T & U> {
    return new Set(this).intersection(other);
  }

  difference<U>(other: ReadonlySetLike<U>): Set<T> {
    return new Set(this).difference(other);
  }

  symmetricDifference<U>(other: ReadonlySetLike<U>): Set<T | U> {
    return new Set(this).symmetricDifference(other);
  }

  isSubsetOf(other: ReadonlySetLike<unknown>): boolean {
    return new Set(this).isSubsetOf(other);
  }

  isSupersetOf(other: ReadonlySetLike<unknown>): boolean {
    return new Set(this).isSupersetOf(other);
  }

  isDisjointFrom(other: ReadonlySetLike<unknown>): boolean {
    return new Set(this).isDisjointFrom(other);
  }

  private *entriesIterator(): IterableIterator<[T, T]> {
    if (this.e0 !== EMPTY) {
      yield [this.e0, this.e0];
    }
    if (this.overflow) {
      yield* this.overflow.entries();
    }
  }

  private *valuesIterator(): IterableIterator<T> {
    if (this.e0 !== EMPTY) {
      yield this.e0;
    }
    if (this.overflow) {
      yield* this.overflow.values();
    }
  }
}
