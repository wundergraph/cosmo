import {
  ConstDirectiveNode,
  FieldDefinitionNode,
  InterfaceTypeDefinitionNode,
  InterfaceTypeExtensionNode,
  Kind,
  NamedTypeNode,
  NameNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  OperationTypeNode,
  StringValueNode,
  UnionTypeExtensionNode,
} from 'graphql';
import {
  MutableEnumValueDefinitionNode,
  MutableFieldDefinitionNode,
  MutableInputValueDefinitionNode,
  MutableTypeDefinitionNode,
  ObjectLikeTypeDefinitionNode,
} from './ast';
import {
  ENUM_UPPER,
  ENUM_VALUE_UPPER,
  EXTENDS,
  EXTERNAL,
  FIELD_DEFINITION_UPPER,
  FIELDS,
  FRAGMENT_DEFINITION_UPPER,
  FRAGMENT_SPREAD_UPPER,
  INLINE_FRAGMENT_UPPER,
  INPUT_FIELD_DEFINITION_UPPER,
  INPUT_OBJECT_UPPER,
  INTERFACE_UPPER,
  KEY,
  MUTATION,
  NAME,
  OBJECT_UPPER, OVERRIDE,
  QUERY,
  RESOLVABLE,
  SCALAR_UPPER,
  SCHEMA_UPPER,
  SHAREABLE,
  SUBSCRIPTION,
  UNION_UPPER,
} from '../utils/string-constants';
import {
  duplicateInterfaceError,
  expectedEntityError,
  invalidClosingBraceErrorMessage,
  invalidEntityKeyError,
  invalidGraphQLNameErrorMessage,
  invalidKeyDirectiveArgumentErrorMessage,
  invalidKeyDirectiveError,
  invalidNestingClosureErrorMessage,
  invalidNestingErrorMessage,
  invalidOpeningBraceErrorMessage,
  undefinedRequiredArgumentsErrorMessage,
  unexpectedDirectiveArgumentErrorMessage,
  unexpectedKindFatalError,
} from '../errors/errors';
import { getOrThrowError } from '../utils/utils';
import { UnionTypeDefinitionNode } from 'graphql/index';
import { DirectiveContainer, EXECUTABLE_DIRECTIVE_LOCATIONS, NodeContainer } from '../federation/utils';

export function isObjectLikeNodeEntity(node: ObjectLikeTypeDefinitionNode): boolean {
  // Interface entities are currently unsupported
  if (node.kind === Kind.INTERFACE_TYPE_DEFINITION
    || node.kind === Kind.INTERFACE_TYPE_EXTENSION
    || !node.directives?.length) {
    return false;
  }
  for (const directive of node.directives) {
    if (directive.name.value === KEY) {
      return true;
    }
  }
  return false;
}

export function isNodeExtension(node: ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode): boolean {
  if (!node.directives?.length) {
    return false;
  }
  for (const directive of node.directives) {
    if (directive.name.value === EXTENDS) {
      return true;
    }
  }
  return false;
}

export function extractEntityKeys(
  node: ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
  keySet: Set<string>,
  errors: Error[],
): Set<string> {
  if (!node.directives?.length) {
    return keySet;
  }
  const typeName = node.name.value;
  for (const directive of node.directives) {
    if (directive.name.value === KEY) {
      if (!directive.arguments) {
        errors.push(invalidKeyDirectiveError(typeName,[
          undefinedRequiredArgumentsErrorMessage(KEY, typeName, [NAME])
        ]));
        continue;
      }
      for (const arg of directive.arguments) {
        if (arg.name.value !== FIELDS) {
          continue;
        }
        if (arg.value.kind !== Kind.STRING) {
          continue;
        }
        keySet.add(arg.value.value);
      }
    }
  }
  return keySet;
}

export type EntityKey = {
  nestedKeys?: EntityKey[];
  parent: string;
  siblings: string[];
};

export type EntityKeyExtractionResult = {
  entityKey?: EntityKey;
  error?: Error;
};

