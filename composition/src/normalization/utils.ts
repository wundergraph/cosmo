import {
  ConstArgumentNode,
  ConstDirectiveNode,
  DirectiveDefinitionNode,
  EnumTypeDefinitionNode,
  EnumValueDefinitionNode,
  FieldDefinitionNode,
  InputObjectTypeDefinitionNode,
  InputValueDefinitionNode,
  InterfaceTypeDefinitionNode,
  Kind,
  NamedTypeNode,
  NameNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  OperationTypeDefinitionNode,
  OperationTypeNode,
  ScalarTypeDefinitionNode,
  SchemaDefinitionNode,
  StringValueNode,
  UnionTypeDefinitionNode,
} from 'graphql';
import { mapToArrayOfValues } from '../utils/utils';
import { EntityKey, setToNamedTypeNodeArray } from '../ast/utils';
import {
  ARGUMENT_DEFINITION_UPPER,
  ENUM_UPPER,
  ENUM_VALUE_UPPER,
  FIELD_DEFINITION_UPPER,
  FIELD_UPPER,
  FRAGMENT_DEFINITION_UPPER,
  INLINE_FRAGMENT_UPPER,
  INPUT_FIELD_DEFINITION_UPPER,
  INPUT_OBJECT_UPPER,
  INTERFACE_UPPER,
  MUTATION_UPPER,
  OBJECT_UPPER,
  QUERY_UPPER,
  SCALAR_UPPER,
  SCHEMA_UPPER,
  SUBSCRIPTION_UPPER,
  UNION_UPPER,
  VARIABLE_DEFINITION_UPPER,
} from '../utils/string-constants';
import { NormalizationFactory } from './normalization-factory';
import { getNamedTypeForChild } from '../type-merging/type-merging';
import {
  duplicateDirectiveArgumentDefinitionErrorMessage,
  invalidKeyDirectiveError,
  objectInCompositeKeyWithoutSelectionsErrorMessage,
  undefinedEntityKeyErrorMessage,
  undefinedParentFatalError,
  unexpectedDirectiveArgumentErrorMessage,
  unexpectedDirectiveLocationError,
  unexpectedParentKindErrorMessage,
} from '../errors/errors';

export type EnumContainer = {
  description?: StringValueNode;
  directives: Map<string, ConstDirectiveNode[]>;
  kind: Kind.ENUM_TYPE_DEFINITION;
  name: NameNode;
  values: Map<string, EnumValueContainer>;
};

export type EnumValueContainer = {
  directives: Map<string, ConstDirectiveNode[]>;
  name: string;
  node: EnumValueDefinitionNode;
};

export type FieldContainer = {
  arguments: Map<string, InputValueDefinitionNode>;
  directives: Map<string, ConstDirectiveNode[]>;
  name: string;
  node: FieldDefinitionNode;
};

export type InputObjectContainer = {
  description?: StringValueNode;
  directives: Map<string, ConstDirectiveNode[]>;
  fields: Map<string, InputValueContainer>;
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION;
  name: NameNode;
};

export type InputValueContainer = {
  directives: Map<string, ConstDirectiveNode[]>;
  name: string;
  node: InputValueDefinitionNode;
};

export type InterfaceContainer = {
  description?: StringValueNode;
  directives: Map<string, ConstDirectiveNode[]>;
  fields: Map<string, FieldContainer>;
  interfaces: Set<string>;
  kind: Kind.INTERFACE_TYPE_DEFINITION;
  name: NameNode;
};

export type ObjectContainer = {
  description?: StringValueNode;
  directives: Map<string, ConstDirectiveNode[]>;
  fields: Map<string, FieldContainer>;
  interfaces: Set<string>;
  isEntity: boolean;
  kind: Kind.OBJECT_TYPE_DEFINITION;
  name: NameNode;
};

export type ScalarContainer = {
  description?: StringValueNode;
  directives: Map<string, ConstDirectiveNode[]>;
  kind: Kind.SCALAR_TYPE_DEFINITION;
  name: NameNode;
};

export type SchemaContainer = {
  description?: StringValueNode;
  directives: Map<string, ConstDirectiveNode[]>;
  kind: Kind.SCHEMA_DEFINITION;
  name: NameNode;
  operationTypes: Map<OperationTypeNode, OperationTypeDefinitionNode>;
};

export type UnionContainer = {
  description?: StringValueNode;
  directives: Map<string, ConstDirectiveNode[]>;
  kind: Kind.UNION_TYPE_DEFINITION;
  name: NameNode;
  types: Map<string, NamedTypeNode>;
};

export type ObjectLikeTypeContainer = InterfaceContainer | ObjectContainer;

export type ParentContainer =
  | EnumContainer
  | InputObjectContainer
  | InterfaceContainer
  | ObjectContainer
  | ScalarContainer
  | UnionContainer;

