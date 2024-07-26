import { ConstDirectiveNode, ConstValueNode, FieldDefinitionNode, Kind, StringValueNode } from 'graphql';
import { FIELD, REQUIRES_SCOPES, SCOPES, UNION } from './string-constants';
import { invalidKeyFatalError } from '../errors/errors';
import { EnumTypeNode, InterfaceTypeNode, ObjectTypeNode, ScalarTypeNode, stringToNameNode } from '../ast/utils';
import { FieldConfiguration } from '../router-configuration/router-configuration';
import { FieldData } from '../schema-building/type-definition-data';

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

export function doSetsIntersect<T>(set: Set<T>, other: Set<T>): boolean {
  for (const entry of set) {
    if (other.has(entry)) {
      return true;
    }
  }
  return false;
}

export function subtractSourceSetFromTargetSet<T>(source: Set<T>, target: Set<T>) {
  for (const entry of source) {
    target.delete(entry);
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

export function addIterableValuesToSet<T>(source: T[] | Iterable<T>, target: Set<T>) {
  for (const value of source) {
    target.add(value);
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
    case Kind.BOOLEAN: {
      return 'boolean';
    }
    case Kind.ENUM:
    // intentional fallthrough
    case Kind.ENUM_TYPE_DEFINITION: {
      return 'enum';
    }
    case Kind.ENUM_TYPE_EXTENSION: {
      return 'enum extension';
    }
    case Kind.ENUM_VALUE_DEFINITION: {
      return 'enum value';
    }
    case Kind.FIELD_DEFINITION: {
      return FIELD;
    }
    case Kind.FLOAT: {
      return 'float';
    }
    case Kind.INPUT_OBJECT_TYPE_DEFINITION: {
      return 'input object';
    }
    case Kind.INPUT_OBJECT_TYPE_EXTENSION: {
      return 'input object extension';
    }
    case Kind.INPUT_VALUE_DEFINITION: {
      return 'input value';
    }
    case Kind.INT: {
      return 'int';
    }
    case Kind.INTERFACE_TYPE_DEFINITION: {
      return 'interface';
    }
    case Kind.INTERFACE_TYPE_EXTENSION: {
      return 'interface extension';
    }
    case Kind.NULL: {
      return 'null';
    }
    case Kind.OBJECT:
    // intentional fallthrough
    case Kind.OBJECT_TYPE_DEFINITION: {
      return 'object';
    }
    case Kind.OBJECT_TYPE_EXTENSION: {
      return 'object extension';
    }
    case Kind.STRING: {
      return 'string';
    }
    case Kind.SCALAR_TYPE_DEFINITION: {
      return 'scalar';
    }
    case Kind.SCALAR_TYPE_EXTENSION: {
      return 'scalar extension';
    }
    case Kind.UNION_TYPE_DEFINITION: {
      return UNION;
    }
    case Kind.UNION_TYPE_EXTENSION: {
      return 'union extension';
    }
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
  isInaccessible: boolean;
  originalResponseType: string;
  unimplementedArguments: Set<string>;
};

export type ImplementationErrors = {
  invalidFieldImplementations: Map<string, InvalidFieldImplementation>;
  unimplementedFields: string[];
};

export type InvalidRequiredInputValueData = {
  inputValueName: string;
  missingSubgraphs: string[];
  requiredSubgraphs: string[];
};

export type InvalidArgument = {
  argumentName: string;
  namedType: string;
  typeName: string;
  typeString: string;
};

export type SimpleFieldData = {
  name: string;
  namedTypeName: string;
};

export function fieldDatasToSimpleFieldDatas(fieldDatas: IterableIterator<FieldData>): Array<SimpleFieldData> {
  const simpleFieldDatas: Array<SimpleFieldData> = [];
  for (const { name, namedTypeName } of fieldDatas) {
    simpleFieldDatas.push({ name, namedTypeName });
  }
  return simpleFieldDatas;
}

// Only used to assess the output type of field definitions for graph selection set rendering
export function isNodeLeaf(kind?: Kind) {
  // Base scalars are not added to parent definition data
  if (!kind) {
    return true;
  }
  switch (kind) {
    case Kind.OBJECT_TYPE_DEFINITION:
    case Kind.INTERFACE_TYPE_DEFINITION:
    case Kind.UNION_TYPE_DEFINITION:
      return false;
    default:
      return true;
  }
}

export type GraphFieldData = {
  name: string;
  namedTypeName: string;
  isLeaf: boolean;
  subgraphNames: Set<string>;
};

export type EntityInterfaceSubgraphData = {
  fieldDatas: Array<SimpleFieldData>;
  interfaceFieldNames: Set<string>;
  interfaceObjectFieldNames: Set<string>;
  isInterfaceObject: boolean;
  typeName: string;
  concreteTypeNames?: Set<string>;
};

// The accumulation of all EntityInterfaceSubgraphData for the type name
export type EntityInterfaceFederationData = {
  fieldDatasBySubgraphName: Map<string, Array<SimpleFieldData>>;
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
    fieldDatasBySubgraphName: new Map<string, Array<SimpleFieldData>>().set(
      subgraphName,
      entityInterfaceData.fieldDatas,
    ),
    interfaceFieldNames: new Set<string>(entityInterfaceData.interfaceFieldNames),
    interfaceObjectFieldNames: new Set<string>(entityInterfaceData.interfaceObjectFieldNames),
    interfaceObjectSubgraphs: new Set<string>(entityInterfaceData.isInterfaceObject ? [subgraphName] : []),
    typeName: entityInterfaceData.typeName,
    ...(entityInterfaceData.isInterfaceObject
      ? {}
      : { concreteTypeNames: new Set<string>(entityInterfaceData.concreteTypeNames) }),
  };
}

// Returns true if the federation data concrete types set was mutated and false otherwise
export function upsertEntityInterfaceFederationData(
  federationData: EntityInterfaceFederationData,
  subgraphData: EntityInterfaceSubgraphData,
  subgraphName: string,
): boolean {
  federationData.fieldDatasBySubgraphName.set(subgraphName, subgraphData.fieldDatas);
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

export function getValueOrDefault<K, V>(map: Map<K, V>, key: K, constructor: () => V): V {
  const existingValue = map.get(key);
  if (existingValue) {
    return existingValue;
  }
  const value = constructor();
  map.set(key, value);
  return value;
}

export type EntityData = {
  fieldNames: Set<string>;
  keyFieldSets: Set<string>;
  subgraphNames: Set<string>;
  typeName: string;
};

export type EntityDataParams = {
  typeName: string;
  fieldNames?: Iterable<string>;
  keyFieldSets?: Iterable<string>;
  subgraphNames?: Iterable<string>;
};

export function newEntityData(params: EntityDataParams): EntityData {
  return {
    fieldNames: new Set<string>(params.fieldNames),
    keyFieldSets: new Set<string>(params.keyFieldSets),
    subgraphNames: new Set<string>(params.subgraphNames),
    typeName: params.typeName,
  };
}

function addEntityDataProperties(source: EntityData | EntityDataParams, target: EntityData) {
  addIterableValuesToSet(source.fieldNames || [], target.fieldNames);
  addIterableValuesToSet(source.keyFieldSets || [], target.keyFieldSets);
  addIterableValuesToSet(source.subgraphNames || [], target.subgraphNames);
}

export function upsertEntityDataProperties(entityDataByTypeName: Map<string, EntityData>, params: EntityDataParams) {
  const existingData = entityDataByTypeName.get(params.typeName);
  existingData
    ? addEntityDataProperties(params, existingData)
    : entityDataByTypeName.set(params.typeName, newEntityData(params));
}

export function upsertEntityData(entityDataByTypeName: Map<string, EntityData>, incomingData: EntityData) {
  const existingData = entityDataByTypeName.get(incomingData.typeName);
  existingData
    ? addEntityDataProperties(incomingData, existingData)
    : entityDataByTypeName.set(incomingData.typeName, incomingData);
}

export type FieldAuthorizationData = {
  fieldName: string;
  requiresAuthentication: boolean;
  requiredScopes: Set<string>[];
};

export function newFieldAuthorizationData(fieldName: string): FieldAuthorizationData {
  return {
    fieldName,
    requiresAuthentication: false,
    requiredScopes: [],
  };
}

export type AuthorizationData = {
  fieldAuthorizationDataByFieldName: Map<string, FieldAuthorizationData>;
  hasParentLevelAuthorization: boolean;
  requiresAuthentication: boolean;
  requiredScopes: Set<string>[];
  typeName: string;
};

export function resetAuthorizationData(authorizationData?: AuthorizationData) {
  if (!authorizationData) {
    return;
  }
  authorizationData.requiresAuthentication = false;
  authorizationData.requiredScopes = [];
  authorizationData.hasParentLevelAuthorization = false;
}

export function getAuthorizationDataToUpdate(
  authorizationContainer: AuthorizationData,
  node: EnumTypeNode | FieldDefinitionNode | InterfaceTypeNode | ObjectTypeNode | ScalarTypeNode,
  fieldName: string,
): AuthorizationData | FieldAuthorizationData {
  if (node.kind === Kind.FIELD_DEFINITION) {
    return getValueOrDefault(authorizationContainer.fieldAuthorizationDataByFieldName, fieldName, () =>
      newFieldAuthorizationData(fieldName),
    );
  }
  authorizationContainer.hasParentLevelAuthorization = true;
  return authorizationContainer;
}

export function newAuthorizationData(typeName: string): AuthorizationData {
  return {
    fieldAuthorizationDataByFieldName: new Map<string, FieldAuthorizationData>(),
    hasParentLevelAuthorization: false,
    requiresAuthentication: false,
    requiredScopes: [],
    typeName,
  };
}

export const maxOrScopes = 16;

export function mergeAuthorizationDataByAND(
  source: AuthorizationData | FieldAuthorizationData,
  target: AuthorizationData | FieldAuthorizationData,
): boolean {
  target.requiresAuthentication ||= source.requiresAuthentication;
  const sourceScopesLength = source.requiredScopes.length;
  if (sourceScopesLength < 1) {
    return true;
  }
  const targetScopesLength = target.requiredScopes.length;
  if (targetScopesLength < 1) {
    if (sourceScopesLength > maxOrScopes) {
      return false;
    }
    for (const andScopes of source.requiredScopes) {
      target.requiredScopes.push(new Set<string>(andScopes));
    }
    return true;
  }
  if (sourceScopesLength * targetScopesLength > maxOrScopes) {
    return false;
  }
  const mergedOrScopes: Set<string>[] = [];
  for (const existingAndScopes of target.requiredScopes) {
    for (const incomingAndScopes of source.requiredScopes) {
      const newAndScopes = new Set<string>(existingAndScopes);
      addIterableValuesToSet(incomingAndScopes, newAndScopes);
      mergedOrScopes.push(newAndScopes);
    }
  }
  target.requiredScopes = mergedOrScopes;
  return true;
}

export function upsertFieldAuthorizationData(
  fieldAuthorizationDataByFieldName: Map<string, FieldAuthorizationData>,
  incomingFieldAuthorizationData: FieldAuthorizationData,
): boolean {
  const fieldName = incomingFieldAuthorizationData.fieldName;
  const existingFieldAuthorizationData = fieldAuthorizationDataByFieldName.get(fieldName);
  if (!existingFieldAuthorizationData) {
    if (incomingFieldAuthorizationData.requiredScopes.length > maxOrScopes) {
      return false;
    }
    const fieldAuthorizationData = newFieldAuthorizationData(fieldName);
    fieldAuthorizationData.requiresAuthentication ||= incomingFieldAuthorizationData.requiresAuthentication;
    for (const andScopes of incomingFieldAuthorizationData.requiredScopes) {
      fieldAuthorizationData.requiredScopes.push(new Set<string>(andScopes));
    }
    fieldAuthorizationDataByFieldName.set(fieldName, fieldAuthorizationData);
    return true;
  }
  existingFieldAuthorizationData.requiresAuthentication ||= incomingFieldAuthorizationData.requiresAuthentication;
  return mergeAuthorizationDataByAND(incomingFieldAuthorizationData, existingFieldAuthorizationData);
}

export function upsertAuthorizationData(
  authorizationDataByParentTypeName: Map<string, AuthorizationData>,
  incomingAuthorizationData: AuthorizationData,
  invalidOrScopesFieldPaths: Set<string>,
) {
  const existingAuthorizationData = authorizationDataByParentTypeName.get(incomingAuthorizationData.typeName);
  if (!existingAuthorizationData) {
    authorizationDataByParentTypeName.set(incomingAuthorizationData.typeName, incomingAuthorizationData);
    return;
  }
  for (const [fieldName, fieldAuthorizationData] of incomingAuthorizationData.fieldAuthorizationDataByFieldName) {
    if (
      !upsertFieldAuthorizationData(existingAuthorizationData.fieldAuthorizationDataByFieldName, fieldAuthorizationData)
    ) {
      invalidOrScopesFieldPaths.add(`${incomingAuthorizationData.typeName}.${fieldName}`);
    }
  }
}

export function upsertAuthorizationConfiguration(
  fieldConfigurationByFieldPath: Map<string, FieldConfiguration>,
  authorizationData: AuthorizationData,
) {
  const typeName = authorizationData.typeName;
  for (const [fieldName, fieldAuthorizationData] of authorizationData.fieldAuthorizationDataByFieldName) {
    const fieldPath = `${typeName}.${fieldName}`;
    const existingFieldConfiguration = fieldConfigurationByFieldPath.get(fieldPath);
    if (existingFieldConfiguration) {
      existingFieldConfiguration.requiresAuthentication = fieldAuthorizationData.requiresAuthentication;
      existingFieldConfiguration.requiredScopes = fieldAuthorizationData.requiredScopes.map((orScopes) => [
        ...orScopes,
      ]);
    } else {
      fieldConfigurationByFieldPath.set(fieldPath, {
        argumentNames: [],
        typeName,
        fieldName,
        requiresAuthentication: fieldAuthorizationData.requiresAuthentication,
        requiredScopes: fieldAuthorizationData.requiredScopes.map((orScopes) => [...orScopes]),
      });
    }
  }
}

export function setAndGetValue<K, V>(map: Map<K, V>, key: K, value: V) {
  map.set(key, value);
  return value;
}

export function generateSimpleDirective(name: string): ConstDirectiveNode {
  return {
    kind: Kind.DIRECTIVE,
    name: stringToNameNode(name),
  };
}

export function generateRequiresScopesDirective(orScopes: Set<string>[]): ConstDirectiveNode {
  const values: ConstValueNode[] = [];
  for (const andScopes of orScopes) {
    const scopes: StringValueNode[] = [];
    for (const scope of andScopes) {
      scopes.push({
        kind: Kind.STRING,
        value: scope,
      });
    }
    values.push({ kind: Kind.LIST, values: scopes });
  }
  return {
    kind: Kind.DIRECTIVE,
    name: stringToNameNode(REQUIRES_SCOPES),
    arguments: [
      {
        kind: Kind.ARGUMENT,
        name: stringToNameNode(SCOPES),
        value: {
          kind: Kind.LIST,
          values,
        },
      },
    ],
  };
}

export function isNodeKindInterface(kind: Kind) {
  return kind === Kind.INTERFACE_TYPE_DEFINITION || kind === Kind.INTERFACE_TYPE_EXTENSION;
}

export function addMapEntries<K, V>(source: Map<K, V>, target: Map<K, V>) {
  for (const [key, value] of source) {
    target.set(key, value);
  }
}

export function getSingleSetEntry<T>(set: Set<T>): T | undefined {
  for (const entry of set) {
    return entry;
  }
}

export function add<T>(set: Set<T>, key: T): boolean {
  if (set.has(key)) {
    return false;
  }
  set.add(key);
  return true;
}
