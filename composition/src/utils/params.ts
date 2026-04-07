export type AddToSetParams<T> = {
  source: Iterable<T>;
  target: Set<T>;
};

export type AddOptionalToSetParams<T> = {
  target: Set<T>;
  source?: Iterable<T>;
};

export type AddMapEntriesParams<K, V> = {
  source: Map<K, V>;
  target: Map<K, V>;
};