export type ChildContainer = EnumValueContainer | FieldContainer | InputValueContainer;

export type ParentMap = Map<string, ParentContainer>;

export type EnumExtensionContainer = {
  directives: Map<string, ConstDirectiveNode[]>;
  kind: Kind.ENUM_TYPE_EXTENSION;
  name: NameNode;
  values: Map<string, EnumValueContainer>;
};

export type InputObjectExtensionContainer = {
  directives: Map<string, ConstDirectiveNode[]>;
  fields: Map<string, InputValueContainer>;
  kind: Kind.INPUT_OBJECT_TYPE_EXTENSION;
  name: NameNode;
};

export type InterfaceExtensionContainer = {
  directives: Map<string, ConstDirectiveNode[]>;
  fields: Map<string, FieldContainer>;
  interfaces: Set<string>;
  kind: Kind.INTERFACE_TYPE_EXTENSION;
  name: NameNode;
};

export type ObjectExtensionContainer = {
  directives: Map<string, ConstDirectiveNode[]>;
  fields: Map<string, FieldContainer>;
  interfaces: Set<string>;
  isEntity: boolean;
  kind: Kind.OBJECT_TYPE_EXTENSION;
  name: NameNode;
};

export type ScalarExtensionContainer = {
  directives: Map<string, ConstDirectiveNode[]>;
  kind: Kind.SCALAR_TYPE_EXTENSION;
  name: NameNode;
};

export type UnionExtensionContainer = {
  directives: Map<string, ConstDirectiveNode[]>;
  kind: Kind.UNION_TYPE_EXTENSION;
  name: NameNode;
  types: Map<string, NamedTypeNode>;
};

export type ObjectLikeExtensionContainer = InterfaceExtensionContainer | ObjectExtensionContainer;

export type ObjectLikeContainer = ObjectLikeTypeContainer | ObjectLikeExtensionContainer;

export type ExtensionContainer =
  | EnumExtensionContainer
  | InputObjectExtensionContainer
  | InterfaceExtensionContainer
  | ObjectExtensionContainer
  | ScalarExtensionContainer
  | UnionExtensionContainer;

export type ExtensionMap = Map<string, ExtensionContainer>;

type ChildDefinitionNode = EnumValueDefinitionNode | InputValueDefinitionNode | FieldDefinitionNode;

function childMapToValueArray<V extends ChildContainer, N extends ChildDefinitionNode = V['node']>(
  factory: NormalizationFactory,
  map: Map<string, V>,
  parentTypeName: string,
): N[] {
  const valueArray: ChildDefinitionNode[] = [];
  for (const childContainer of map.values()) {
    const childPath = `${parentTypeName}.${childContainer.name}`;
    factory.validateChildDirectives(childContainer, childPath);
    valueArray.push(childContainer.node);
  }
  return valueArray as N[];
}

export function enumContainerToNode(
  factory: NormalizationFactory,
  baseEnum: EnumContainer,
  enumExtension?: ExtensionContainer,
): EnumTypeDefinitionNode {
  factory.mergeDirectives(baseEnum.directives, enumExtension);
  return {
    description: baseEnum.description,
    directives: factory.getValidatedAndNormalizedParentDirectives(baseEnum),
    kind: baseEnum.kind,
    name: baseEnum.name,
    values: childMapToValueArray(factory, baseEnum.values, baseEnum.name.value),
  };
}

export function inputObjectContainerToNode(
  factory: NormalizationFactory,
  baseInputObject: InputObjectContainer,
  inputObjectExtension?: InputObjectExtensionContainer,
): InputObjectTypeDefinitionNode {
  factory.mergeDirectives(baseInputObject.directives, inputObjectExtension);
  return {
    description: baseInputObject.description,
    directives: factory.getValidatedAndNormalizedParentDirectives(baseInputObject),
    fields: childMapToValueArray(factory, baseInputObject.fields, baseInputObject.name.value),
    kind: baseInputObject.kind,
    name: baseInputObject.name,
  };
}

export function objectLikeContainerToNode(
  factory: NormalizationFactory,
  baseObjectLike: ObjectLikeTypeContainer | ObjectExtensionContainer,
  objectLikeExtension?: ObjectLikeExtensionContainer,
): ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode | ObjectTypeExtensionNode {
  factory.mergeDirectives(baseObjectLike.directives, objectLikeExtension);
  const description = baseObjectLike.kind === Kind.OBJECT_TYPE_EXTENSION ? undefined : baseObjectLike.description;
  return {
    description,
    directives: factory.getValidatedAndNormalizedParentDirectives(baseObjectLike),
    fields: childMapToValueArray(factory, baseObjectLike.fields, baseObjectLike.name.value),
    interfaces: setToNamedTypeNodeArray(baseObjectLike.interfaces),
    kind: baseObjectLike.kind,
    name: baseObjectLike.name,
  };
}

