import {
  ConstDirectiveNode,
  DefinitionNode,
  DirectiveDefinitionNode,
  DirectiveNode,
  DocumentNode,
  EnumValueDefinitionNode,
  FieldDefinitionNode,
  GraphQLSchema,
  InputValueDefinitionNode,
  InterfaceTypeDefinitionNode,
  InterfaceTypeExtensionNode,
  Kind,
  NamedTypeNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  OperationTypeDefinitionNode,
  OperationTypeNode,
  print,
  SchemaDefinitionNode,
  SchemaExtensionNode,
  TypeDefinitionNode,
  TypeExtensionNode,
  TypeNode,
  visit,
} from 'graphql';
import {
  addConcreteTypesForImplementedInterfaces,
  addConcreteTypesForUnion,
  areBaseAndExtensionKindsCompatible,
  extractInterfaces,
  formatDescription,
  isNodeExtension,
  isNodeInterfaceObject,
  isObjectLikeNodeEntity,
  operationTypeNodeToDefaultType,
  safeParse,
  stringToNameNode,
} from '../ast/utils';
import {
  addNonExternalFieldsToSet,
  areNodeKindAndDirectiveLocationCompatible,
  ChildContainer,
  enumContainerToNode,
  EnumExtensionContainer,
  EnumValueContainer,
  ExtensionContainer,
  ExtensionMap,
  extractFieldSetValue,
  FieldContainer,
  FieldSetContainer,
  getDefinedArgumentsForDirective,
  getDirectiveDefinitionArgumentSets,
  inputObjectContainerToNode,
  InputObjectExtensionContainer,
  InputValidationContainer,
  InputValueContainer, isNodeQuery,
  newFieldSetContainer,
  ObjectExtensionContainer,
  ObjectLikeContainer,
  objectLikeContainerToNode,
  ObjectLikeExtensionContainer,
  ParentContainer,
  ParentMap,
  scalarContainerToNode,
  ScalarExtensionContainer,
  SchemaContainer,
  schemaContainerToNode,
  UnionContainer,
  unionContainerToNode,
  UnionExtensionContainer,
  validateDirectivesWithFieldSet,
} from './utils';
import {
  BASE_DIRECTIVE_DEFINITIONS,
  BASE_SCALARS,
  FIELD_SET_DEFINITION,
  VERSION_ONE_DIRECTIVES,
  VERSION_TWO_DIRECTIVE_DEFINITIONS,
  VERSION_TWO_DIRECTIVES,
} from '../utils/constants';
import { getNamedTypeForChild } from '../type-merging/type-merging';
import {
  addIterableValuesToSet,
  EntityInterfaceData,
  getEntriesNotInHashSet,
  getOrThrowError,
  getValueOrDefault,
  ImplementationErrors,
  InvalidArgument,
  InvalidFieldImplementation,
  kindToTypeString,
  subtractSourceSetFromTargetSet,
} from '../utils/utils';
import {
  duplicateArgumentsError,
  duplicateDirectiveArgumentDefinitionErrorMessage,
  duplicateDirectiveDefinitionError,
  duplicateEnumValueDefinitionError,
  duplicateFieldDefinitionError,
  duplicateInterfaceExtensionError,
  duplicateOperationTypeDefinitionError,
  duplicateOverriddenFieldErrorMessage,
  duplicateOverriddenFieldsError,
  duplicateTypeDefinitionError,
  duplicateUnionMemberError,
  duplicateValueExtensionError, equivalentSourceAndTargetOverrideError,
  expectedEntityError,
  incompatibleExtensionError,
  incompatibleExtensionKindsError,
  incompatibleParentKindFatalError,
  invalidArgumentsError,
  invalidDirectiveArgumentTypeErrorMessage,
  invalidDirectiveError,
  invalidDirectiveLocationErrorMessage,
  invalidKeyDirectiveArgumentErrorMessage,
  invalidKeyDirectivesError,
  invalidOperationTypeDefinitionError,
  invalidOverrideTargetSubgraphNameError,
  invalidRepeatedDirectiveErrorMessage,
  invalidRootTypeDefinitionError,
  invalidSubgraphNameErrorMessage,
  invalidSubgraphNamesError,
  noBaseTypeExtensionError,
  noDefinedUnionMembersError,
  noFieldDefinitionsError,
  operationDefinitionError,
  subgraphInvalidSyntaxError,
  subgraphValidationError,
  subgraphValidationFailureError,
  undefinedDirectiveError,
  undefinedObjectLikeParentError,
  undefinedRequiredArgumentsErrorMessage,
  undefinedTypeError,
  unexpectedDirectiveArgumentErrorMessage,
  unexpectedDirectiveArgumentsErrorMessage,
  unexpectedKindFatalError,
  unimplementedInterfaceFieldsError,
} from '../errors/errors';
import {
  ANY_SCALAR,
  ENTITIES_FIELD,
  ENTITY_UNION,
  EXTENDS,
  EXTENSIONS,
  EXTERNAL,
  FIELDS,
  FROM,
  KEY,
  OPERATION_TO_DEFAULT,
  OVERRIDE,
  PARENTS,
  PROVIDES,
  REQUIRES,
  RESOLVABLE,
  ROOT_TYPES,
  SCHEMA,
  SERVICE_FIELD,
  SERVICE_OBJECT,
} from '../utils/string-constants';
import { buildASTSchema } from '../buildASTSchema/buildASTSchema';
import { ConfigurationData, ConfigurationDataMap } from '../subgraph/field-configuration';
import { printTypeNode } from '@graphql-tools/merge';
import { inputValueDefinitionNodeToMutable, MutableInputValueDefinitionNode, ObjectLikeTypeNode } from '../ast/ast';
import { InternalSubgraph, recordSubgraphName, Subgraph } from '../subgraph/subgraph';

export type NormalizationResult = {
  configurationDataMap: ConfigurationDataMap;
  entityInterfaces: Map<string, EntityInterfaceData>;
  isVersionTwo: boolean;
  keyFieldsByParentTypeName: Map<string, Set<string>>;
  operationTypes: Map<string, OperationTypeNode>;
  overridesByTargetSubgraphName: Map<string, Map<string, Set<string>>>;
  schema: GraphQLSchema;
  subgraphAST: DocumentNode;
  subgraphString: string;
};

export type NormalizationResultContainer = {
  errors?: Error[];
  normalizationResult?: NormalizationResult;
};

export type BatchNormalizationContainer = {
  errors?: Error[];
  internalSubgraphsBySubgraphName: Map<string, InternalSubgraph>;
}

export function normalizeSubgraphFromString(subgraphSDL: string): NormalizationResultContainer {
  const { error, documentNode } = safeParse(subgraphSDL);
  if (error || !documentNode) {
    return { errors: [subgraphInvalidSyntaxError(error)] };
  }
  const normalizationFactory = new NormalizationFactory();
  return normalizationFactory.normalize(documentNode);
}

export function normalizeSubgraph(document: DocumentNode, subgraphName?: string): NormalizationResultContainer {
  const normalizationFactory = new NormalizationFactory(subgraphName);
  return normalizationFactory.normalize(document);
}

export class NormalizationFactory {
  abstractToConcreteTypeNames = new Map<string, Set<string>>();
  allDirectiveDefinitions = new Map<string, DirectiveDefinitionNode>();
  argumentName = '';
  childName = '';
  configurationDataMap = new Map<string, ConfigurationData>();
  customDirectiveDefinitions = new Map<string, DirectiveDefinitionNode>();
  errors: Error[] = [];
  entities = new Set<string>();
  entityInterfaces = new Map<string, EntityInterfaceData>();
  extensions: ExtensionMap = new Map<string, ExtensionContainer>();
  isCurrentParentExtension = false;
  isSubgraphVersionTwo = false;
  fieldSetsByParent = new Map<string, FieldSetContainer>();
  handledRepeatedDirectivesByHostPath = new Map<string, Set<string>>();
  lastParentNodeKind: Kind = Kind.NULL;
  lastChildNodeKind: Kind = Kind.NULL;
  keyFieldsByParentTypeName = new Map<string, Set<string>>();
  operationTypeNames = new Map<string, OperationTypeNode>();
  parents: ParentMap = new Map<string, ParentContainer>();
  parentTypeName = '';
  parentsWithChildArguments = new Set<string>();
  overridesByTargetSubgraphName = new Map<string, Map<string, Set<string>>>();
  schemaDefinition: SchemaContainer;
  subgraphName?: string;
  referencedDirectives = new Set<string>();
  referencedTypeNames = new Set<string>();