export function getEntityKeyExtractionResult(rawEntityKey: string, parentTypeName: string): EntityKeyExtractionResult {
  const rootKey: EntityKey = { parent: '', siblings: [] };
  const entityKeyMap = new Map<string, EntityKey>([[parentTypeName, rootKey]]);
  const keyPath: string[] = [parentTypeName];
  let currentSegment = '';
  let segmentEnded = true;
  let currentKey: EntityKey;
  rawEntityKey = rawEntityKey.replaceAll(/[,\n]/g, ' ');
  for (const char of rawEntityKey) {
    currentKey = getOrThrowError(entityKeyMap, keyPath.join('.'), 'entityKeyMap');
    switch (char) {
      case ' ':
        segmentEnded = true;
        break;
      case '{':
        if (!currentSegment) {
          return { error: invalidEntityKeyError(parentTypeName, rawEntityKey, invalidOpeningBraceErrorMessage) };
        }
        currentKey.siblings.push(currentSegment);
        const nestedKey: EntityKey = { parent: currentSegment, siblings: [] };
        if (currentKey.nestedKeys) {
          currentKey.nestedKeys.push(nestedKey);
        } else {
          currentKey.nestedKeys = [nestedKey];
        }
        keyPath.push(currentSegment);
        currentSegment = '';
        entityKeyMap.set(keyPath.join('.'), nestedKey);
        segmentEnded = true;
        break;
      case '}':
        if (currentSegment) {
          currentKey.siblings.push(currentSegment);
        }

        if (currentKey.siblings.length < 1) {
          return { error: invalidEntityKeyError(parentTypeName, rawEntityKey, invalidClosingBraceErrorMessage) };
        }

        if (keyPath.join('.') === parentTypeName) {
          return { error: invalidEntityKeyError(parentTypeName, rawEntityKey, invalidNestingClosureErrorMessage) };
        }
        currentSegment = '';
        keyPath.pop();
        segmentEnded = true;
        break;
      default:
        if (currentSegment && segmentEnded) {
          if (!currentSegment.match(/[_A-Za-z][_A-Za-z0-9]*/)) {
            return {
              error: invalidEntityKeyError(
                parentTypeName,
                rawEntityKey,
                invalidGraphQLNameErrorMessage('field', currentSegment),
              ),
            };
          }
          currentKey.siblings.push(currentSegment);
          currentSegment = char;
        } else {
          currentSegment += char;
        }
        segmentEnded = false;
    }
  }
  if (keyPath.join('.') !== parentTypeName) {
    return { error: invalidEntityKeyError(parentTypeName, rawEntityKey, invalidNestingErrorMessage) };
  }
  if (currentSegment) {
    rootKey.siblings.push(currentSegment);
  }
  return { entityKey: rootKey };
}

export type EntityKeyExtractionResults = {
  entityKeyMap: Map<string, EntityKey>;
  errors: Error[];
};

export function getEntityKeyExtractionResults(
  node: ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
  entityKeyMap: Map<string, EntityKey>,
): EntityKeyExtractionResults {
  const parentTypeName = node.name.value;
  if (!node.directives?.length) {
    return { entityKeyMap, errors: [expectedEntityError(parentTypeName)] };
  }
  const rawEntityKeys = new Set<string>();
  const errorMessages: string[] = [];
  for (const directive of node.directives) {
    if (directive.name.value !== KEY) {
      continue;
    }
    if (!directive.arguments || directive.arguments.length < 1) {
      errorMessages.push(undefinedRequiredArgumentsErrorMessage(KEY, parentTypeName, [FIELDS]));
      continue;
    }
    for (const arg of directive.arguments) {
      const argumentName = arg.name.value;
      if (arg.name.value === RESOLVABLE) {
        continue;
      }
      if (arg.name.value !== FIELDS) {
        errorMessages.push(unexpectedDirectiveArgumentErrorMessage(KEY, argumentName));
        break;
      }
      if (arg.value.kind !== Kind.STRING) {
        errorMessages.push(invalidKeyDirectiveArgumentErrorMessage(arg.value.kind));
        break;
      }
      rawEntityKeys.add(arg.value.value);
    }
  }
  const errors: Error[] = [];
  if (errorMessages.length > 0) {
    errors.push(invalidKeyDirectiveError(parentTypeName, errorMessages));
  }

  for (const rawEntityKey of rawEntityKeys) {
    const existingEntityKey = entityKeyMap.get(rawEntityKey);
    if (existingEntityKey) {
      continue;
    }
    const { entityKey, error } = getEntityKeyExtractionResult(rawEntityKey, parentTypeName);
    if (error) {
      errors.push(error);
      continue;
    }
    if (!entityKey) {
      throw new Error(); // this should never happen
    }
    entityKeyMap.set(rawEntityKey, entityKey);
  }

  return { entityKeyMap, errors };
}

export function extractInterfaces(
  node: InterfaceTypeDefinitionNode | InterfaceTypeExtensionNode | ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
  interfaces: Set<string>,
  errors?: Error[],
): Set<string> {
  if (!node.interfaces) {
    return interfaces;
  }
  const parentTypeName = node.name.value;
  for (const face of node.interfaces) {
    const name = face.name.value;
    if (errors && interfaces.has(name)) {
      errors.push(duplicateInterfaceError(name, parentTypeName));
      continue;
    }
    interfaces.add(name);
  }
  return interfaces;
}

