import { Kind } from 'graphql';
import { FIELD, UNION } from './string-constants';
import { MultiGraph } from 'graphology';
import {
  abstractTypeInKeyFieldSetErrorMessage,
  argumentsInKeyFieldSetErrorMessage,
  duplicateFieldInFieldSetErrorMessage,
  inlineFragmentInFieldSetErrorMessage,
  invalidKeyDirectivesError,
  invalidKeyFatalError,
  invalidSelectionSetDefinitionErrorMessage,
  invalidSelectionSetErrorMessage,
  undefinedFieldInFieldSetErrorMessage,
  unexpectedArgumentErrorMessage,
  unknownTypeInFieldSetErrorMessage,
  unparsableFieldSetErrorMessage,
  unparsableFieldSetSelectionErrorMessage,
} from '../errors/errors';
import { NormalizationFactory } from '../normalization/normalization-factory';
import { ConfigurationData, RequiredFieldConfiguration } from '../subgraph/router-configuration';
import { isKindAbstract, safeParse } from '../ast/utils';
import { BREAK, visit } from 'graphql/index';
import { getNamedTypeForChild } from '../type-merging/type-merging';
import { BASE_SCALARS } from './constants';
import { getNormalizedFieldSet, ObjectLikeContainer } from '../normalization/utils';

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
    throw invalidKeyFatalError(key, mapName);
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

export function subtractSourceSetFromTargetSet<T>(source: Set<T>, target: Set<T>) {
  for (const entry of source) {
    if (target.has(entry)) {
      target.delete(entry);
    }
  }
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

export function addSetsAndReturnMutationBoolean<T>(source: Set<T>, target: Set<T>): boolean {
  let wasMutated = false;
  for (const entry of source) {
    if (target.has(entry)) {
      continue;
    }
    wasMutated = true;
    target.add(entry);
  }
  return wasMutated;
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
};

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

export type EntityInterfaceSubgraphData = {
  interfaceFieldNames: Set<string>;
  interfaceObjectFieldNames: Set<string>;
  isInterfaceObject: boolean;
  typeName: string;
  concreteTypeNames?: Set<string>;
};

// The accumulation of all EntityInterfaceSubgraphData for the type name
export type EntityInterfaceFederationData = {
  interfaceFieldNames: Set<string>;
  interfaceObjectFieldNames: Set<string>;
  interfaceObjectSubgraphs: Set<string>;
  typeName: string;
  concreteTypeNames?: Set<string>;
};

export function newEntityInterfaceFederationData(
  entityInterfaceData: EntityInterfaceSubgraphData,
  subgraphName: string,
): EntityInterfaceFederationData {
  return {
    concreteTypeNames: new Set<string>(entityInterfaceData.concreteTypeNames),
    interfaceFieldNames: new Set<string>(entityInterfaceData.interfaceFieldNames),
    interfaceObjectFieldNames: new Set<string>(entityInterfaceData.interfaceObjectFieldNames),
    interfaceObjectSubgraphs: new Set<string>(entityInterfaceData.isInterfaceObject ? [subgraphName] : []),
    typeName: entityInterfaceData.typeName,
  };
}

// Returns true if the federation data concrete types set was mutated and false otherwise
export function upsertEntityInterfaceFederationData(
  federationData: EntityInterfaceFederationData,
  subgraphData: EntityInterfaceSubgraphData,
  subgraphName: string,
): boolean {
  addIterableValuesToSet(subgraphData.interfaceFieldNames, federationData.interfaceFieldNames);
  addIterableValuesToSet(subgraphData.interfaceObjectFieldNames, federationData.interfaceObjectFieldNames);
  // interface objects should not define any concrete types
  if (subgraphData.isInterfaceObject) {
    federationData.interfaceObjectSubgraphs.add(subgraphName);
    return false;
  }
  // the concreteTypeNames set is null if only interfaceObjects have been encountered
  if (!federationData.concreteTypeNames) {
    federationData.concreteTypeNames = new Set<string>(subgraphData.concreteTypeNames);
    return false;
  }
  // entity interface concrete types should be consistent
  return addSetsAndReturnMutationBoolean(
    subgraphData.concreteTypeNames || new Set<string>(),
    federationData.concreteTypeNames,
  );
}

export type InvalidEntityInterface = {
  subgraphName: string;
  concreteTypeNames: Set<string>;
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
  }
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
      continue;
    }
    if (visited.has(child)) {
      continue;
    }

    if (child === target) {
      return true;
    }

    visited.push(child);

    const outboundNeighbours = graph.outboundNeighbors(child);
    if (outboundNeighbours.length < 0) {
      continue;
    }
    stack.push(outboundNeighbours);
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

export type EntityContainer = {
  fieldNames: Set<string>;
  keyFieldSets: Set<string>;
  subgraphNames: Set<string>;
  typeName: string;
};

export type EntityContainerByTypeName = Map<string, EntityContainer>;

export type EntityContainerParams = {
  typeName: string;
  fieldNames?: Iterable<string>;
  keyFieldSets?: Iterable<string>;
  subgraphNames?: Iterable<string>;
};

export function newEntityContainer(params: EntityContainerParams): EntityContainer {
  return {
    fieldNames: new Set<string>(params.fieldNames),
    keyFieldSets: new Set<string>(params.keyFieldSets),
    subgraphNames: new Set<string>(params.subgraphNames),
    typeName: params.typeName,
  };
}

function addEntityContainerProperties(source: EntityContainer  | EntityContainerParams, target: EntityContainer) {
  addIterableValuesToSet(source.fieldNames || [], target.fieldNames);
  addIterableValuesToSet(source.keyFieldSets || [], target.keyFieldSets);
  addIterableValuesToSet(source.subgraphNames || [], target.subgraphNames);
}

export function upsertEntityContainerProperties(
  entityContainersByTypeName: EntityContainerByTypeName,
  params: EntityContainerParams
) {
  const existingEntityContainer = entityContainersByTypeName.get(params.typeName);
  if (existingEntityContainer) {
    addEntityContainerProperties(params, existingEntityContainer);
    return;
  }
  entityContainersByTypeName.set(params.typeName, newEntityContainer(params));
}

export function upsertEntityContainer(
  entityContainersByTypeName: EntityContainerByTypeName,
  entityContainer: EntityContainer,
) {
  const existingEntityContainer = entityContainersByTypeName.get(entityContainer.typeName);
  if (!existingEntityContainer) {
    entityContainersByTypeName.set(entityContainer.typeName, entityContainer);
    return;
  }
  addEntityContainerProperties(entityContainer, existingEntityContainer);
}