  constructor(subgraphName?: string) {
    for (const baseDirectiveDefinition of BASE_DIRECTIVE_DEFINITIONS) {
      this.allDirectiveDefinitions.set(baseDirectiveDefinition.name.value, baseDirectiveDefinition);
    }
    this.subgraphName = subgraphName;
    this.schemaDefinition = {
      directives: new Map<string, ConstDirectiveNode[]>(),
      kind: Kind.SCHEMA_DEFINITION,
      name: stringToNameNode(SCHEMA),
      operationTypes: new Map<OperationTypeNode, OperationTypeDefinitionNode>(),
    };
  }

  validateInputNamedType(namedType: string): InputValidationContainer {
    if (BASE_SCALARS.has(namedType)) {
      return { hasUnhandledError: false, typeString: '' };
    }
    const parentContainer = this.parents.get(namedType);
    if (!parentContainer) {
      this.errors.push(undefinedTypeError(namedType));
      return { hasUnhandledError: false, typeString: '' };
    }
    switch (parentContainer.kind) {
      case Kind.ENUM_TYPE_DEFINITION:
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
      case Kind.SCALAR_TYPE_DEFINITION:
        return { hasUnhandledError: false, typeString: '' };
      default:
        return { hasUnhandledError: true, typeString: kindToTypeString(parentContainer.kind) };
    }
  }

  extractArguments(
    node: FieldDefinitionNode,
    argumentByName: Map<string, MutableInputValueDefinitionNode>,
    fieldPath: string,
  ): Map<string, MutableInputValueDefinitionNode> {
    if (!node.arguments) {
      return argumentByName;
    }
    this.parentsWithChildArguments.add(this.parentTypeName);
    const duplicatedArguments = new Set<string>();
    for (const argumentNode of node.arguments) {
      const argumentName = argumentNode.name.value;
      if (argumentByName.has(argumentName)) {
        duplicatedArguments.add(argumentName);
        continue;
      }
      argumentByName.set(argumentName, inputValueDefinitionNodeToMutable(argumentNode, this.parentTypeName));
    }
    if (duplicatedArguments.size > 0) {
      this.errors.push(duplicateArgumentsError(fieldPath, [...duplicatedArguments]));
    }
    return argumentByName;
  }

  validateArguments(fieldContainer: FieldContainer, fieldPath: string) {
    const invalidArguments: InvalidArgument[] = [];
    for (const [argumentName, argumentNode] of fieldContainer.arguments) {
      const namedType = getNamedTypeForChild(fieldPath + `(${argumentName}...)`, argumentNode.type);
      const { hasUnhandledError, typeString } = this.validateInputNamedType(namedType);
      if (hasUnhandledError) {
        invalidArguments.push({ argumentName, namedType, typeString, typeName: printTypeNode(argumentNode.type) });
      }
    }
    if (invalidArguments.length > 0) {
      this.errors.push(invalidArgumentsError(fieldPath, invalidArguments));
    }
  }

  extractDirectives(
    node:
      | EnumValueDefinitionNode
      | FieldDefinitionNode
      | InputValueDefinitionNode
      | SchemaDefinitionNode
      | SchemaExtensionNode
      | TypeDefinitionNode
      | TypeExtensionNode,
    map: Map<string, ConstDirectiveNode[]>,
  ): Map<string, ConstDirectiveNode[]> {
    if (!node.directives) {
      return map;
    }
    for (const directive of node.directives) {
      const directiveName = directive.name.value;
      if (directiveName === EXTENDS) {
        continue;
      }
      const existingDirectives = map.get(directiveName);
      if (existingDirectives) {
        existingDirectives.push(directive);
        continue;
      }
      map.set(directiveName, [directive]);
    }
    return map;
  }

  extractUniqueUnionMembers(members: NamedTypeNode[], map: Map<string, NamedTypeNode>): Map<string, NamedTypeNode> {
    for (const member of members) {
      const name = member.name.value;
      if (map.has(name)) {
        this.errors.push(new Error(`Member "${name} can only be defined on union "${this.parentTypeName}" once.`));
        continue;
      }
      if (!BASE_SCALARS.has(name)) {
        this.referencedTypeNames.add(name);
      }
      map.set(name, member);
    }
    return map;
  }

  mergeUniqueInterfaces(extensionInterfaces: Set<string>, interfaces: Set<string>, typeName: string) {
    for (const interfaceName of extensionInterfaces) {
      if (!interfaces.has(interfaceName)) {
        interfaces.add(interfaceName);
        continue;
      }
      this.errors.push(duplicateInterfaceExtensionError(interfaceName, typeName));
    }
  }

  mergeUniqueUnionMembers(baseUnion: UnionContainer, extensionUnion?: UnionExtensionContainer) {
    if (!extensionUnion) {
      return;
    }
    const extensionMembers = extensionUnion.types;
    const members = baseUnion.types;
    const typeName = baseUnion.name.value;
    for (const [memberName, namedTypeNode] of extensionMembers) {
      if (!members.has(memberName)) {
        members.set(memberName, namedTypeNode);
        continue;
      }
      this.errors.push(duplicateUnionMemberError(memberName, typeName));
    }
  }

  mergeDirectives(baseTypeDirectives: Map<string, ConstDirectiveNode[]>, extension?: ExtensionContainer) {
    if (!extension) {
      return;
    }
    for (const [directiveName, directives] of extension.directives) {
      const existingDirectives = baseTypeDirectives.get(directiveName);
      if (existingDirectives) {
        existingDirectives.push(...directives);
        continue;
      }
      baseTypeDirectives.set(directiveName, [...directives]);
    }
  }

  getValidatedAndNormalizedParentDirectives(
    parent: ParentContainer | SchemaContainer | ObjectExtensionContainer,
  ): ConstDirectiveNode[] {
    const parentTypeName = parent.name.value;
    const normalizedDirectives: ConstDirectiveNode[] = [];
    for (const [directiveName, directives] of parent.directives) {
      const definition = this.allDirectiveDefinitions.get(directiveName);
      if (!definition) {
        this.errors.push(undefinedDirectiveError(directiveName, parentTypeName));
        continue;
      }
      const allArguments = new Set<string>();
      const requiredArguments = new Set<string>();
      getDirectiveDefinitionArgumentSets(definition.arguments || [], allArguments, requiredArguments);
      const entityKeys = new Set<string>();
      const errorMessages: string[] = [];
      for (const directive of directives) {
        if (!areNodeKindAndDirectiveLocationCompatible(parent.kind, definition)) {
          errorMessages.push(invalidDirectiveLocationErrorMessage(parentTypeName, parent.kind, directiveName));
        }
        if (!definition.repeatable && directives.length > 1) {
          errorMessages.push(invalidRepeatedDirectiveErrorMessage(directiveName, parentTypeName));
        }
        if (!definition.arguments || definition.arguments.length < 1) {
          if (directive.arguments && directive.arguments.length > 0) {
            errorMessages.push(unexpectedDirectiveArgumentsErrorMessage(directive, parentTypeName));
          } else {
            normalizedDirectives.push(directive);
          }
          continue;
        }
        if (!directive.arguments || directive.arguments.length < 1) {
          if (requiredArguments.size > 0) {
            errorMessages.push(
              undefinedRequiredArgumentsErrorMessage(directiveName, parentTypeName, [...requiredArguments]),
            );
          } else {
            normalizedDirectives.push(directive);
          }
          continue;
        }
        const definedArguments = getDefinedArgumentsForDirective(
          directive.arguments,
          allArguments,
          directiveName,
          parentTypeName,
          errorMessages,
        );
        const missingRequiredArguments = getEntriesNotInHashSet(requiredArguments, definedArguments);
        if (missingRequiredArguments.length > 0) {
          errorMessages.push(
            undefinedRequiredArgumentsErrorMessage(
              directiveName,
              parentTypeName,
              [...requiredArguments],
              missingRequiredArguments,
            ),
          );
        }

        // Only add unique entity keys
        if (directiveName === KEY) {
          const directiveKind = directive.arguments[0].value.kind;
          if (directiveKind !== Kind.STRING) {
            errorMessages.push(invalidKeyDirectiveArgumentErrorMessage(directiveKind));
            continue;
          }
          const entityKey = directive.arguments[0].value.value;
          if (entityKeys.has(entityKey)) {
            continue;
          }
          entityKeys.add(entityKey);
        }
        normalizedDirectives.push(directive);
      }
      if (errorMessages.length > 0) {
        this.errors.push(invalidDirectiveError(directiveName, parentTypeName, errorMessages));
      }
    }
    return normalizedDirectives;
  }