export function isNodeShareable(
  node: ObjectTypeDefinitionNode | ObjectTypeExtensionNode | FieldDefinitionNode,
): boolean {
  if (!node.directives) {
    return false;
  }
  for (const directive of node.directives) {
    if (directive.name.value === SHAREABLE) {
      return true;
    }
  }
  return false;
}

export function isNodeExternal(
  node: ObjectTypeDefinitionNode | ObjectTypeExtensionNode | FieldDefinitionNode,
): boolean {
  if (!node.directives) {
    return false;
  }
  for (const directive of node.directives) {
    if (directive.name.value === EXTERNAL) {
      return true;
    }
  }
  return false;
}

export function isNodeOverridden(
  node: ObjectTypeDefinitionNode | ObjectTypeExtensionNode | FieldDefinitionNode,
): boolean {
  if (!node.directives) {
    return false;
  }
  for (const directive of node.directives) {
    if (directive.name.value === OVERRIDE) {
      return true;
    }
  }
  return false;
}

export function areBaseAndExtensionKindsCompatible(baseKind: Kind, extensionKind: Kind, typeName: string): boolean {
  switch (baseKind) {
    case Kind.ENUM_TYPE_DEFINITION:
      return extensionKind === Kind.ENUM_TYPE_EXTENSION;
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
      return extensionKind === Kind.INPUT_OBJECT_TYPE_EXTENSION;
    case Kind.INTERFACE_TYPE_DEFINITION:
      return extensionKind === Kind.INTERFACE_TYPE_EXTENSION;
    case Kind.OBJECT_TYPE_DEFINITION:
      return extensionKind === Kind.OBJECT_TYPE_EXTENSION;
    case Kind.SCALAR_TYPE_DEFINITION:
      return extensionKind === Kind.SCALAR_TYPE_EXTENSION;
    case Kind.UNION_TYPE_DEFINITION:
      return extensionKind === Kind.UNION_TYPE_EXTENSION;
    default:
      throw unexpectedKindFatalError(typeName);
  }
}

export function stringToNameNode(value: string): NameNode {
  return {
    kind: Kind.NAME,
    value,
  };
}

export function stringArrayToNameNodeArray(values: string[]): NameNode[] {
  const nameNodes: NameNode[] = [];
  for (const value of values) {
    nameNodes.push(stringToNameNode(value));
  }
  return nameNodes;
}

export function setToNameNodeArray(set: Set<string>): NameNode[] {
  const nameNodes: NameNode[] = [];
  for (const value of set) {
    nameNodes.push(stringToNameNode(value));
  }
  return nameNodes;
}

export function stringToNamedTypeNode(value: string): NamedTypeNode {
  return {
    kind: Kind.NAMED_TYPE,
    name: stringToNameNode(value),
  };
}

export function setToNamedTypeNodeArray(set: Set<string>): NamedTypeNode[] {
  const namedTypeNodes: NamedTypeNode[] = [];
  for (const entry of set) {
    namedTypeNodes.push(stringToNamedTypeNode(entry));
  }
  return namedTypeNodes;
}

export function nodeKindToDirectiveLocation(kind: Kind): string {
  switch (kind) {
    case Kind.ENUM_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.ENUM_TYPE_EXTENSION:
      return ENUM_UPPER;
    case Kind.ENUM_VALUE_DEFINITION:
      return ENUM_VALUE_UPPER;
    case Kind.FIELD_DEFINITION:
      return FIELD_DEFINITION_UPPER;
    case Kind.FRAGMENT_DEFINITION:
      return FRAGMENT_DEFINITION_UPPER;
    case Kind.FRAGMENT_SPREAD:
      return FRAGMENT_SPREAD_UPPER;
    case Kind.INLINE_FRAGMENT:
      return INLINE_FRAGMENT_UPPER;
    case Kind.INPUT_VALUE_DEFINITION:
      return INPUT_FIELD_DEFINITION_UPPER;
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.INPUT_OBJECT_TYPE_EXTENSION:
      return INPUT_OBJECT_UPPER;
    case Kind.INTERFACE_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.INTERFACE_TYPE_EXTENSION:
      return INTERFACE_UPPER;
    case Kind.OBJECT_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.OBJECT_TYPE_EXTENSION:
      return OBJECT_UPPER;
    case Kind.SCALAR_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.SCALAR_TYPE_EXTENSION:
      return SCALAR_UPPER;
    case Kind.SCHEMA_DEFINITION:
    // intentional fallthrough
    case Kind.SCHEMA_EXTENSION:
      return SCHEMA_UPPER;
    case Kind.UNION_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.UNION_TYPE_EXTENSION:
      return UNION_UPPER;
    default:
      return kind;
  }
}

