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
} from 'graphql';
import {
  MutableDirectiveDefinitionNode,
  MutableEnumTypeDefinitionNode,
  MutableEnumValueDefinitionNode,
  MutableFieldDefinitionNode,
  MutableInputObjectTypeDefinitionNode,
  MutableInputValueDefinitionNode,
  MutableInterfaceTypeDefinitionNode,
  MutableObjectTypeDefinitionNode,
  MutableObjectTypeExtensionNode,
  MutableScalarTypeDefinitionNode,
  MutableUnionTypeDefinitionNode,
  ObjectLikeTypeDefinitionNode,
} from './ast';
import {
  ENUM_UPPER,
  ENUM_VALUE_UPPER,
  EXTENDS,
  FIELD_DEFINITION_UPPER,
  FIELD_UPPER,
  FIELDS,
  FRAGMENT_DEFINITION_UPPER,
  FRAGMENT_SPREAD_UPPER,
  INLINE_FRAGMENT_UPPER,
  INPUT_OBJECT_UPPER,
  INTERFACE_UPPER,
  KEY,
  MUTATION,
  MUTATION_UPPER,
  OBJECT_UPPER,
  QUERY,
  QUERY_UPPER,
  SCALAR_UPPER,
  SCHEMA_UPPER,
  SHAREABLE,
  SUBSCRIPTION,
  SUBSCRIPTION_UPPER,
} from '../utils/string-constants';
import {
  duplicateInterfaceError,
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

export const EXECUTABLE_DIRECTIVE_LOCATIONS = new Set<string>([
  FIELD_UPPER, FRAGMENT_DEFINITION_UPPER, FRAGMENT_SPREAD_UPPER,
  INLINE_FRAGMENT_UPPER, MUTATION_UPPER, QUERY_UPPER, SUBSCRIPTION_UPPER,
]);

export enum MergeMethod {
  UNION,
  INTERSECTION,
  CONSISTENT,
}

export type PersistedDirectivesContainer = {
  directives: Map<string, ConstDirectiveNode[]>;
  tags: Map<string, ConstDirectiveNode>;
};

export type ArgumentContainer = {
  includeDefaultValue: boolean;
  node: MutableInputValueDefinitionNode;
  requiredSubgraphs: Set<string>;
  subgraphs: Set<string>;
};

export type ArgumentMap = Map<string, ArgumentContainer>;

export type DirectiveContainer = {
  arguments: ArgumentMap;
  executableLocations: Set<string>;
  node: MutableDirectiveDefinitionNode;
  subgraphs: Set<string>;
};

export type DirectiveMap = Map<string, DirectiveContainer>;

export type EntityContainer = {
  fields: Set<string>;
  keys: Set<string>;
  subgraphs: Set<string>;
};

export type EnumContainer = {
  appearances: number;
  directives: PersistedDirectivesContainer;
  kind: Kind.ENUM_TYPE_DEFINITION;
  node: MutableEnumTypeDefinitionNode;
  values: EnumValueMap;
};

export type EnumValueContainer = {
  appearances: number;
  directives: PersistedDirectivesContainer;
  node: MutableEnumValueDefinitionNode;
};

export type EnumValueMap = Map<string, EnumValueContainer>;

export type FieldContainer = {
  arguments: ArgumentMap;
  directives: PersistedDirectivesContainer;
  isShareable: boolean;
  node: MutableFieldDefinitionNode;
  rootTypeName: string;
  subgraphs: Set<string>;
  subgraphsByShareable: Map<string, boolean>;
};

export type FieldMap = Map<string, FieldContainer>;

export type InputValueContainer = {
  appearances: number;
  directives: PersistedDirectivesContainer;
  includeDefaultValue: boolean;
  node: MutableInputValueDefinitionNode;
};

export type InputValueMap = Map<string, InputValueContainer>;

export type InputObjectContainer = {
  appearances: number;
  directives: PersistedDirectivesContainer;
  fields: InputValueMap;
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION;
  node: MutableInputObjectTypeDefinitionNode;
};

export type InterfaceContainer = {
  directives: PersistedDirectivesContainer;
  fields: FieldMap;
  interfaces: Set<string>;
  kind: Kind.INTERFACE_TYPE_DEFINITION;
  node: MutableInterfaceTypeDefinitionNode;
  subgraphs: Set<string>;
};

export type ObjectContainer = {
  directives: PersistedDirectivesContainer;
  fields: FieldMap;
  entityKeys: Set<string>;
  interfaces: Set<string>;
  isRootType: boolean;
  kind: Kind.OBJECT_TYPE_DEFINITION;
  node: MutableObjectTypeDefinitionNode;
  subgraphs: Set<string>;
};

export type ObjectExtensionContainer = {
  directives: PersistedDirectivesContainer;
  fields: FieldMap;
  entityKeys: Set<string>;
  interfaces: Set<string>;
  isRootType: boolean;
  kind: Kind.OBJECT_TYPE_EXTENSION;
  node: MutableObjectTypeExtensionNode;
  subgraphs: Set<string>;
};

export type RootTypeField = {
  inlineFragment: string;
  path: string;
  name: string;
  parentTypeName: string;
  responseType: string;
  rootTypeName: string;
  subgraphs: Set<string>;
};

export type PotentiallyUnresolvableField = {
  fieldContainer: FieldContainer;
  fullResolverPaths: string[];
  rootTypeField: RootTypeField;
};

export type ScalarContainer = {
  directives: PersistedDirectivesContainer;
  kind: Kind.SCALAR_TYPE_DEFINITION;
  node: MutableScalarTypeDefinitionNode;
};

export type UnionContainer = {
  directives: PersistedDirectivesContainer;
  kind: Kind.UNION_TYPE_DEFINITION;
  members: Set<string>;
  node: MutableUnionTypeDefinitionNode;
};

export type ChildContainer = FieldContainer | InputValueContainer | EnumValueContainer;

export type ParentContainer =
  | EnumContainer
  | InputObjectContainer
  | InterfaceContainer
  | ObjectContainer
  | UnionContainer
  | ScalarContainer;

export type NodeContainer = ChildContainer | ParentContainer;

export type ExtensionContainer = ObjectExtensionContainer;

export type ParentMap = Map<string, ParentContainer>;

export type ObjectLikeContainer = ObjectContainer | InterfaceContainer;

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
): Set<string> {
  if (!node.directives?.length) {
    return keySet;
  }
  for (const directive of node.directives) {
    if (directive.name.value === KEY) {
      if (!directive.arguments) {
        throw new Error('Entity without arguments'); // TODO
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
  rawEntityKey = rawEntityKey.replaceAll(',', ' ');
  for (const char of rawEntityKey) {
    currentKey = getOrThrowError(entityKeyMap, keyPath.join('.'));
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
  if (!node.directives?.length) {
    return { entityKeyMap, errors: [new Error('No directives found.')] }; // todo
  }
  const parentTypeName = node.name.value;
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
      return SCHEMA_UPPER;
    default:
      throw new Error(`Unknown Kind "${kind}".`); // TODO
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

export function pushPersistedDirectivesToNode(container: NodeContainer) {
  const persistedDirectives: ConstDirectiveNode[] = [...container.directives.tags.values()];
  for (const directives of container.directives.directives.values()) {
    persistedDirectives.push(...directives);
  }
  container.node.directives = persistedDirectives;
  return container.node;
}

export function getNodeWithPersistedDirectives(container: ParentContainer) {
  pushPersistedDirectivesToNode(container);
  return container.node;
}