  convertKindForExtension(
    node: InterfaceTypeDefinitionNode | InterfaceTypeExtensionNode | ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
  ): Kind.INTERFACE_TYPE_EXTENSION | Kind.OBJECT_TYPE_EXTENSION {
    switch (node.kind) {
      case Kind.INTERFACE_TYPE_DEFINITION:
        return Kind.INTERFACE_TYPE_EXTENSION;
      case Kind.OBJECT_TYPE_DEFINITION:
        return Kind.OBJECT_TYPE_EXTENSION;
      default:
        return node.kind;
    }
  }

  handleInterfaceObject(node: ObjectTypeDefinitionNode) {
    if (!isNodeInterfaceObject(node)) {
      return;
    }
    const name = node.name.value;
    if (this.entityInterfaces.has(name)) {
      // TODO error
      return;
    }
    this.entityInterfaces.set(name, {
      interfaceObjectFieldNames: new Set<string>(node.fields?.map(field => field.name.value)),
      interfaceFieldNames: new Set<string>(),
      isInterfaceObject: true,
      typeName: name,
    });
  }

  handleObjectLikeExtension(
    node: InterfaceTypeDefinitionNode | InterfaceTypeExtensionNode | ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
  ): false | undefined {
    this.isCurrentParentExtension = true;
    const extension = this.extensions.get(this.parentTypeName);
    const convertedKind = this.convertKindForExtension(node);
    if (extension) {
      if (extension.kind !== convertedKind) {
        this.errors.push(incompatibleExtensionKindsError(node, extension.kind));
        return false;
      }
      this.extractDirectives(node, extension.directives);
      extractInterfaces(node, extension.interfaces, this.errors);
      return;
    }
    const isEntity = isObjectLikeNodeEntity(node);
    this.extensions.set(this.parentTypeName, {
      directives: this.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
      fields: new Map<string, FieldContainer>(),
      interfaces: extractInterfaces(node, new Set<string>(), this.errors),
      isEntity,
      kind: convertedKind,
      name: node.name,
    });
    if (node.kind === Kind.INTERFACE_TYPE_DEFINITION
      || node.kind === Kind.INTERFACE_TYPE_EXTENSION
      || !isEntity) {
      return;
    }
    this.entities.add(this.parentTypeName);
    const fieldSets = getValueOrDefault(
      this.fieldSetsByParent, this.parentTypeName, newFieldSetContainer,
    );
    this.extractKeyFieldSets(node, fieldSets.keys);
  }

  validateChildDirectives(child: ChildContainer, hostPath: string) {
    const childKind = child.node.kind;
    for (const [directiveName, directives] of child.directives) {
      const definition = this.allDirectiveDefinitions.get(directiveName);
      if (!definition) {
        this.errors.push(undefinedDirectiveError(directiveName, hostPath));
        continue;
      }
      const allArguments = new Set<string>();
      const requiredArguments = new Set<string>();
      getDirectiveDefinitionArgumentSets(definition.arguments || [], allArguments, requiredArguments);
      const errorMessages: string[] = [];
      for (const directive of directives) {
        if (!areNodeKindAndDirectiveLocationCompatible(childKind, definition)) {
          errorMessages.push(invalidDirectiveLocationErrorMessage(hostPath, childKind, directiveName));
        }
        if (!definition.repeatable && directives.length > 1) {
          errorMessages.push(invalidRepeatedDirectiveErrorMessage(directiveName, hostPath));
        }
        if (!definition.arguments || definition.arguments.length < 1) {
          if (directive.arguments && directive.arguments.length > 0) {
            errorMessages.push(unexpectedDirectiveArgumentsErrorMessage(directive, hostPath));
          }
          continue;
        }
        if (!directive.arguments || directive.arguments.length < 1) {
          if (requiredArguments.size > 0) {
            errorMessages.push(
              undefinedRequiredArgumentsErrorMessage(directiveName, hostPath, [...requiredArguments]),
            );
          }
          continue;
        }
        const definedArguments = getDefinedArgumentsForDirective(
          directive.arguments,
          allArguments,
          directiveName,
          hostPath,
          errorMessages,
        );
        const missingRequiredArguments = getEntriesNotInHashSet(requiredArguments, definedArguments);
        if (missingRequiredArguments.length > 0) {
          errorMessages.push(
            undefinedRequiredArgumentsErrorMessage(
              directiveName,
              hostPath,
              [...requiredArguments],
              missingRequiredArguments,
            ),
          );
        }
      }
      if (errorMessages.length > 0) {
        this.errors.push(invalidDirectiveError(directiveName, hostPath, errorMessages));
      }
    }
  }

  isTypeValidImplementation(originalType: TypeNode, implementationType: TypeNode): boolean {
    if (originalType.kind === Kind.NON_NULL_TYPE) {
      if (implementationType.kind !== Kind.NON_NULL_TYPE) {
        return false;
      }
      return this.isTypeValidImplementation(originalType.type, implementationType.type);
    }
    if (implementationType.kind === Kind.NON_NULL_TYPE) {
      return this.isTypeValidImplementation(originalType, implementationType.type);
    }
    switch (originalType.kind) {
      case Kind.NAMED_TYPE:
        if (implementationType.kind === Kind.NAMED_TYPE) {
          const originalTypeName = originalType.name.value;
          const implementationTypeName = implementationType.name.value;
          if (originalTypeName === implementationTypeName) {
            return true;
          }
          const concreteTypes = this.abstractToConcreteTypeNames.get(originalTypeName);
          if (!concreteTypes) {
            return false;
          }
          return concreteTypes.has(implementationTypeName);
        }
        return false;
      default:
        if (implementationType.kind === Kind.LIST_TYPE) {
          return this.isTypeValidImplementation(originalType.type, implementationType.type);
        }
        return false;
    }
  }

