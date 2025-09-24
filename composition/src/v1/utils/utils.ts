import { DocumentNode, Kind } from 'graphql';
import { FieldConfiguration } from '../../router-configuration/types';
import {
  AuthorizationData,
  EntityData,
  EntityInterfaceFederationData,
  EntityInterfaceSubgraphData,
  FieldAuthorizationData,
  FieldData,
  NodeData,
  ObjectDefinitionData,
  ParentDefinitionData,
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
import { addIterableValuesToSet, addSets } from '../../utils/utils';
import { KeyFieldSetData } from '../normalization/types';
import { MAX_OR_SCOPES } from './constants';
import 'core-js/modules/esnext.set.is-subset-of.v2';
import 'core-js/modules/esnext.set.is-superset-of.v2';

export function subtractSet<T>(source: Set<T>, target: Set<T>) {
  for (const entry of source) {
    target.delete(entry);
  }
}

export function mapToArrayOfValues<K, V>(map: Map<K, V>): Array<V> {
  const output: Array<V> = [];
  for (const value of map.values()) {
    output.push(value);
  }
  return output;
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
    concreteTypeNames: new Set<string>(entityInterfaceData.concreteTypeNames),
    fieldDatasBySubgraphName: new Map<string, Array<SimpleFieldData>>([[subgraphName, entityInterfaceData.fieldDatas]]),
    interfaceFieldNames: new Set<string>(entityInterfaceData.interfaceFieldNames),
    interfaceObjectFieldNames: new Set<string>(entityInterfaceData.interfaceObjectFieldNames),
    interfaceObjectSubgraphs: new Set<string>(entityInterfaceData.isInterfaceObject ? [subgraphName] : []),
    subgraphDataByTypeName: new Map<string, EntityInterfaceSubgraphData>([[subgraphName, entityInterfaceData]]),
    typeName: entityInterfaceData.typeName,
  };
}

export function upsertEntityInterfaceFederationData(
  federationData: EntityInterfaceFederationData,
  subgraphData: EntityInterfaceSubgraphData,
  subgraphName: string,
) {
  addIterableValuesToSet(subgraphData.concreteTypeNames, federationData.concreteTypeNames);
  federationData.subgraphDataByTypeName.set(subgraphName, subgraphData);
  federationData.fieldDatasBySubgraphName.set(subgraphName, subgraphData.fieldDatas);
  addIterableValuesToSet(subgraphData.interfaceFieldNames, federationData.interfaceFieldNames);
  addIterableValuesToSet(subgraphData.interfaceObjectFieldNames, federationData.interfaceObjectFieldNames);
  if (subgraphData.isInterfaceObject) {
    federationData.interfaceObjectSubgraphs.add(subgraphName);
  }
}

type NewEntityDataParams = {
  keyFieldSetDataByFieldSet: Map<string, KeyFieldSetData>;
  subgraphName: string;
  typeName: string;
};

function newEntityData({ keyFieldSetDataByFieldSet, subgraphName, typeName }: NewEntityDataParams): EntityData {
  const keyFieldSetDatasBySubgraphName = new Map<string, Map<string, KeyFieldSetData>>([
    [subgraphName, keyFieldSetDataByFieldSet],
  ]);
  const documentNodeByKeyFieldSet = new Map<string, DocumentNode>();
  for (const [keyFieldSet, { documentNode, isUnresolvable }] of keyFieldSetDataByFieldSet) {
    // Do not propagate invalid key targets
    if (isUnresolvable) {
      continue;
    }
    documentNodeByKeyFieldSet.set(keyFieldSet, documentNode);
  }
  return {
    keyFieldSetDatasBySubgraphName,
    documentNodeByKeyFieldSet,
    keyFieldSets: new Set<string>(),
    subgraphNames: new Set<string>([subgraphName]),
    typeName,
  };
}

export type UpsertEntityDataParams = {
  entityDataByTypeName: Map<string, EntityData>;
  keyFieldSetDataByFieldSet: Map<string, KeyFieldSetData>;
  subgraphName: string;
  typeName: string;
};

export function upsertEntityData({
  entityDataByTypeName,
  keyFieldSetDataByFieldSet,
  subgraphName,
  typeName,
}: UpsertEntityDataParams) {
  const existingData = entityDataByTypeName.get(typeName);
  existingData
    ? updateEntityData({ entityData: existingData, keyFieldSetDataByFieldSet, subgraphName })
    : entityDataByTypeName.set(typeName, newEntityData({ keyFieldSetDataByFieldSet, subgraphName, typeName }));
}

export type UpdateEntityDataParams = {
  entityData: EntityData;
  keyFieldSetDataByFieldSet: Map<string, KeyFieldSetData>;
  subgraphName: string;
};