export function scalarContainerToNode(
  factory: NormalizationFactory,
  baseScalar: ScalarContainer,
  scalarExtension?: ScalarExtensionContainer,
): ScalarTypeDefinitionNode {
  factory.mergeDirectives(baseScalar.directives, scalarExtension);
  return {
    description: baseScalar.description,
    directives: factory.getValidatedAndNormalizedParentDirectives(baseScalar),
    kind: baseScalar.kind,
    name: baseScalar.name,
  };
}

export function schemaContainerToNode(
  factory: NormalizationFactory,
  baseSchema: SchemaContainer,
): SchemaDefinitionNode {
  return {
    description: baseSchema.description,
    directives: factory.getValidatedAndNormalizedParentDirectives(baseSchema),
    kind: baseSchema.kind,
    operationTypes: mapToArrayOfValues(baseSchema.operationTypes),
  };
}

export function unionContainerToNode(
  factory: NormalizationFactory,
  baseUnion: UnionContainer,
  unionExtension?: UnionExtensionContainer,
): UnionTypeDefinitionNode {
  factory.mergeUniqueUnionMembers(baseUnion, unionExtension);
  factory.mergeDirectives(baseUnion.directives, unionExtension);
  return {
    description: baseUnion.description,
    directives: factory.getValidatedAndNormalizedParentDirectives(baseUnion),
    kind: baseUnion.kind,
    name: baseUnion.name,
    types: mapToArrayOfValues(baseUnion.types),
  };
}

export function areNodeKindAndDirectiveLocationCompatible(
  kind: Kind,
  directiveDefinitionNode: DirectiveDefinitionNode,
): boolean {
  for (const location of directiveDefinitionNode.locations) {
    const locationName = location.value.toUpperCase();
    switch (locationName) {
      case ARGUMENT_DEFINITION_UPPER:
        if (kind === Kind.INPUT_VALUE_DEFINITION) {
          return true;
        }
        break;
      case ENUM_UPPER:
        if (kind === Kind.ENUM_TYPE_DEFINITION || kind === Kind.ENUM_TYPE_EXTENSION) {
          return true;
        }
        break;
      case ENUM_VALUE_UPPER:
        if (kind === Kind.ENUM_VALUE_DEFINITION) {
          return true;
        }
        break;
      case FIELD_UPPER:
        if (kind === Kind.FIELD) {
          return true;
        }
        break;
      case FIELD_DEFINITION_UPPER:
        if (kind === Kind.FIELD_DEFINITION) {
          return true;
        }
        break;
      case INLINE_FRAGMENT_UPPER:
        if (kind === Kind.INLINE_FRAGMENT) {
          return true;
        }
        break;
      case INPUT_FIELD_DEFINITION_UPPER:
        if (kind === Kind.INPUT_VALUE_DEFINITION) {
          return true;
        }
        break;
      case INPUT_OBJECT_UPPER:
        if (kind === Kind.INPUT_OBJECT_TYPE_DEFINITION || kind === Kind.INPUT_OBJECT_TYPE_EXTENSION) {
          return true;
        }
        break;
      case INTERFACE_UPPER:
        if (kind === Kind.INTERFACE_TYPE_DEFINITION || kind === Kind.INTERFACE_TYPE_EXTENSION) {
          return true;
        }
        break;
      case OBJECT_UPPER:
        if (kind === Kind.OBJECT_TYPE_DEFINITION || kind === Kind.OBJECT_TYPE_EXTENSION) {
          return true;
        }
        break;
      case FRAGMENT_DEFINITION_UPPER:
        if (kind === Kind.FRAGMENT_DEFINITION) {
          return true;
        }
        break;
      case SCALAR_UPPER:
        if (kind === Kind.SCALAR_TYPE_DEFINITION || kind === Kind.SCALAR_TYPE_EXTENSION) {
          return true;
        }
        break;
      case SCHEMA_UPPER:
        if (kind === Kind.SCHEMA_DEFINITION || kind === Kind.SCHEMA_EXTENSION) {
          return true;
        }
        break;
      case UNION_UPPER:
        if (kind === Kind.UNION_TYPE_DEFINITION || kind === Kind.UNION_TYPE_EXTENSION) {
          return true;
        }
        break;
      case VARIABLE_DEFINITION_UPPER:
        if (kind === Kind.VARIABLE_DEFINITION) {
          return true;
        }
        break;
      case QUERY_UPPER:
      // intentional fallthrough
      case MUTATION_UPPER:
      // intentional fallthrough
      case SUBSCRIPTION_UPPER:
        if (kind === Kind.OPERATION_DEFINITION) {
          return true;
        }
        break;
      default:
        throw unexpectedDirectiveLocationError(locationName);
    }
  }
  return false;
}