export const operationTypeNodeToDefaultType = new Map<OperationTypeNode, string>([
  [OperationTypeNode.MUTATION, MUTATION],
  [OperationTypeNode.QUERY, QUERY],
  [OperationTypeNode.SUBSCRIPTION, SUBSCRIPTION],
]);

export function isKindAbstract(kind: Kind) {
  return kind === Kind.INTERFACE_TYPE_DEFINITION || kind === Kind.UNION_TYPE_DEFINITION;
}

export function getInlineFragmentString(parentTypeName: string): string {
  return ` ... on ${parentTypeName} `;
}

export function extractNameNodeStringsToSet(nodes: readonly NameNode[] | NameNode[], set: Set<string>): Set<string> {
  for (const node of nodes) {
    set.add(node.value);
  }
  return set;
}

export function extractExecutableDirectiveLocations(
  nodes: readonly NameNode[] | NameNode[], set: Set<string>,
): Set<string> {
  for (const node of nodes) {
    const name = node.value;
    if (EXECUTABLE_DIRECTIVE_LOCATIONS.has(name)) {
      set.add(name);
    }
  }
  return set;
}

export function mergeExecutableDirectiveLocations(
  nodes: readonly NameNode[] | NameNode[], directiveContainer: DirectiveContainer,
): Set<string> {
  const mergedSet = new Set<string>();
  for (const node of nodes) {
    const name = node.value;
    if (directiveContainer.executableLocations.has(name)) {
      mergedSet.add(name);
    }
  }
  directiveContainer.executableLocations = mergedSet;
  return mergedSet;
}

export function pushPersistedDirectivesAndGetNode<T extends NodeContainer>(container: T): T['node'] {
  const persistedDirectives: ConstDirectiveNode[] = [...container.directives.tags.values()];
  const deprecatedDirective = container.directives.deprecated.directive;
  if (deprecatedDirective) {
    persistedDirectives.push(deprecatedDirective);
  }
  for (const directives of container.directives.directives.values()) {
    persistedDirectives.push(...directives);
  }
  container.node.directives = persistedDirectives;
  return container.node;
}

export function addConcreteTypesForImplementedInterfaces(
  node: ObjectTypeDefinitionNode | ObjectTypeExtensionNode | InterfaceTypeDefinitionNode,
  abstractToConcreteTypeNames: Map<string, Set<string>>,
) {
  if (!node.interfaces || node.interfaces.length < 1) {
    return;
  }
  const concreteTypeName = node.name.value;
  for (const iFace of node.interfaces) {
    const interfaceName = iFace.name.value;
    const concreteTypes = abstractToConcreteTypeNames.get(interfaceName);
    if (concreteTypes) {
      concreteTypes.add(concreteTypeName);
    } else {
      abstractToConcreteTypeNames.set(interfaceName, new Set<string>([concreteTypeName]));
    }
  }
}

export function addConcreteTypesForUnion(
  node: UnionTypeDefinitionNode | UnionTypeExtensionNode, abstractToConcreteTypeNames: Map<string, Set<string>>,
) {
  if (!node.types || node.types.length < 1) {
    return;
  }
  const unionName = node.name.value;
  for (const member of node.types) {
    const memberName = member.name.value;
    const concreteTypes = abstractToConcreteTypeNames.get(unionName);
    if (concreteTypes) {
      concreteTypes.add(memberName);
    } else {
      abstractToConcreteTypeNames.set(unionName, new Set<string>([memberName]));
    }
  }
}

export function formatDescription(description?: StringValueNode): StringValueNode | undefined {
  if (!description) {
    return description;
  }
  let value = description.value;
  if (description.block) {
    const lines = value.split('\n');
    if (lines.length > 1) {
      value = lines.map((line) => line.trimStart()).join('\n');
    }
  }
  return { ...description, value: value, block: true };
}

export function setLongestDescriptionForNode(
  existingNode: MutableFieldDefinitionNode | MutableEnumValueDefinitionNode | MutableInputValueDefinitionNode | MutableTypeDefinitionNode,
  newDescription?: StringValueNode,
) {
  if (!newDescription) {
    return;
  }
  if (!existingNode.description || newDescription.value.length > existingNode.description.value.length) {
    existingNode.description = { ...newDescription, block: true };
  }
}