  extractKeyFieldSets(node: ObjectLikeTypeNode, rawFieldSets: Set<string>) {
    const parentTypeName = node.name.value;
    if (!node.directives?.length) {
      // This should never happen
      this.errors.push(expectedEntityError(parentTypeName));
      return;
    }
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
        rawFieldSets.add(arg.value.value);
      }
    }
    if (errorMessages.length) {
      this.errors.push(invalidKeyDirectivesError(parentTypeName, errorMessages));
    }
  }

  validateInterfaceImplementations(container: ObjectLikeContainer) {
    if (container.interfaces.size < 1) {
      return;
    }
    const implementationErrorsMap = new Map<string, ImplementationErrors>();
    for (const interfaceName of container.interfaces) {
      const interfaceContainer = getOrThrowError(this.parents, interfaceName, PARENTS);
      if (interfaceContainer.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        throw incompatibleParentKindFatalError(interfaceName, Kind.INTERFACE_TYPE_DEFINITION, interfaceContainer.kind);
      }
      const implementationErrors: ImplementationErrors = {
        invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
        unimplementedFields: [],
      };
      let hasErrors = false;
      for (const [fieldName, interfaceField] of interfaceContainer.fields) {
        let hasNestedErrors = false;
        const containerField = container.fields.get(fieldName);
        if (!containerField) {
          hasErrors = true;
          implementationErrors.unimplementedFields.push(fieldName);
          continue;
        }
        const invalidFieldImplementation: InvalidFieldImplementation = {
          invalidAdditionalArguments: new Set<string>(),
          invalidImplementedArguments: [],
          originalResponseType: printTypeNode(interfaceField.node.type),
          unimplementedArguments: new Set<string>(),
        };
        // The implemented field type must be equally or more restrictive than the original interface field type
        if (!this.isTypeValidImplementation(interfaceField.node.type, containerField.node.type)) {
          hasErrors = true;
          hasNestedErrors = true;
          invalidFieldImplementation.implementedResponseType = printTypeNode(containerField.node.type);
        }
        const handledArguments = new Set<string>();
        for (const [argumentName, interfaceArgument] of interfaceField.arguments) {
          handledArguments.add(argumentName);
          const containerArgument = containerField.arguments.get(argumentName);
          // The type implementing the interface must include all arguments with no variation for that argument
          if (!containerArgument) {
            hasErrors = true;
            hasNestedErrors = true;
            invalidFieldImplementation.unimplementedArguments.add(argumentName);
            continue;
          }
          // Implemented arguments should be the exact same type
          const actualType = printTypeNode(containerArgument.type);
          const expectedType = printTypeNode(interfaceArgument.type);
          if (expectedType !== actualType) {
            hasErrors = true;
            hasNestedErrors = true;
            invalidFieldImplementation.invalidImplementedArguments.push({ actualType, argumentName, expectedType });
          }
        }
        // Additional arguments must be optional (nullable)
        for (const [argumentName, argumentNode] of containerField.arguments) {
          if (handledArguments.has(argumentName)) {
            continue;
          }
          if (argumentNode.type.kind !== Kind.NON_NULL_TYPE) {
            continue;
          }
          hasErrors = true;
          hasNestedErrors = true;
          invalidFieldImplementation.invalidAdditionalArguments.add(argumentName);
        }
        if (hasNestedErrors) {
          implementationErrors.invalidFieldImplementations.set(fieldName, invalidFieldImplementation);
        }
      }
      if (hasErrors) {
        implementationErrorsMap.set(interfaceName, implementationErrors);
      }
    }
    if (implementationErrorsMap.size) {
      this.errors.push(unimplementedInterfaceFieldsError(
        container.name.value, kindToTypeString(container.kind), implementationErrorsMap,
      ));
    }
  }

  handleOverride(node: DirectiveNode, fieldName: string) {
    if (node.name.value !== OVERRIDE) {
      return;
    }
    const errorMessages: string[] = [];
    let hostPath = `${this.parentTypeName}.${this.childName}`;
    let kind = this.lastChildNodeKind === Kind.NULL ? this.lastParentNodeKind : this.lastChildNodeKind;
    if (this.argumentName) {
      hostPath += `(${this.argumentName}: ...)`;
      kind = Kind.ARGUMENT;
    }
    if (kind !== Kind.FIELD_DEFINITION) {
      errorMessages.push(invalidDirectiveLocationErrorMessage(hostPath, kind, OVERRIDE));
    }
    let targetSubgraphName = '';
    if (node.arguments && node.arguments.length > 0) {
      const observedArguments = new Set<string>();
      const handledDuplicateArguments = new Set<string>();
      for (const argumentNode of node.arguments) {
        const argumentName = argumentNode.name.value;
        if (argumentName !== FROM && !observedArguments.has(argumentName)) {
          observedArguments.add(argumentName);
          errorMessages.push(unexpectedDirectiveArgumentErrorMessage(OVERRIDE, argumentName));
          continue;
        }
        // If an argument is observed more than once, it is a duplication error.
        // However, the error should only propagate once.
        if (observedArguments.has(argumentName)) {
          if (!handledDuplicateArguments.has(argumentName)) {
            errorMessages.push(duplicateDirectiveArgumentDefinitionErrorMessage(OVERRIDE, hostPath, argumentName));
          }
          continue;
        }
        if (argumentNode.value.kind !== Kind.STRING) {
          errorMessages.push(
            invalidDirectiveArgumentTypeErrorMessage(true, FROM, Kind.STRING, argumentNode.value.kind),
          );
        } else {
          observedArguments.add(FROM);
          targetSubgraphName = argumentNode.value.value;
          if (targetSubgraphName === this.subgraphName) {
            this.errors.push(equivalentSourceAndTargetOverrideError(targetSubgraphName, hostPath));
          }
        }
      }
      if (!observedArguments.has(FROM)) {
        errorMessages.push(undefinedRequiredArgumentsErrorMessage(
          OVERRIDE, hostPath, [FROM], [FROM],
        ));
      }
    } else {
      errorMessages.push(
        undefinedRequiredArgumentsErrorMessage(OVERRIDE, hostPath, [FROM], []),
      );
    }
    if (errorMessages.length > 0) {
      this.errors.push(invalidDirectiveError(OVERRIDE, hostPath, errorMessages));
      return;
    }
    const overrideDataForSubgraph = getValueOrDefault(
      this.overridesByTargetSubgraphName, targetSubgraphName, () => new Map<string, Set<string>>(),
    );
    const overriddenFieldNamesForParent = getValueOrDefault(
      overrideDataForSubgraph, this.parentTypeName, () => new Set<string>(),
    );
    if (overriddenFieldNamesForParent.has(this.childName)) {
      const handledRepeatedDirectives = this.handledRepeatedDirectivesByHostPath.get(hostPath);
      // If the directive name exists as a value on the host path key, the repeatable error has been handled
      if (handledRepeatedDirectives && handledRepeatedDirectives.has(OVERRIDE)) {
        return;
      }
      // Add the directive name to the existing set (if other invalid repeated directives exist) or a new set
      getValueOrDefault(this.handledRepeatedDirectivesByHostPath, hostPath, () => new Set<string>())
        .add(OVERRIDE);
      // The invalid repeated directive error should propagate only once per directive per host path
      this.errors.push(invalidDirectiveError(
        OVERRIDE, hostPath, [invalidRepeatedDirectiveErrorMessage(OVERRIDE, hostPath)],
      ));
      return;
    }
    overriddenFieldNamesForParent.add(this.childName);
  }

  normalize(document: DocumentNode) {
    const factory = this;
    /* factory.allDirectiveDefinitions is initialized with v1 directive definitions, and v2 definitions are only added
    after the visitor has visited the entire schema and the subgraph is known to be a V2 graph. Consequently,
    allDirectiveDefinitions cannot be used to check for duplicate definitions, and another set (below) is required */
    const definedDirectives = new Set<string>();
    let isCurrentParentRootType: boolean = false;
    let fieldName = '';
    // Collect any renamed root types
    visit(document, {
      OperationTypeDefinition: {
        enter(node) {
          const operationType = node.operation;
          const operationPath = `${factory.parentTypeName}.${operationType}`;
          const definitionNode = factory.schemaDefinition.operationTypes.get(operationType);
          const newTypeName = getNamedTypeForChild(operationPath, node.type);
          if (definitionNode) {
            duplicateOperationTypeDefinitionError(
              operationType,
              newTypeName,
              getNamedTypeForChild(operationPath, definitionNode.type),
            );
            return false;
          }
          const existingOperationType = factory.operationTypeNames.get(newTypeName);
          if (existingOperationType) {
            factory.errors.push(invalidOperationTypeDefinitionError(existingOperationType, newTypeName, operationType));
          } else {
            factory.operationTypeNames.set(newTypeName, operationType);
            factory.schemaDefinition.operationTypes.set(operationType, node);
          }
          return false;
        },
      },
      SchemaDefinition: {
        enter(node) {
          factory.extractDirectives(node, factory.schemaDefinition.directives);
          factory.schemaDefinition.description = node.description;
        },
      },
      SchemaExtension: {
        enter(node) {
          factory.extractDirectives(node, factory.schemaDefinition.directives);
        },
      },
    });
    visit(document, {
      DirectiveDefinition: {
        enter(node) {
          const name = node.name.value;
          if (definedDirectives.has(name)) {
            factory.errors.push(duplicateDirectiveDefinitionError(name));
            return false;
          } else {
            definedDirectives.add(name);
          }
          // Normalize federation directives by replacing them with predefined definitions
          if (VERSION_TWO_DIRECTIVES.has(name)) {
            factory.isSubgraphVersionTwo = true;
            return false;
          }
          // The V1 directives are always injected
          if (VERSION_ONE_DIRECTIVES.has(name)) {
            return false;
          }
          factory.allDirectiveDefinitions.set(name, node);
          factory.customDirectiveDefinitions.set(name, node);
          return false;
        },
      },
      Directive: {
        enter(node) {
          const name = node.name.value;
          factory.handleOverride(node, fieldName);
          if (VERSION_TWO_DIRECTIVES.has(name)) {
            factory.isSubgraphVersionTwo = true;
            return false;
          }
          if (VERSION_ONE_DIRECTIVES.has(name)) {
            return false;
          }
          factory.referencedDirectives.add(name);
        },
      },
      EnumTypeDefinition: {
        enter(node) {
          const name = node.name.value;
          if (factory.parents.has(name)) {
            factory.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), name));
            return false;
          }
          factory.parentTypeName = name;
          factory.lastParentNodeKind = node.kind;
          factory.parents.set(name, {
            description: formatDescription(node.description),
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            kind: node.kind,
            name: node.name,
            values: new Map<string, EnumValueContainer>(),
          });
        },
        leave() {
          factory.parentTypeName = '';
          factory.lastParentNodeKind = Kind.NULL;
        },
      },
      EnumTypeExtension: {
        enter(node) {
          const name = node.name.value;
          factory.parentTypeName = name;
          factory.lastParentNodeKind = node.kind;
          factory.isCurrentParentExtension = true;
          const extension = factory.extensions.get(factory.parentTypeName);
          if (extension) {
            if (extension.kind !== Kind.ENUM_TYPE_EXTENSION) {
              factory.errors.push(incompatibleExtensionKindsError(node, extension.kind));
              return false;
            }
            factory.extractDirectives(node, extension.directives);
            return;
          }
          factory.extensions.set(name, {
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            kind: node.kind,
            name: node.name,
            values: new Map<string, EnumValueContainer>(),
          });
        },
        leave() {
          factory.parentTypeName = '';
          factory.lastParentNodeKind = Kind.NULL;
          factory.isCurrentParentExtension = false;
        },
      },
      EnumValueDefinition: {
        enter(node) {
          const name = node.name.value;
          factory.childName = name;
          factory.lastChildNodeKind = node.kind;
          const parent = factory.isCurrentParentExtension
            ? getOrThrowError(factory.extensions, factory.parentTypeName, EXTENSIONS)
            : getOrThrowError(factory.parents, factory.parentTypeName, PARENTS);
          if (parent.kind !== Kind.ENUM_TYPE_DEFINITION && parent.kind !== Kind.ENUM_TYPE_EXTENSION) {
            throw unexpectedKindFatalError(name);
          }
          if (parent.values.has(name)) {
            const error = factory.isCurrentParentExtension
              ? duplicateValueExtensionError('enum', factory.parentTypeName, name)
              : duplicateEnumValueDefinitionError(name, factory.parentTypeName);
            factory.errors.push(error);
            return;
          }
          parent.values.set(name, {
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            name,
            node: { ...node, description: formatDescription(node.description) },
          });
        },
        leave() {
          factory.childName = '';
          factory.lastChildNodeKind = Kind.NULL;
        },
      },
      FieldDefinition: {
        enter(node) {
          const name = node.name.value;
          if (isCurrentParentRootType && (name === SERVICE_FIELD || name === ENTITIES_FIELD)) {
            return false;
          }
          factory.childName = name;
          factory.lastChildNodeKind = node.kind;
          const fieldPath = `${factory.parentTypeName}.${name}`;
          factory.lastChildNodeKind = node.kind;
          const fieldNamedTypeName = getNamedTypeForChild(fieldPath, node.type);
          if (!BASE_SCALARS.has(fieldNamedTypeName)) {
            factory.referencedTypeNames.add(fieldNamedTypeName);
          }
          const parent = factory.isCurrentParentExtension
            ? getOrThrowError(factory.extensions, factory.parentTypeName, EXTENSIONS)
            : getOrThrowError(factory.parents, factory.parentTypeName, PARENTS);
          if (
            parent.kind !== Kind.OBJECT_TYPE_DEFINITION &&
            parent.kind !== Kind.OBJECT_TYPE_EXTENSION &&
            parent.kind !== Kind.INTERFACE_TYPE_DEFINITION &&
            parent.kind !== Kind.INTERFACE_TYPE_EXTENSION
          ) {
            throw unexpectedKindFatalError(factory.parentTypeName);
          }
          if (parent.fields.has(name)) {
            factory.errors.push(duplicateFieldDefinitionError(name, factory.parentTypeName));
            return;
          }
          // recreate the node so the argument descriptions are updated
          const fieldContainer: FieldContainer = {
            arguments: factory.extractArguments(node, new Map<string, MutableInputValueDefinitionNode>(), fieldPath),
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            name,
            node: {
              ...node,
              arguments: node.arguments?.map((arg) => ({
                ...arg,
                description: formatDescription(arg.description),
              })),
            },
          };
          parent.fields.set(name, fieldContainer);
          // Only entities will have an existing FieldSet
          const existingFieldSet = factory.fieldSetsByParent.get(factory.parentTypeName);
          if (existingFieldSet) {
            // @requires should only be defined on a field whose parent is an entity
            // If there is existingFieldSet, it's an entity
            extractFieldSetValue(name, existingFieldSet.requires, fieldContainer.directives.get(REQUIRES));
            // @provides only makes sense on entities, but the field can be encountered before the type definition
            // When the FieldSet is evaluated, it will be checked whether the field is an entity.
            extractFieldSetValue(name, existingFieldSet.provides, fieldContainer.directives.get(PROVIDES));
            return;
          }
          const providesDirectives = fieldContainer.directives.get(PROVIDES);
          // Check whether the directive exists to avoid creating unnecessary fieldSet configurations
          if (!providesDirectives) {
            return;
          }
          const fieldSetContainer = getValueOrDefault(
            factory.fieldSetsByParent, factory.parentTypeName, newFieldSetContainer,
          );
          // @provides only makes sense on entities, but the field can be encountered before the type definition
          // When the FieldSet is evaluated, it will be checked whether the field is an entity.
          extractFieldSetValue(name, fieldSetContainer.provides, providesDirectives);
        },
        leave() {
          factory.childName = '';
          factory.lastChildNodeKind = Kind.NULL;
        },
      },
      InputObjectTypeDefinition: {
        enter(node) {
          const name = node.name.value;
          if (factory.parents.has(name)) {
            factory.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), name));
            return false;
          }
          factory.lastParentNodeKind = node.kind;
          factory.parentTypeName = name;
          factory.parents.set(name, {
            description: formatDescription(node.description),
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            fields: new Map<string, InputValueContainer>(),
            kind: node.kind,
            name: node.name,
          });
        },
        leave() {
          factory.lastParentNodeKind = Kind.NULL;
          factory.parentTypeName = '';
        },
      },
      InputObjectTypeExtension: {
        enter(node) {
          const name = node.name.value;
          factory.parentTypeName = name;
          factory.lastParentNodeKind = node.kind;
          factory.isCurrentParentExtension = true;
          const extension = factory.extensions.get(factory.parentTypeName);
          if (extension) {
            if (extension.kind !== Kind.INPUT_OBJECT_TYPE_EXTENSION) {
              factory.errors.push(incompatibleExtensionKindsError(node, extension.kind));
              return false;
            }
            factory.extractDirectives(node, extension.directives);
            return;
          }
          factory.extensions.set(name, {
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            fields: new Map<string, InputValueContainer>(),
            kind: node.kind,
            name: node.name,
          });
        },
        leave() {
          factory.parentTypeName = '';
          factory.lastParentNodeKind = Kind.NULL;
          factory.isCurrentParentExtension = false;
        },
      },
      InputValueDefinition: {
        enter(node) {
          const name = node.name.value;
          // If the parent is not an object type definition/extension, this node is an argument
          if (factory.lastParentNodeKind !== Kind.INPUT_OBJECT_TYPE_DEFINITION
            && factory.lastParentNodeKind !== Kind.INPUT_OBJECT_TYPE_EXTENSION) {
            factory.argumentName = name;
            return;
          }
          factory.childName = name;
          factory.lastChildNodeKind = node.kind;
          const valueRootTypeName = getNamedTypeForChild(`${factory.parentTypeName}.${name}`, node.type);
          if (!BASE_SCALARS.has(valueRootTypeName)) {
            factory.referencedTypeNames.add(valueRootTypeName);
          }
          const parent = factory.isCurrentParentExtension
            ? getOrThrowError(factory.extensions, factory.parentTypeName, EXTENSIONS)
            : getOrThrowError(factory.parents, factory.parentTypeName, PARENTS);
          if (parent.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION && parent.kind !== Kind.INPUT_OBJECT_TYPE_EXTENSION) {
            throw unexpectedKindFatalError(factory.parentTypeName);
          }
          if (parent.fields.has(name)) {
            factory.errors.push(duplicateValueExtensionError('input', factory.parentTypeName, name));
            return;
          }
          parent.fields.set(name, {
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            name,
            node: { ...node, description: formatDescription(node.description) },
          });
        },
        leave() {
          factory.argumentName = '';
          // Only reset childName and lastNodeKind if this input value was NOT an argument
          if (factory.lastChildNodeKind === Kind.INPUT_VALUE_DEFINITION) {
            factory.childName = '';
            factory.lastChildNodeKind = Kind.NULL;
          }
        },
      },
      InterfaceTypeDefinition: {
        enter(node) {
          const name = node.name.value;
          factory.parentTypeName = name;
          factory.lastParentNodeKind = node.kind;
          if (isNodeExtension(node)) {
            return factory.handleObjectLikeExtension(node);
          }
          if (factory.parents.has(name)) {
            factory.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), name));
            return false;
          }
          const isEntity = isObjectLikeNodeEntity(node);
          if (isEntity) {
            factory.entityInterfaces.set(name, {
              interfaceFieldNames: new Set<string>(node.fields?.map(field => field.name.value)),
              interfaceObjectFieldNames: new Set<string>(),
              isInterfaceObject: false,
              typeName: name,
            });
          }
          factory.parents.set(name, {
            description: formatDescription(node.description),
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            fields: new Map<string, FieldContainer>(),
            interfaces: extractInterfaces(node, new Set<string>(), factory.errors),
            isEntity,
            kind: node.kind,
            name: node.name,
          });
          if (!isEntity) {
            return;
          }
          factory.entities.add(name);
          const fieldSets = getValueOrDefault(factory.fieldSetsByParent, name, newFieldSetContainer);
          factory.extractKeyFieldSets(node, fieldSets.keys);
        },
        leave() {
          factory.parentTypeName = '';
          factory.lastParentNodeKind = Kind.NULL;
          factory.isCurrentParentExtension = false;
        },
      },
      InterfaceTypeExtension: {
        enter(node) {
          factory.parentTypeName = node.name.value;
          factory.lastParentNodeKind = node.kind;
          return factory.handleObjectLikeExtension(node);
        },
        leave() {
          factory.isCurrentParentExtension = false;
          factory.parentTypeName = '';
          factory.lastParentNodeKind = Kind.NULL;
        },
      },
      ObjectTypeDefinition: {
        enter(node) {
          const name = node.name.value;
          if (name === SERVICE_OBJECT) {
            return false;
          }
          isCurrentParentRootType = ROOT_TYPES.has(name) || factory.operationTypeNames.has(name);
          factory.parentTypeName = name;
          factory.lastParentNodeKind = node.kind;
          addConcreteTypesForImplementedInterfaces(node, factory.abstractToConcreteTypeNames);
          factory.handleInterfaceObject(node);
          // handling for @extends directive
          if (isNodeExtension(node)) {
            return factory.handleObjectLikeExtension(node);
          }
          if (factory.parents.has(name)) {
            factory.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), name));
            return false;
          }
          const isEntity = isObjectLikeNodeEntity(node);
          factory.parents.set(name, {
            description: formatDescription(node.description),
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            fields: new Map<string, FieldContainer>(),
            interfaces: extractInterfaces(node, new Set<string>(), factory.errors),
            isEntity,
            kind: node.kind,
            name: node.name,
          });
          if (!isEntity) {
            return;
          }
          factory.entities.add(name);
          const fieldSets = getValueOrDefault(factory.fieldSetsByParent, name, newFieldSetContainer);
          factory.extractKeyFieldSets(node, fieldSets.keys);
        },
        leave() {
          isCurrentParentRootType = false;
          factory.isCurrentParentExtension = false;
          factory.parentTypeName = '';
          factory.lastParentNodeKind = Kind.NULL;
        },
      },
      ObjectTypeExtension: {
        enter(node) {
          const name = node.name.value;
          if (name === SERVICE_OBJECT) {
            return false;
          }
          isCurrentParentRootType = ROOT_TYPES.has(name) || factory.operationTypeNames.has(name);
          factory.parentTypeName = name;
          factory.lastParentNodeKind = node.kind;
          addConcreteTypesForImplementedInterfaces(node, factory.abstractToConcreteTypeNames);
          return factory.handleObjectLikeExtension(node);
        },
        leave() {
          isCurrentParentRootType = false;
          factory.isCurrentParentExtension = false;
          factory.parentTypeName = '';
          factory.lastParentNodeKind = Kind.NULL;
        },
      },
      ScalarTypeDefinition: {
        enter(node) {
          const name = node.name.value;
          if (name === ANY_SCALAR) {
            return false;
          }
          const parent = factory.parents.get(name);
          if (parent) {
            factory.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), name));
            return false;
          }
          factory.parentTypeName = name;
          factory.lastParentNodeKind = node.kind;
          factory.parents.set(name, {
            description: formatDescription(node.description),
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            kind: Kind.SCALAR_TYPE_DEFINITION,
            name: node.name,
          });
        },
        leave() {
          factory.parentTypeName = '';
          factory.lastParentNodeKind = Kind.NULL;
        },
      },
      ScalarTypeExtension: {
        enter(node) {
          const name = node.name.value;
          if (name === ANY_SCALAR) {
            return false;
          }
          const extension = factory.extensions.get(name);
          if (extension) {
            if (extension.kind !== Kind.SCALAR_TYPE_EXTENSION) {
              factory.errors.push(incompatibleExtensionKindsError(node, extension.kind));
              return false;
            }
            factory.extractDirectives(node, extension.directives);
          } else {
            factory.parentTypeName = name;
            factory.lastParentNodeKind = node.kind;
            factory.extensions.set(name, {
              directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
              kind: node.kind,
              name: node.name,
            });
          }
          return false;
        },
        leave() {
          factory.parentTypeName = '';
          factory.lastParentNodeKind = Kind.NULL;
        },
      },
      UnionTypeDefinition: {
        enter(node) {
          const name = node.name.value;
          if (name === ENTITY_UNION) {
            return false;
          }
          factory.parentTypeName = name;
          const parent = factory.parents.get(name);
          if (parent) {
            factory.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), name));
            return false;
          }
          if (!node.types) {
            factory.errors.push(noDefinedUnionMembersError(name));
            return false;
          }
          factory.lastParentNodeKind = node.kind;
          addConcreteTypesForUnion(node, factory.abstractToConcreteTypeNames);
          factory.parents.set(name, {
            description: formatDescription(node.description),
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            kind: node.kind,
            name: node.name,
            types: factory.extractUniqueUnionMembers([...node.types], new Map<string, NamedTypeNode>()),
          });
        },
        leave() {
          factory.parentTypeName = '';
          factory.lastParentNodeKind = Kind.NULL;
        },
      },
      UnionTypeExtension: {
        enter(node) {
          const name = node.name.value;
          if (name === ENTITY_UNION) {
            return false;
          }
          const extension = factory.extensions.get(name);
          if (!node.types) {
            factory.errors.push();
            return false;
          }
          factory.lastParentNodeKind = node.kind;
          addConcreteTypesForUnion(node, factory.abstractToConcreteTypeNames);
          if (extension) {
            if (extension.kind !== Kind.UNION_TYPE_EXTENSION) {
              factory.errors.push(incompatibleExtensionKindsError(node, extension.kind));
              return false;
            }
            factory.extractDirectives(node, extension.directives);
          } else {
            factory.extensions.set(name, {
              directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
              kind: node.kind,
              name: node.name,
              types: factory.extractUniqueUnionMembers([...node.types], new Map<string, NamedTypeNode>()),
            });
          }
          return false;
        },
        leave() {
          factory.lastParentNodeKind = Kind.NULL;
        },
      },
    });
    const definitions: DefinitionNode[] = [];
    for (const directiveDefinition of BASE_DIRECTIVE_DEFINITIONS) {
      definitions.push(directiveDefinition);
    }
    definitions.push(FIELD_SET_DEFINITION);
    if (factory.isSubgraphVersionTwo) {
      for (const directiveDefinition of VERSION_TWO_DIRECTIVE_DEFINITIONS) {
        definitions.push(directiveDefinition);
        this.allDirectiveDefinitions.set(directiveDefinition.name.value, directiveDefinition);
      }
    }
    for (const directiveDefinition of this.customDirectiveDefinitions.values()) {
      definitions.push(directiveDefinition);
    }
    if (this.schemaDefinition.operationTypes.size > 0) {
      definitions.push(schemaContainerToNode(this, this.schemaDefinition));
    }

    const validExtensionOrphans = new Set<string>();
    const parentsToIgnore = new Set<string>();
    for (const [extensionTypeName, extensionContainer] of this.extensions) {
      const isEntity = this.entities.has(extensionTypeName);
      const configurationData: ConfigurationData = {
        fieldNames: new Set<string>(),
        isRootNode: isEntity,
        typeName: extensionTypeName,
      };
      this.configurationDataMap.set(extensionTypeName, configurationData);
      if (extensionContainer.kind === Kind.OBJECT_TYPE_EXTENSION) {
        if (this.operationTypeNames.has(extensionTypeName)) {
          extensionContainer.fields.delete(SERVICE_FIELD);
          extensionContainer.fields.delete(ENTITIES_FIELD);
        }
        addNonExternalFieldsToSet(extensionContainer.fields, configurationData.fieldNames);
      }
      const baseType = this.parents.get(extensionTypeName);
      if (!baseType) {
        if (extensionContainer.kind !== Kind.OBJECT_TYPE_EXTENSION) {
          this.errors.push(noBaseTypeExtensionError(extensionTypeName));
        } else {
          this.validateInterfaceImplementations(extensionContainer);
          validExtensionOrphans.add(extensionTypeName);
          definitions.push(objectLikeContainerToNode(this, extensionContainer));
        }
        continue;
      }
      if (!areBaseAndExtensionKindsCompatible(baseType.kind, extensionContainer.kind, extensionTypeName)) {
        this.errors.push(incompatibleExtensionError(extensionTypeName, baseType.kind, extensionContainer.kind));
        continue;
      }
      switch (baseType.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
          const enumExtension = extensionContainer as EnumExtensionContainer;
          for (const [valueName, enumValueDefinitionNode] of enumExtension.values) {
            if (!baseType.values.has(valueName)) {
              baseType.values.set(valueName, enumValueDefinitionNode);
              continue;
            }
            this.errors.push(duplicateEnumValueDefinitionError(valueName, extensionTypeName));
          }
          definitions.push(enumContainerToNode(this, baseType, enumExtension));
          break;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          const inputExtension = extensionContainer as InputObjectExtensionContainer;
          for (const [fieldName, inputValueDefinitionNode] of inputExtension.fields) {
            if (!baseType.fields.has(fieldName)) {
              baseType.fields.set(fieldName, inputValueDefinitionNode);
              continue;
            }
            this.errors.push(duplicateFieldDefinitionError(fieldName, extensionTypeName));
          }
          definitions.push(inputObjectContainerToNode(this, baseType, inputExtension));
          break;
        case Kind.INTERFACE_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.OBJECT_TYPE_DEFINITION:
          const objectLikeExtension = extensionContainer as ObjectLikeExtensionContainer;
          const operationTypeNode = this.operationTypeNames.get(extensionTypeName);
          if (operationTypeNode) {
            objectLikeExtension.fields.delete(SERVICE_FIELD);
            objectLikeExtension.fields.delete(ENTITIES_FIELD);
          }
          for (const [fieldName, fieldContainer] of objectLikeExtension.fields) {
            if (fieldContainer.arguments.size > 0) {
              // Arguments can only be fully validated once all parents types are known
              this.validateArguments(fieldContainer, `${extensionTypeName}.${fieldName}`);
            }
            if (baseType.fields.has(fieldName)) {
              this.errors.push(duplicateFieldDefinitionError(fieldName, extensionTypeName));
              continue;
            }
            baseType.fields.set(fieldName, fieldContainer);
            if (!fieldContainer.arguments.has(EXTERNAL)) {
              configurationData.fieldNames.add(fieldName);
            }
          }
          this.mergeUniqueInterfaces(objectLikeExtension.interfaces, baseType.interfaces, extensionTypeName);
          this.validateInterfaceImplementations(baseType);
          definitions.push(objectLikeContainerToNode(this, baseType, objectLikeExtension));
          // interfaces and objects must define at least one field
          if (baseType.fields.size < 1 && !isNodeQuery(extensionTypeName, operationTypeNode)) {
            this.errors.push(noFieldDefinitionsError(kindToTypeString(baseType.kind), extensionTypeName));
          }
          break;
        case Kind.SCALAR_TYPE_DEFINITION:
          definitions.push(scalarContainerToNode(this, baseType, extensionContainer as ScalarExtensionContainer));
          break;
        case Kind.UNION_TYPE_DEFINITION:
          const unionExtension = extensionContainer as UnionExtensionContainer;
          definitions.push(unionContainerToNode(this, baseType, unionExtension));
          break;
        default:
          throw unexpectedKindFatalError(extensionTypeName);
      }
      // At this point, the base type has been dealt with, so it doesn't need to be dealt with again
      parentsToIgnore.add(extensionTypeName);
    }
    for (const [parentTypeName, parentContainer] of this.parents) {
      if (parentsToIgnore.has(parentTypeName)) {
        continue;
      }
      switch (parentContainer.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
          definitions.push(enumContainerToNode(this, parentContainer));
          break;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          definitions.push(inputObjectContainerToNode(this, parentContainer));
          break;
        case Kind.INTERFACE_TYPE_DEFINITION:
          // intentional fallthrough
        case Kind.OBJECT_TYPE_DEFINITION:
          const isEntity = this.entities.has(parentTypeName);
          const operationTypeNode = this.operationTypeNames.get(parentTypeName);
          if (operationTypeNode) {
            parentContainer.fields.delete(SERVICE_FIELD);
            parentContainer.fields.delete(ENTITIES_FIELD);
          }
          if (this.parentsWithChildArguments.has(parentTypeName)) {
            if (parentContainer.kind !== Kind.OBJECT_TYPE_DEFINITION
              && parentContainer.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
              continue;
            }
            for (const [fieldName, fieldContainer] of parentContainer.fields) {
              // Arguments can only be fully validated once all parents types are known
              this.validateArguments(fieldContainer, `${parentTypeName}.${fieldName}`);
            }
          }
          const configurationData: ConfigurationData = {
            fieldNames: new Set<string>(),
            isRootNode: isEntity,
            typeName: parentTypeName,
          };
          this.configurationDataMap.set(parentTypeName, configurationData);
          addNonExternalFieldsToSet(parentContainer.fields, configurationData.fieldNames);
          this.validateInterfaceImplementations(parentContainer);
          definitions.push(objectLikeContainerToNode(this, parentContainer));
          // interfaces and objects must define at least one field
          if (parentContainer.fields.size < 1 && !isNodeQuery(parentTypeName, operationTypeNode)) {
            this.errors.push(noFieldDefinitionsError(kindToTypeString(parentContainer.kind), parentTypeName));
          }
          break;
        case Kind.SCALAR_TYPE_DEFINITION:
          definitions.push(scalarContainerToNode(this, parentContainer));
          break;
        case Kind.UNION_TYPE_DEFINITION:
          definitions.push(unionContainerToNode(this, parentContainer));
          break;
        default:
          throw unexpectedKindFatalError(parentTypeName);
      }
    }
    // Check that explicitly defined operations types are valid objects and that their fields are also valid
    for (const operationType of Object.values(OperationTypeNode)) {
      const node = this.schemaDefinition.operationTypes.get(operationType);
      const defaultTypeName = getOrThrowError(operationTypeNodeToDefaultType, operationType, OPERATION_TO_DEFAULT);
      // If an operation type name was not declared, use the default
      const operationTypeName = node ? getNamedTypeForChild(`schema.${operationType}`, node.type)
        : defaultTypeName;
      // If a custom type is used, the default type should not be defined
      if (
        operationTypeName !== defaultTypeName &&
        (this.parents.has(defaultTypeName) || this.extensions.has(defaultTypeName))
      ) {
        this.errors.push(invalidRootTypeDefinitionError(operationType, operationTypeName, defaultTypeName));
        continue;
      }
      const object = this.parents.get(operationTypeName);
      const extension = this.extensions.get(operationTypeName);
      // Node is truthy if an operation type was explicitly declared
      if (node) {
        // If the type is not defined in the schema, it's always an error
        if (!object && !extension) {
          this.errors.push(undefinedTypeError(operationTypeName));
          continue;
        }
        // Add the explicitly defined type to the map for the federation-factory
        this.operationTypeNames.set(operationTypeName, operationType);
      }
      if (!object && !extension) {
        continue;
      }
      const rootNode = this.configurationDataMap.get(operationTypeName);
      if (rootNode) {
        rootNode.isRootNode = true;
        rootNode.typeName = defaultTypeName;
      }
      const containers = [object, extension];
      for (const container of containers) {
        if (!container) {
          continue;
        }
        if (container.kind !== Kind.OBJECT_TYPE_DEFINITION && container.kind !== Kind.OBJECT_TYPE_EXTENSION) {
          this.errors.push(operationDefinitionError(operationTypeName, operationType, container.kind));
          continue;
        }
        // Root types fields whose response type is an extension orphan could be valid through a federated graph
        // However, the field would have to be shareable to ever be valid TODO
        for (const fieldContainer of container.fields.values()) {
          const fieldName = fieldContainer.name;
          const fieldPath = `${operationTypeName}.${fieldName}`;
          const fieldTypeName = getNamedTypeForChild(fieldPath, fieldContainer.node.type);
          if (
            !BASE_SCALARS.has(fieldTypeName) &&
            !this.parents.has(fieldTypeName) &&
            !validExtensionOrphans.has(fieldTypeName)
          ) {
            this.errors.push(undefinedTypeError(fieldTypeName));
          }
        }
      }
    }
    for (const referencedTypeName of this.referencedTypeNames) {
      if (this.parents.has(referencedTypeName) || this.entities.has(referencedTypeName)) {
        continue;
      }
      const extension = this.extensions.get(referencedTypeName);
      if (!extension || extension.kind !== Kind.OBJECT_TYPE_EXTENSION) {
        this.errors.push(undefinedTypeError(referencedTypeName));
      }
    }
    for (const [parentTypeName, fieldSets] of this.fieldSetsByParent) {
      const parentContainer = this.parents.get(parentTypeName)
        || this.extensions.get(parentTypeName);
      if (
        !parentContainer
        || (
          parentContainer.kind !== Kind.OBJECT_TYPE_DEFINITION
          && parentContainer.kind != Kind.OBJECT_TYPE_EXTENSION
          && parentContainer.kind !== Kind.INTERFACE_TYPE_DEFINITION
          && parentContainer.kind !== Kind.INTERFACE_TYPE_EXTENSION
        )
      ) {
        this.errors.push(undefinedObjectLikeParentError(parentTypeName));
        continue;
      }
      validateDirectivesWithFieldSet(this, parentContainer, fieldSets);
    }
    if (this.errors.length > 0) {
      return { errors: this.errors };
    }
    const newAST: DocumentNode = {
      kind: Kind.DOCUMENT,
      definitions,
    };
    return {
      normalizationResult: {
        // configurationDataMap is map of ConfigurationData per type name.
        // It is an Intermediate configuration object that will be converted to an engine configuration in the router
        configurationDataMap: this.configurationDataMap,
        entityInterfaces: this.entityInterfaces,
        isVersionTwo: this.isSubgraphVersionTwo,
        keyFieldsByParentTypeName: this.keyFieldsByParentTypeName,
        operationTypes: this.operationTypeNames,
        overridesByTargetSubgraphName: this.overridesByTargetSubgraphName,
        subgraphAST: newAST,
        subgraphString: print(newAST),
        schema: buildASTSchema(newAST, { assumeValid: true }),
      },
    };
  }
}

