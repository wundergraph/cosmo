import {
  EnumTypeDefinitionNode,
  FieldDefinitionNode,
  InterfaceTypeDefinitionNode,
  Kind,
  ObjectTypeDefinitionNode,
  ScalarTypeDefinitionNode,
} from 'graphql';
import { FieldConfiguration } from '../../router-configuration/router-configuration';
import {
  AuthorizationData,
  EntityData,
  EntityInterfaceSubgraphData,
  FieldAuthorizationData,
  FieldData,
  SimpleFieldData,
} from '../../schema-building/types';
import {
  BOOLEAN_SCALAR,
  ENUM,
  ENUM_VALUE,
  FIELD,
  FLOAT_SCALAR,
  INPUT_OBJECT,
  INPUT_VALUE,
  INT_SCALAR,
  INTERFACE,
  NULL,
  OBJECT,
  SCALAR,
  STRING_SCALAR,
  UNION,
} from '../../utils/string-constants';
import { addIterableValuesToSet, EntityInterfaceFederationData, getValueOrDefault } from '../../utils/utils';

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

export function kindToConvertedTypeString(kind: Kind): string {
  switch (kind) {
    case Kind.BOOLEAN: {
      return BOOLEAN_SCALAR;
    }
    case Kind.ENUM:
    // intentional fallthrough
    case Kind.ENUM_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.ENUM_TYPE_EXTENSION: {
      return ENUM;
    }
    case Kind.ENUM_VALUE_DEFINITION: {
      return ENUM_VALUE;
    }
    case Kind.FIELD_DEFINITION: {
      return FIELD;
    }
    case Kind.FLOAT: {
      return FLOAT_SCALAR;
    }
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.INPUT_OBJECT_TYPE_EXTENSION: {
      return INPUT_OBJECT;
    }
    case Kind.INPUT_VALUE_DEFINITION: {
      return INPUT_VALUE;
    }
    case Kind.INT: {
      return INT_SCALAR;
    }
    case Kind.INTERFACE_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.INTERFACE_TYPE_EXTENSION: {
      return INTERFACE;
    }
    case Kind.NULL: {
      return NULL;
    }
    case Kind.OBJECT:
    // intentional fallthrough
    case Kind.OBJECT_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.OBJECT_TYPE_EXTENSION: {
      return OBJECT;
    }
    case Kind.STRING: {
      return STRING_SCALAR;
    }
    case Kind.SCALAR_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.SCALAR_TYPE_EXTENSION: {
      return SCALAR;
    }
    case Kind.UNION_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.UNION_TYPE_EXTENSION: {
      return UNION;
    }
    default:
      return kind;
  }
}

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

export function newFieldAuthorizationData(fieldName: string): FieldAuthorizationData {
  return {
    fieldName,
    requiresAuthentication: false,
    requiredScopes: [],
  };
}

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
  node:
    | EnumTypeDefinitionNode
    | FieldDefinitionNode
    | InterfaceTypeDefinitionNode
    | ObjectTypeDefinitionNode
    | ScalarTypeDefinitionNode,
): AuthorizationData | FieldAuthorizationData {
  if (node.kind === Kind.FIELD_DEFINITION) {
    const name = node.name.value;
    return getValueOrDefault(authorizationContainer.fieldAuthorizationDataByFieldName, name, () =>
      newFieldAuthorizationData(name),
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

export function isNodeKindInterface(kind: Kind) {
  return kind === Kind.INTERFACE_TYPE_DEFINITION || kind === Kind.INTERFACE_TYPE_EXTENSION;
}

export function isNodeKindObject(kind: Kind) {
  return kind === Kind.OBJECT_TYPE_DEFINITION || kind === Kind.OBJECT_TYPE_EXTENSION;
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