export function updateEntityData({ entityData, keyFieldSetDataByFieldSet, subgraphName }: UpdateEntityDataParams) {
  entityData.subgraphNames.add(subgraphName);
  const existingKeyFieldSetDataByFieldSet = entityData.keyFieldSetDatasBySubgraphName.get(subgraphName);
  if (!existingKeyFieldSetDataByFieldSet) {
    entityData.keyFieldSetDatasBySubgraphName.set(subgraphName, keyFieldSetDataByFieldSet);
    for (const [keyFieldSet, { documentNode, isUnresolvable }] of keyFieldSetDataByFieldSet) {
      // Do not propagate invalid key targets
      if (isUnresolvable) {
        continue;
      }
      entityData.documentNodeByKeyFieldSet.set(keyFieldSet, documentNode);
    }
    return;
  }
  for (const [keyFieldSet, keyFieldSetData] of keyFieldSetDataByFieldSet) {
    // Do not propagate invalid key targets
    if (!keyFieldSetData.isUnresolvable) {
      entityData.documentNodeByKeyFieldSet.set(keyFieldSet, keyFieldSetData.documentNode);
    }
    const existingKeyFieldSetData = existingKeyFieldSetDataByFieldSet.get(keyFieldSet);
    if (existingKeyFieldSetData) {
      existingKeyFieldSetData.isUnresolvable ||= keyFieldSetData.isUnresolvable;
      continue;
    }
    existingKeyFieldSetDataByFieldSet.set(keyFieldSet, keyFieldSetData);
  }
}

export function newFieldAuthorizationData(fieldName: string): FieldAuthorizationData {
  return {
    fieldName,
    inheritedData: {
      requiredScopes: [],
      requiredScopesByOR: [],
      requiresAuthentication: false,
    },
    originalData: {
      requiredScopes: [],
      requiresAuthentication: false,
    },
  };
}

export function newAuthorizationData(typeName: string): AuthorizationData {
  return {
    fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>(),
    requiredScopes: [],
    requiredScopesByOR: [],
    requiresAuthentication: false,
    typeName,
  };
}

export function addScopes(targetORScopes: Array<Set<string>>, sourceANDScopes: Set<string>) {
  for (let i = targetORScopes.length - 1; i > -1; i--) {
    if (targetORScopes[i].isSubsetOf(sourceANDScopes)) {
      return;
    }
    if (targetORScopes[i].isSupersetOf(sourceANDScopes)) {
      targetORScopes.splice(i, 1);
    }
  }
  targetORScopes.push(sourceANDScopes);
}

export function mergeRequiredScopesByAND(
  targetScopes: Array<Set<string>>,
  sourceScopes: Array<Set<string>>,
): Array<Set<string>> {
  if (targetScopes.length < 1 || sourceScopes.length < 1) {
    for (const sourceANDScopes of sourceScopes) {
      targetScopes.push(new Set<string>(sourceANDScopes));
    }
    return targetScopes;
  }
  const mergedANDScopes: Array<Set<string>> = [];
  for (const sourceANDScopes of sourceScopes) {
    for (const targetANDScopes of targetScopes) {
      const mergedScopes = addSets(sourceANDScopes, targetANDScopes);
      addScopes(mergedANDScopes, mergedScopes);
    }
  }
  return mergedANDScopes;
}

export function mergeRequiredScopesByOR(targetScopes: Array<Set<string>>, sourceScopes: Array<Set<string>>): boolean {
  for (const sourceANDScopes of sourceScopes) {
    addScopes(targetScopes, sourceANDScopes);
  }
  return targetScopes.length <= MAX_OR_SCOPES;
}

export function upsertFieldAuthorizationData(
  fieldAuthorizationDataByFieldName: Map<string, FieldAuthorizationData>,
  incomingData: FieldAuthorizationData,
): boolean {
  const fieldName = incomingData.fieldName;
  const existingData = fieldAuthorizationDataByFieldName.get(fieldName);
  if (!existingData) {
    fieldAuthorizationDataByFieldName.set(fieldName, copyFieldAuthorizationData(incomingData));
    return true;
  }
  existingData.inheritedData.requiresAuthentication ||= incomingData.inheritedData.requiresAuthentication;
  existingData.originalData.requiresAuthentication ||= incomingData.originalData.requiresAuthentication;
  if (
    !mergeRequiredScopesByOR(
      existingData.inheritedData.requiredScopesByOR,
      incomingData.inheritedData.requiredScopes,
    ) ||
    existingData.inheritedData.requiredScopes.length * incomingData.inheritedData.requiredScopes.length >
      MAX_OR_SCOPES ||
    existingData.originalData.requiredScopes.length * incomingData.originalData.requiredScopes.length > MAX_OR_SCOPES
  ) {
    return false;
  }
  existingData.inheritedData.requiredScopes = mergeRequiredScopesByAND(
    existingData.inheritedData.requiredScopes,
    incomingData.inheritedData.requiredScopes,
  );
  existingData.originalData.requiredScopes = mergeRequiredScopesByAND(
    existingData.originalData.requiredScopes,
    incomingData.originalData.requiredScopes,
  );
  return true;
}