export function batchNormalize(subgraphs: Subgraph[]): BatchNormalizationContainer {
  const internalSubgraphsBySubgraphName = new Map<string, InternalSubgraph>;
  const allOverridesByTargetSubgraphName = new Map<string, Map<string, Set<string>>>();
  const overrideSourceSubgraphNamesByFieldPath = new Map<string, string[]>();
  const duplicateOverriddenFieldPaths = new Set<string>();
  const validationErrors: Error[] = [];
  const subgraphNames = new Set<string>();
  const nonUniqueSubgraphNames = new Set<string>();
  const invalidNameErrorMessages: string[] = [];
  // Record the subgraph names first, so that subgraph references can be validated
  for (const subgraph of subgraphs) {
    if (subgraph.name) {
      recordSubgraphName(subgraph.name, subgraphNames, nonUniqueSubgraphNames);
    }
  }
  for (let i = 0; i < subgraphs.length; i++) {
    const subgraph = subgraphs[i];
    const subgraphName = subgraph.name || `subgraph-${i}-${Date.now()}`;
    if (!subgraph.name) {
      invalidNameErrorMessages.push(invalidSubgraphNameErrorMessage(i, subgraphName));
    }
    const { errors, normalizationResult } = normalizeSubgraph(
      subgraph.definitions, subgraph.name,
    );
    if (errors) {
      validationErrors.push(subgraphValidationError(subgraphName, errors));
      continue;
    }
    if (!normalizationResult) {
      validationErrors.push(subgraphValidationError(subgraphName, [subgraphValidationFailureError]));
      continue;
    }
    if (subgraph.name) {
      internalSubgraphsBySubgraphName.set(subgraphName, {
        configurationDataMap: normalizationResult.configurationDataMap,
        definitions: normalizationResult.subgraphAST,
        entityInterfaces: normalizationResult.entityInterfaces,
        keyFieldsByParentTypeName: normalizationResult.keyFieldsByParentTypeName,
        isVersionTwo: normalizationResult.isVersionTwo,
        name: subgraphName,
        operationTypes: normalizationResult.operationTypes,
        overriddenFieldNamesByParentTypeName: new Map<string, Set<string>>(),
        schema: normalizationResult.schema,
        url: subgraph.url,
      });
    }
    if (normalizationResult.overridesByTargetSubgraphName.size < 1) {
      continue;
    }
    const invalidOverrideTargetSubgraphNameErrors: Error[] = [];
    for (const [targetSubgraphName, overridesData] of normalizationResult.overridesByTargetSubgraphName) {
      const isTargetValid = subgraphNames.has(targetSubgraphName);
      for (const [parentTypeName, fieldNames] of overridesData) {
        if (!isTargetValid) {
          invalidOverrideTargetSubgraphNameErrors.push(
            invalidOverrideTargetSubgraphNameError(targetSubgraphName, parentTypeName, [...fieldNames]),
          );
        } else {
          const overridesData = getValueOrDefault(
            allOverridesByTargetSubgraphName, targetSubgraphName, () => new Map<string, Set<string>>(),
          );
          const existingFieldNames = getValueOrDefault(
            overridesData, parentTypeName, () => new Set<string>(fieldNames),
          );
          addIterableValuesToSet(fieldNames, existingFieldNames);
        }
        for (const fieldName of fieldNames) {
          const fieldPath = `${parentTypeName}.${fieldName}`;
          const sourceSubgraphs = overrideSourceSubgraphNamesByFieldPath.get(fieldPath);
          if (!sourceSubgraphs) {
            overrideSourceSubgraphNamesByFieldPath.set(fieldPath, [subgraphName]);
            continue;
          }
          sourceSubgraphs.push(subgraphName);
          duplicateOverriddenFieldPaths.add(fieldPath);
        }
      }
    }
    if (invalidOverrideTargetSubgraphNameErrors.length > 0) {
      validationErrors.push(subgraphValidationError(subgraphName, invalidOverrideTargetSubgraphNameErrors));
    }
  }
  const allErrors: Error[] = [];
  if (invalidNameErrorMessages.length > 0 || nonUniqueSubgraphNames.size > 0) {
    allErrors.push(invalidSubgraphNamesError([...nonUniqueSubgraphNames], invalidNameErrorMessages));
  }
  if (duplicateOverriddenFieldPaths.size > 0) {
    const duplicateOverriddenFieldErrorMessages: string[] = [];
    for (const fieldPath of duplicateOverriddenFieldPaths) {
      const sourceSubgraphNames = getOrThrowError(
        overrideSourceSubgraphNamesByFieldPath, fieldPath, 'overrideSourceSubgraphNamesByFieldPath',
      );
      duplicateOverriddenFieldErrorMessages.push(duplicateOverriddenFieldErrorMessage(fieldPath, sourceSubgraphNames));
    }
    allErrors.push(duplicateOverriddenFieldsError(duplicateOverriddenFieldErrorMessages));
  }
  allErrors.push(...validationErrors);
  if (allErrors.length > 0) {
    return { errors: allErrors, internalSubgraphsBySubgraphName };
  }
  for (const [targetSubgraphName, overridesData] of allOverridesByTargetSubgraphName) {
    const internalSubgraph = getOrThrowError(
      internalSubgraphsBySubgraphName, targetSubgraphName, 'normalizedSubgraphsByName',
    );
    internalSubgraph.overriddenFieldNamesByParentTypeName = overridesData;
    for (const [parentTypeName, fieldNames] of overridesData) {
      const configurationData = internalSubgraph.configurationDataMap.get(parentTypeName);
      if (!configurationData) {
        continue;
      }
      subtractSourceSetFromTargetSet(fieldNames, configurationData.fieldNames);
      if (configurationData.fieldNames.size < 1) {
        internalSubgraph.configurationDataMap.delete(parentTypeName);
      }
    }
  }
  return { internalSubgraphsBySubgraphName: internalSubgraphsBySubgraphName };
}
