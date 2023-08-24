import { Kind, TypeNode } from 'graphql';

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

export function getOrThrowError<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Expected the key ${key} to exist in map ${map}.`); // TODO
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
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
      return 'input object';
    case Kind.INPUT_OBJECT_TYPE_EXTENSION:
      return 'input object extension';
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
      return 'union';
    case Kind.UNION_TYPE_EXTENSION:
      return 'union extension';
    default:
      return kind;
  }
}

export function isTypeValidImplementation(originalType: TypeNode, implementationType: TypeNode): boolean {
  if (originalType.kind === Kind.NON_NULL_TYPE) {
    if (implementationType.kind !== Kind.NON_NULL_TYPE) {
      return false;
    }
    return isTypeValidImplementation(originalType.type, implementationType.type);
  }
  if (implementationType.kind === Kind.NON_NULL_TYPE) {
    return isTypeValidImplementation(originalType, implementationType.type);
  }
  switch (originalType.kind) {
    case Kind.NAMED_TYPE:
      if (implementationType.kind === Kind.NAMED_TYPE) {
        return originalType.name.value === implementationType.name.value;
      }
      return false;
    default:
      if (implementationType.kind === Kind.LIST_TYPE) {
        return isTypeValidImplementation(originalType.type, implementationType.type);
      }
      return false;
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