function copyFieldAuthorizationDataByFieldName(
  source: Map<string, FieldAuthorizationData>,
): Map<string, FieldAuthorizationData> {
  const target = new Map<string, FieldAuthorizationData>();
  for (const [fieldName, data] of source) {
    target.set(fieldName, copyFieldAuthorizationData(data));
  }
  return target;
}

function copyFieldAuthorizationData(data: FieldAuthorizationData): FieldAuthorizationData {
  return {
    fieldName: data.fieldName,
    inheritedData: {
      requiredScopes: [...data.inheritedData.requiredScopes],
      requiredScopesByOR: [...data.inheritedData.requiredScopes],
      requiresAuthentication: data.inheritedData.requiresAuthentication,
    },
    originalData: {
      requiredScopes: [...data.originalData.requiredScopes],
      requiresAuthentication: data.originalData.requiresAuthentication,
    },
  };
}

function copyAuthorizationData(data: AuthorizationData): AuthorizationData {
  return {
    fieldAuthDataByFieldName: copyFieldAuthorizationDataByFieldName(data.fieldAuthDataByFieldName),
    requiredScopes: [...data.requiredScopes],
    requiredScopesByOR: [...data.requiredScopes],
    requiresAuthentication: data.requiresAuthentication,
    typeName: data.typeName,
  };
}

export function upsertAuthorizationData(
  authorizationDataByParentTypeName: Map<string, AuthorizationData>,
  incomingData: AuthorizationData,
  invalidORScopesCoords: Set<string>,
) {
  const existingData = authorizationDataByParentTypeName.get(incomingData.typeName);
  if (!existingData) {
    authorizationDataByParentTypeName.set(incomingData.typeName, copyAuthorizationData(incomingData));
    return;
  }
  existingData.requiresAuthentication ||= incomingData.requiresAuthentication;
  if (
    !mergeRequiredScopesByOR(existingData.requiredScopesByOR, incomingData.requiredScopes) ||
    existingData.requiredScopes.length * incomingData.requiredScopes.length > MAX_OR_SCOPES
  ) {
    invalidORScopesCoords.add(incomingData.typeName);
  } else {
    existingData.requiredScopes = mergeRequiredScopesByAND(existingData.requiredScopes, incomingData.requiredScopes);
  }
  for (const [fieldName, fieldAuthData] of incomingData.fieldAuthDataByFieldName) {
    if (!upsertFieldAuthorizationData(existingData.fieldAuthDataByFieldName, fieldAuthData)) {
      invalidORScopesCoords.add(`${incomingData.typeName}.${fieldName}`);
    }
  }
}

export function upsertAuthorizationConfiguration(
  fieldConfigurationByFieldCoords: Map<string, FieldConfiguration>,
  authorizationData: AuthorizationData,
) {
  const typeName = authorizationData.typeName;
  for (const [fieldName, fieldAuthData] of authorizationData.fieldAuthDataByFieldName) {
    const fieldCoords = `${typeName}.${fieldName}`;
    const existingConfig = fieldConfigurationByFieldCoords.get(fieldCoords);
    if (existingConfig) {
      existingConfig.requiresAuthentication = fieldAuthData.inheritedData.requiresAuthentication;
      existingConfig.requiredScopes = fieldAuthData.inheritedData.requiredScopes.map((orScopes) => [...orScopes]);
      existingConfig.requiredScopesByOR = fieldAuthData.inheritedData.requiredScopesByOR.map((orScopes) => [
        ...orScopes,
      ]);
    } else {
      fieldConfigurationByFieldCoords.set(fieldCoords, {
        argumentNames: [],
        typeName,
        fieldName,
        requiresAuthentication: fieldAuthData.inheritedData.requiresAuthentication,
        requiredScopes: fieldAuthData.inheritedData.requiredScopes.map((orScopes) => [...orScopes]),
        requiredScopesByOR: fieldAuthData.inheritedData.requiredScopesByOR.map((orScopes) => [...orScopes]),
      });
    }
  }
}

export function isNodeKindObject(kind: Kind) {
  return kind === Kind.OBJECT_TYPE_DEFINITION || kind === Kind.OBJECT_TYPE_EXTENSION;
}

export function isObjectDefinitionData(data?: ParentDefinitionData): data is ObjectDefinitionData {
  if (!data) {
    return false;
  }
  return data.kind === Kind.OBJECT_TYPE_DEFINITION;
}

export function getNodeCoords(data: NodeData): string {
  switch (data.kind) {
    case Kind.ARGUMENT:
    // Intentional fallthrough
    case Kind.FIELD_DEFINITION:
    // Intentional fallthrough
    case Kind.INPUT_VALUE_DEFINITION:
    // Intentional fallthrough
    case Kind.ENUM_VALUE_DEFINITION: {
      return data.federatedCoords;
    }
    default: {
      return data.name;
    }
  }
}
