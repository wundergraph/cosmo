import { Kind } from 'graphql';
import { FIELD, UNION } from './string-constants';
import { MultiGraph } from 'graphology';
import { invalidKeyFatalError } from '../errors/errors';

export function areSetsEqual<T>(set: Set<T>, other: Set<T>): boolean {
  if (set.size !== other.size) {
    return false;
  }
  for (const entry of set) {
    if (!other.has(entry)) {
      return false;
    }
  }
  return true;
}

export function getAllMutualEntries<T>(set: Set<T>, other: Set<T>): Set<T> {
  const mutualEntries: Set<T> = new Set<T>();
  for (const entry of set) {
    if (other.has(entry)) {
      mutualEntries.add(entry);
    }
  }
  return mutualEntries;
}

export function getOrThrowError<K, V>(map: Map<K, V>, key: K, mapName: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw  invalidKeyFatalError(key, mapName);
  }
  return value;
}

export function getAllSetDisparities<T>(set: Set<T>, other: Set<T>): T[] {
  const otherCopy = new Set<T>(other);
  const disparities: T[] = [];
  for (const entry of set) {
    if (!otherCopy.delete(entry)) {
      disparities.push(entry);
    }
  }
  for (const entry of otherCopy) {
    disparities.push(entry);
  }
  return disparities;
}

export function getEntriesNotInHashSet<T>(iterable: Iterable<T>, comparison: Set<T> | Map<T, any>): T[] {
  const disparities: T[] = [];
  for (const entry of iterable) {
    if (!comparison.has(entry)) {
      disparities.push(entry);
    }
  }
  return disparities;
}

export function doSetsHaveAnyOverlap<T>(set: Set<T>, other: Set<T>): boolean {
  for (const entry of set) {
    if (other.has(entry)) {
      return true;
    }
  }
  return false;
}

export function mapToArrayOfValues<K, V>(map: Map<K, V>): V[] {
  const output: V[] = [];
  for (const value of map.values()) {
    output.push(value);
  }
  return output;
}

export function numberToOrdinal(num: number): string {
  const numString = num.toString();
  const lastNumber = numString[numString.length - 1];
  switch (lastNumber) {
    case '1':
      return `${numString}st`;
    case '2':
      return `${numString}nd`;
    case '3':
      return `${numString}rd`;
    default:
      return `${numString}th`;
  }
}

export function addIterableValuesToSet<T>(iterable: T[] | Iterable<T>, set: Set<T>) {
  for (const value of iterable) {
    set.add(value);
  }
}

export function kindToTypeString(kind: Kind): string {
  switch (kind) {
    case Kind.ENUM_TYPE_DEFINITION:
      return 'enum';
    case Kind.ENUM_TYPE_EXTENSION:
      return 'enum extension';
    case Kind.FIELD_DEFINITION:
      return FIELD;
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
      return 'input object';
    case Kind.INPUT_OBJECT_TYPE_EXTENSION:
      return 'input object extension';
    case Kind.INPUT_VALUE_DEFINITION:
      return 'input value';
    case Kind.INTERFACE_TYPE_DEFINITION:
      return 'interface';
    case Kind.INTERFACE_TYPE_EXTENSION:
      return 'interface extension';
    case Kind.OBJECT_TYPE_DEFINITION:
      return 'object';
    case Kind.OBJECT_TYPE_EXTENSION:
      return 'object extension';
    case Kind.SCALAR_TYPE_DEFINITION:
      return 'scalar';
    case Kind.SCALAR_TYPE_EXTENSION:
      return 'scalar extension';
    case Kind.UNION_TYPE_DEFINITION:
      return UNION;
    case Kind.UNION_TYPE_EXTENSION:
      return 'union extension';
    default:
      return kind;
  }
}

export type InvalidArgumentImplementation = {
  actualType: string;
  argumentName: string;
  expectedType: string;
};

export type InvalidFieldImplementation = {
  implementedResponseType?: string;
  invalidAdditionalArguments: Set<string>;
  invalidImplementedArguments: InvalidArgumentImplementation[];
  originalResponseType: string;
  unimplementedArguments: Set<string>;
}

export type ImplementationErrors = {
  invalidFieldImplementations: Map<string, InvalidFieldImplementation>;
  unimplementedFields: string[];
};

export type ImplementationErrorsMap = Map<string, ImplementationErrors>;

export type InvalidRequiredArgument = {
  argumentName: string;
  missingSubgraphs: string[];
  requiredSubgraphs: string[];
};

export type InvalidArgument = {
  argumentName: string;
  namedType: string;
  typeName: string;
  typeString: string;
};

class StackSet {
  set = new Set<string>();
  stack: string[] = [];

  constructor(value: string) {
    this.push(value);
  }

  has(value: string): boolean {
    return this.set.has(value);
  }

  push(value: string) {
    this.stack.push(value);
    this.set.add(value);
  }

  pop() {
    const value = this.stack.pop();
    if (value) {
      this.set.delete(value);
    }
  };
}

export function hasSimplePath(graph: MultiGraph, source: string, target: string): boolean {
  if (!graph.hasNode(source) || !graph.hasNode(target)) {
    return false;
  }

  const stack = [graph.outboundNeighbors(source)];
  const visited = new StackSet(source);
  let children, child;

  while (stack.length > 0) {
    children = stack[stack.length - 1];
    child = children.pop();

    if (!child) {
      stack.pop();
      visited.pop();
      continue;
    }
    if (visited.has(child)) {
      continue;
    }

    if (child === target) {
      return true;
    }

    visited.push(child);

    if (!visited.has(target)) {
      stack.push(graph.outboundNeighbors(child));
    } else {
      visited.pop();
    }
  }
  return false;
}

export function getValueOrDefault<K, V>(map: Map<K, V>, key: K, constructor: () => V): V {
  const existingValue = map.get(key);
  if (existingValue) {
    return existingValue;
  }
  const value = constructor();
  map.set(key, value);
  return value;
}