export function validateEntityKeys(factory: NormalizationFactory, objectTypeName: string, isExtension = false) {
  const entityKeyMap = factory.entityMap.get(objectTypeName);
  if (!entityKeyMap) {
    return;
  }
  for (const entityKey of entityKeyMap.values()) {
    const errorMessages: string[] = [];
    if (isExtension) {
      validateExtensionEntityKey(factory, objectTypeName, entityKey, errorMessages);
    } else {
      validateBaseObjectEntityKey(factory, objectTypeName, entityKey, errorMessages);
    }
    if (errorMessages.length > 0) {
      factory.errors.push(invalidKeyDirectiveError(objectTypeName, errorMessages));
    }
  }
}

function validateEntityKey(
  factory: NormalizationFactory,
  entityKey: EntityKey,
  object: ObjectContainer | ObjectExtensionContainer,
  objectTypeName: string,
  errorMessages: string[],
) {
  for (const fieldName of entityKey.siblings) {
    const field = object.fields.get(fieldName);
    if (!field) {
      errorMessages.push(undefinedEntityKeyErrorMessage(fieldName, objectTypeName));
      continue;
    }
    if (entityKey.nestedKeys?.some((nestedKey) => nestedKey.parent === fieldName)) {
      continue;
    }
    const fieldPath = `${objectTypeName}.${fieldName}`;
    const fieldTypeName = getNamedTypeForChild(fieldPath, field.node.type);
    if (factory.parents.has(fieldTypeName)) {
      errorMessages.push(objectInCompositeKeyWithoutSelectionsErrorMessage(fieldName, fieldTypeName));
    }
  }
  if (errorMessages.length > 0 || !entityKey.nestedKeys) {
    return;
  }
  for (const nestedKey of entityKey.nestedKeys) {
    const field = object.fields.get(nestedKey.parent);
    if (!field) {
      errorMessages.push(undefinedEntityKeyErrorMessage(nestedKey.parent, objectTypeName));
      continue;
    }
    const fieldPath = `${objectTypeName}.${field.name}`;
    validateBaseObjectEntityKey(factory, getNamedTypeForChild(fieldPath, field.node.type), nestedKey, errorMessages);
  }
}

function validateBaseObjectEntityKey(
  factory: NormalizationFactory,
  objectTypeName: string,
  entityKey: EntityKey,
  errorMessages: string[],
) {
  const object = factory.parents.get(objectTypeName);
  if (!object) {
    throw undefinedParentFatalError(objectTypeName);
  }
  if (object.kind !== Kind.OBJECT_TYPE_DEFINITION) {
    errorMessages.push(unexpectedParentKindErrorMessage(objectTypeName, object.kind, Kind.OBJECT_TYPE_DEFINITION));
    return;
  }
  validateEntityKey(factory, entityKey, object, objectTypeName, errorMessages);
}

function validateExtensionEntityKey(
  factory: NormalizationFactory,
  objectTypeName: string,
  entityKey: EntityKey,
  errorMessages: string[],
) {
  const objectExtension = factory.extensions.get(objectTypeName);
  if (!objectExtension) {
    throw undefinedParentFatalError(objectTypeName);
  }
  if (objectExtension.kind !== Kind.OBJECT_TYPE_EXTENSION) {
    errorMessages.push(
      unexpectedParentKindErrorMessage(objectTypeName, objectExtension.kind, Kind.OBJECT_TYPE_EXTENSION),
    );
    return;
  }
  validateEntityKey(factory, entityKey, objectExtension, objectTypeName, errorMessages);
}

export function getDirectiveDefinitionArgumentSets(
  args: readonly InputValueDefinitionNode[],
  allArguments: Set<string>,
  requiredArguments: Set<string>,
) {
  for (const argument of args) {
    const argumentName = argument.name.value;
    allArguments.add(argumentName);
    if (argument.type.kind === Kind.NON_NULL_TYPE) {
      requiredArguments.add(argumentName);
    }
  }
}

export function getDefinedArgumentsForDirective(
  args: readonly ConstArgumentNode[],
  allArguments: Set<string>,
  directiveName: string,
  hostPath: string,
  errorMessages: string[],
): Set<string> {
  const definedArguments = new Set<string>();
  for (const argument of args) {
    const argumentName = argument.name.value;
    if (!allArguments.has(argumentName)) {
      errorMessages.push(unexpectedDirectiveArgumentErrorMessage(directiveName, argumentName));
      continue;
    }
    if (definedArguments.has(argumentName)) {
      errorMessages.push(duplicateDirectiveArgumentDefinitionErrorMessage(directiveName, hostPath, argumentName));
      continue;
    }
    definedArguments.add(argumentName);
  }
  return definedArguments;
}

export type InputValidationContainer = {
  hasUnhandledError: boolean;
  typeString: string;
};
