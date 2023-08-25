import {
  ConstDirectiveNode,
  DefinitionNode,
  DirectiveDefinitionNode,
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
  parse,
  print,
  SchemaDefinitionNode,
  SchemaExtensionNode,
  TypeDefinitionNode,
  TypeExtensionNode,
  visit,
} from 'graphql';
import {
  areBaseAndExtensionKindsCompatible,
  EntityKey,
  extractInterfaces,
  getEntityKeyExtractionResults,
  isNodeExtension,
  isObjectLikeNodeEntity,
  operationTypeNodeToDefaultType,
  stringToNameNode,
} from '../ast/utils';
import {
  areNodeKindAndDirectiveLocationCompatible,
  ChildContainer,
  enumContainerToNode,
  EnumExtensionContainer,
  EnumValueContainer,
  ExtensionContainer,
  ExtensionMap,
  FieldContainer,
  getDefinedArgumentsForDirective,
  getDirectiveDefinitionArgumentSets,
  inputObjectContainerToNode,
  InputObjectExtensionContainer,
  InputValidationContainer,
  InputValueContainer,
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
  validateEntityKeys,
} from './utils';
import {
  BASE_DIRECTIVE_DEFINITIONS,
  BASE_SCALARS,
  VERSION_ONE_DIRECTIVES,
  VERSION_TWO_DIRECTIVE_DEFINITIONS,
  VERSION_TWO_DIRECTIVES,
} from '../utils/constants';
import { getNamedTypeForChild } from '../type-merging/type-merging';
import {
  addIterableValuesToSet,
  getEntriesNotInHashSet,
  getOrThrowError,
  ImplementationErrors,
  InvalidArgument,
  InvalidFieldImplementation,
  isTypeValidImplementation,
  kindToTypeString,
} from '../utils/utils';
import {
  duplicateArgumentsError,
  duplicateDirectiveDefinitionError,
  duplicateEnumValueDefinitionError,
  duplicateFieldDefinitionError,
  duplicateFieldExtensionError,
  duplicateInterfaceExtensionError,
  duplicateOperationTypeDefinitionError,
  duplicateTypeDefinitionError,
  duplicateUnionMemberError,
  duplicateValueExtensionError,
  incompatibleExtensionError,
  incompatibleExtensionKindsError,
  incompatibleParentKindFatalError,
  invalidArgumentsError,
  invalidDirectiveError,
  invalidDirectiveLocationErrorMessage,
  invalidKeyDirectiveArgumentErrorMessage,
  invalidOperationTypeDefinitionError,
  invalidRepeatedDirectiveErrorMessage,
  invalidRootTypeDefinitionError,
  noBaseTypeExtensionError,
  noDefinedUnionMembersError,
  operationDefinitionError,
  subgraphInvalidSyntaxError,
  undefinedDirectiveError,
  undefinedRequiredArgumentsErrorMessage,
  undefinedTypeError,
  unexpectedDirectiveArgumentsErrorMessage,
  unexpectedKindFatalError,
  unimplementedInterfaceFieldsError,
} from '../errors/errors';
import { EXTENDS, KEY, SCHEMA } from '../utils/string-constants';
import { buildASTSchema } from '../buildASTSchema/buildASTSchema';
import { ConfigurationData, ConfigurationDataMap } from '../subgraph/field-configuration';
import { printTypeNode } from '@graphql-tools/merge';

export type NormalizationResult = {
  configurationDataMap: ConfigurationDataMap;
  isVersionTwo: boolean;
  operationTypes: Map<string, OperationTypeNode>;
  schema: GraphQLSchema;
  subgraphAST: DocumentNode;
  subgraphString: string;
};

export type NormalizationResultContainer = {
  errors?: Error[];
  normalizationResult?: NormalizationResult;
};

export function normalizeSubgraphFromString(subgraph: string): NormalizationResultContainer {
  let document;
  try {
    document = parse(subgraph);
  } catch (err) {
    return { errors: [subgraphInvalidSyntaxError(err as Error)] };
  }
  const normalizationFactory = new NormalizationFactory();
  return normalizationFactory.normalize(document);
}

export function normalizeSubgraph(document: DocumentNode): NormalizationResultContainer {
  const normalizationFactory = new NormalizationFactory();
  return normalizationFactory.normalize(document);
}

export class NormalizationFactory {
  allDirectiveDefinitions = new Map<string, DirectiveDefinitionNode>();
  customDirectiveDefinitions = new Map<string, DirectiveDefinitionNode>();
  errors: Error[] = [];
  entityMap = new Map<string, Map<string, EntityKey>>();
  operationTypeNames = new Map<string, OperationTypeNode>();
  parents: ParentMap = new Map<string, ParentContainer>();
  parentTypeName = '';
  parentsWithChildArguments = new Set<string>();
  extensions: ExtensionMap = new Map<string, ExtensionContainer>();
  isChild = false;
  isCurrentParentExtension = false;
  isSubgraphVersionTwo = false;
  schemaDefinition: SchemaContainer;
  referencedDirectives = new Set<string>();
  referencedTypeNames = new Set<string>();

  constructor() {
    for (const baseDirectiveDefinition of BASE_DIRECTIVE_DEFINITIONS) {
      this.allDirectiveDefinitions.set(baseDirectiveDefinition.name.value, baseDirectiveDefinition);
    }
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
    argumentByName: Map<string, InputValueDefinitionNode>,
    fieldPath: string,
  ): Map<string, InputValueDefinitionNode> {
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
      argumentByName.set(argumentName, argumentNode);
    }
    if (duplicatedArguments.size > 0) {
      this.errors.push(duplicateArgumentsError(fieldPath, [...duplicatedArguments]));
    }
    return argumentByName;
  }

  validateArguments(fieldContainer: FieldContainer, fieldPath: string){
    const invalidArguments: InvalidArgument[] = [];
    for (const [argumentName, argumentNode] of fieldContainer.arguments) {
      const namedType = getNamedTypeForChild(fieldPath + `(${argumentName}...)`, argumentNode.type);
      const { hasUnhandledError, typeString } = this.validateInputNamedType(namedType)
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
    node: InterfaceTypeDefinitionNode | InterfaceTypeExtensionNode | ObjectTypeDefinitionNode | ObjectTypeExtensionNode
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
    const interfaces = new Set<string>();
    this.extensions.set(this.parentTypeName, {
      directives: this.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
      fields: new Map<string, FieldContainer>(),
      interfaces: extractInterfaces(node, interfaces, this.errors),
      isEntity,
      kind: convertedKind,
      name: node.name,
    });
    if (node.kind === Kind.INTERFACE_TYPE_DEFINITION
      || node.kind === Kind.INTERFACE_TYPE_EXTENSION
      || !isEntity) {
      return;
    }
    const existingEntityKeyMap = this.entityMap.get(this.parentTypeName);
    const { entityKeyMap, errors } = getEntityKeyExtractionResults(
      node,
      existingEntityKeyMap || new Map<string, EntityKey>(),
    );
    if (errors.length > 0) {
      this.errors.push(...errors);
    }
    if (!existingEntityKeyMap) {
      this.entityMap.set(this.parentTypeName, entityKeyMap);
    }
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

  validateInterfaceImplementations(container: ObjectLikeContainer) {
    if (container.interfaces.size < 1) {
      return;
    }
    const implementationErrorsMap = new Map<string, ImplementationErrors>();
    for (const interfaceName of container.interfaces) {
      const interfaceContainer = getOrThrowError(this.parents, interfaceName);
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
        if (!isTypeValidImplementation(interfaceField.node.type, containerField.node.type)) {
          hasErrors = true;
          hasNestedErrors = true;
          invalidFieldImplementation.implementedResponseType = printTypeNode(containerField.node.type);
        }
        const handledArguments = new Set<string>();
        for (const [argumentName, interfaceArgument] of interfaceField.arguments) {
          handledArguments.add(argumentName);
          const containerArgument = containerField.arguments.get(argumentName)
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
        container.name.value, kindToTypeString(container.kind), implementationErrorsMap
      ));
    }
  }

  normalize(document: DocumentNode) {
    const factory = this;
    visit(document, {
      DirectiveDefinition: {
        enter(node) {
          const name = node.name.value;
          // TODO These sets would potentially allow the user to define these directives more than once
          // Add our definitions rather than the existing ones
          if (VERSION_TWO_DIRECTIVES.has(name)) {
            factory.isSubgraphVersionTwo = true;
            return false;
          }
          if (VERSION_ONE_DIRECTIVES.has(name)) {
            return false;
          }
          const directiveDefinition = factory.allDirectiveDefinitions.get(name);
          if (directiveDefinition) {
            factory.errors.push(duplicateDirectiveDefinitionError(name));
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
          factory.parents.set(name, {
            description: node.description,
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            kind: node.kind,
            name: node.name,
            values: new Map<string, EnumValueContainer>(),
          });
        },
        leave() {
          factory.parentTypeName = '';
        },
      },
      EnumTypeExtension: {
        enter(node) {
          const name = node.name.value;
          factory.parentTypeName = name;
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
          factory.isCurrentParentExtension = false;
          factory.parentTypeName = '';
        },
      },
      EnumValueDefinition: {
        enter(node) {
          const name = node.name.value;
          const parent = factory.isCurrentParentExtension
            ? getOrThrowError(factory.extensions, factory.parentTypeName)
            : getOrThrowError(factory.parents, factory.parentTypeName);
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
            node,
          });
        },
      },
      FieldDefinition: {
        enter(node) {
          const name = node.name.value;
          const fieldPath = `${factory.parentTypeName}.${name}`;
          factory.isChild = true;
          const fieldRootType = getNamedTypeForChild(fieldPath, node.type);
          if (!BASE_SCALARS.has(fieldRootType)) {
            factory.referencedTypeNames.add(fieldRootType);
          }
          const parent = factory.isCurrentParentExtension
            ? getOrThrowError(factory.extensions, factory.parentTypeName)
            : getOrThrowError(factory.parents, factory.parentTypeName);
          if (
            parent.kind !== Kind.OBJECT_TYPE_DEFINITION &&
            parent.kind !== Kind.OBJECT_TYPE_EXTENSION &&
            parent.kind !== Kind.INTERFACE_TYPE_DEFINITION &&
            parent.kind !== Kind.INTERFACE_TYPE_EXTENSION
          ) {
            throw unexpectedKindFatalError(factory.parentTypeName);
          }
          if (parent.fields.has(name)) {
            const error = factory.isCurrentParentExtension
              ? duplicateFieldExtensionError(factory.parentTypeName, name)
              : duplicateFieldDefinitionError(name, factory.parentTypeName);
            factory.errors.push(error);
            return;
          }
          parent.fields.set(name, {
            arguments: factory.extractArguments(node, new Map<string, InputValueDefinitionNode>(), fieldPath),
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            name,
            node,
          });
        },
        leave() {
          factory.isChild = false;
        },
      },
      InputObjectTypeDefinition: {
        enter(node) {
          const name = node.name.value;
          if (factory.parents.has(name)) {
            factory.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), name));
            return false;
          }
          factory.parentTypeName = name;
          factory.parents.set(name, {
            description: node.description,
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            fields: new Map<string, InputValueContainer>(),
            kind: node.kind,
            name: node.name,
          });
        },
        leave() {
          factory.parentTypeName = '';
        },
      },
      InputObjectTypeExtension: {
        enter(node) {
          const name = node.name.value;
          factory.parentTypeName = name;
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
          factory.isCurrentParentExtension = false;
          factory.parentTypeName = '';
        },
      },
      InputValueDefinition: {
        enter(node) {
          if (!factory.parentTypeName || factory.isChild) {
            return;
          }
          const name = node.name.value;
          const parent = factory.isCurrentParentExtension
            ? getOrThrowError(factory.extensions, factory.parentTypeName)
            : getOrThrowError(factory.parents, factory.parentTypeName);
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
            node,
          });
        },
      },
      InterfaceTypeDefinition: {
        enter(node) {
          const name = node.name.value;
          factory.parentTypeName = name;
          if (isNodeExtension(node)) {
            return factory.handleObjectLikeExtension(node);
          }
          if (factory.parents.has(name)) {
            factory.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), name));
            return false;
          }
          factory.parents.set(name, {
            description: node.description,
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            fields: new Map<string, FieldContainer>(),
            interfaces: extractInterfaces(node, new Set<string>(), factory.errors),
            kind: node.kind,
            name: node.name,
          });
        },
        leave() {
          factory.isCurrentParentExtension = false;
          factory.parentTypeName = '';
        },
      },
      InterfaceTypeExtension: {
        enter(node) {
          factory.parentTypeName = node.name.value;
          return factory.handleObjectLikeExtension(node);
        },
        leave() {
          factory.isCurrentParentExtension = false;
          factory.parentTypeName = '';
        },
      },
      ObjectTypeDefinition: {
        enter(node) {
          const name = node.name.value;
          factory.parentTypeName = name;
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
            description: node.description,
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
          const existingEntityKeyMap = factory.entityMap.get(name);
          const { entityKeyMap, errors } = getEntityKeyExtractionResults(
            node,
            existingEntityKeyMap || new Map<string, EntityKey>(),
          );
          if (errors.length > 0) {
            factory.errors.push(...errors);
          }
          if (!existingEntityKeyMap) {
            factory.entityMap.set(name, entityKeyMap);
          }
        },
        leave() {
          factory.isCurrentParentExtension = false;
          factory.parentTypeName = '';
        },
      },
      ObjectTypeExtension: {
        enter(node) {
          factory.parentTypeName = node.name.value;
          return factory.handleObjectLikeExtension(node);
        },
        leave() {
          factory.isCurrentParentExtension = false;
          factory.parentTypeName = '';
        },
      },
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
      ScalarTypeDefinition: {
        enter(node) {
          const name = node.name.value;
          const parent = factory.parents.get(name);
          if (parent) {
            factory.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), name));
            return false;
          }
          factory.parents.set(name, {
            description: node.description,
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            kind: Kind.SCALAR_TYPE_DEFINITION,
            name: node.name,
          });
        },
      },
      ScalarTypeExtension: {
        enter(node) {
          const name = node.name.value;
          const extension = factory.extensions.get(name);
          if (extension) {
            if (extension.kind !== Kind.SCALAR_TYPE_EXTENSION) {
              factory.errors.push(incompatibleExtensionKindsError(node, extension.kind));
              return false;
            }
            factory.extractDirectives(node, extension.directives);
          } else {
            factory.extensions.set(name, {
              directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
              kind: node.kind,
              name: node.name,
            });
          }
          return false;
        },
      },
      SchemaDefinition: {
        enter(node) {
          factory.extractDirectives(node, factory.schemaDefinition.directives);
          factory.schemaDefinition.description = factory.schemaDefinition.description || node.description;
        },
      },
      SchemaExtension: {
        enter(node) {
          factory.extractDirectives(node, factory.schemaDefinition.directives);
        },
      },
      UnionTypeDefinition: {
        enter(node) {
          const name = node.name.value;
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
          factory.parents.set(name, {
            description: node.description,
            directives: factory.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
            kind: node.kind,
            name: node.name,
            types: factory.extractUniqueUnionMembers([...node.types], new Map<string, NamedTypeNode>()),
          });
        },
        leave() {
          factory.parentTypeName = '';
        },
      },
      UnionTypeExtension: {
        enter(node) {
          const name = node.name.value;
          const extension = factory.extensions.get(name);
          if (!node.types) {
            factory.errors.push();
            return false;
          }
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
      },
    });
    const definitions: DefinitionNode[] = [];
    for (const directiveDefinition of BASE_DIRECTIVE_DEFINITIONS) {
      definitions.push(directiveDefinition);
    }
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
    // configurationDataMap is map of ConfigurationData per type name.
    // It is an Intermediate configuration object that will be converted to an engine configuration in the router
    const configurationDataMap = new Map<string, ConfigurationData>();
    const validExtensionOrphans = new Set<string>();
    const parentsToIgnore = new Set<string>();
    for (const [typeName, extension] of this.extensions) {
      const entity = this.entityMap.get(typeName);
      const configurationData: ConfigurationData = {
        fieldNames: new Set<string>(),
        isRootNode: !!entity,
        typeName,
      };
      if (entity) {
        configurationData.keys = [...entity.keys()].map((selectionSet) => ({
          fieldName: '', selectionSet,
        }));
      }
      if (extension.kind === Kind.OBJECT_TYPE_EXTENSION) {
        addIterableValuesToSet(extension.fields.keys(), configurationData.fieldNames);
        configurationDataMap.set(typeName, configurationData);
      }
      const baseType = this.parents.get(typeName);
      if (!baseType) {
        if (extension.kind !== Kind.OBJECT_TYPE_EXTENSION) {
          this.errors.push(noBaseTypeExtensionError(typeName));
        } else {
          validateEntityKeys(this, typeName, true);
          this.validateInterfaceImplementations(extension);
          validExtensionOrphans.add(typeName);
          definitions.push(objectLikeContainerToNode(this, extension));
        }
        continue;
      }
      if (!areBaseAndExtensionKindsCompatible(baseType.kind, extension.kind, typeName)) {
        this.errors.push(incompatibleExtensionError(typeName, baseType.kind, extension.kind));
        continue;
      }
      switch (baseType.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
          const enumExtension = extension as EnumExtensionContainer;
          for (const [valueName, enumValueDefinitionNode] of enumExtension.values) {
            if (!baseType.values.has(valueName)) {
              baseType.values.set(valueName, enumValueDefinitionNode);
              continue;
            }
            this.errors.push(duplicateEnumValueDefinitionError(valueName, typeName));
          }
          definitions.push(enumContainerToNode(this, baseType, enumExtension));
          break;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          const inputExtension = extension as InputObjectExtensionContainer;
          for (const [fieldName, inputValueDefinitionNode] of inputExtension.fields) {
            if (!baseType.fields.has(fieldName)) {
              baseType.fields.set(fieldName, inputValueDefinitionNode);
              continue;
            }
            this.errors.push(duplicateFieldDefinitionError(fieldName, typeName));
          }
          definitions.push(inputObjectContainerToNode(this, baseType, inputExtension));
          break;
        case Kind.INTERFACE_TYPE_DEFINITION:
          // intentional fallthrough
        case Kind.OBJECT_TYPE_DEFINITION:
          const objectLikeExtension = extension as ObjectLikeExtensionContainer;
          for (const [fieldName, fieldContainer] of objectLikeExtension.fields) {
            if (fieldContainer.arguments.size > 0) {
              // Arguments can only be fully validated once all parents types are known
              this.validateArguments(fieldContainer, `${typeName}.${fieldName}`);
            }
            if (baseType.fields.has(fieldName)) {
              this.errors.push(duplicateFieldDefinitionError(fieldName, typeName));
              continue;
            }
            baseType.fields.set(fieldName, fieldContainer);
            configurationData.fieldNames.add(fieldName);
          }
          validateEntityKeys(this, typeName);
          this.mergeUniqueInterfaces(objectLikeExtension.interfaces, baseType.interfaces, typeName);
          this.validateInterfaceImplementations(baseType);
          configurationDataMap.set(typeName, configurationData);
          definitions.push(objectLikeContainerToNode(this, baseType, objectLikeExtension));
          break;
        case Kind.SCALAR_TYPE_DEFINITION:
          definitions.push(scalarContainerToNode(this, baseType, extension as ScalarExtensionContainer));
          break;
        case Kind.UNION_TYPE_DEFINITION:
          const unionExtension = extension as UnionExtensionContainer;
          definitions.push(unionContainerToNode(this, baseType, unionExtension));
          break;
        default:
          throw unexpectedKindFatalError(typeName);
      }
      // At this point, the base type has been dealt with, so it doesn't need to be dealt with again
      parentsToIgnore.add(typeName);
    }
    for (const [typeName, parentContainer] of this.parents) {
      if (parentsToIgnore.has(typeName)) {
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
          const entity = this.entityMap.get(typeName);
          if (this.parentsWithChildArguments.has(typeName)) {
            const parentContainer = getOrThrowError(this.parents, typeName);
            if (parentContainer.kind !== Kind.OBJECT_TYPE_DEFINITION
              && parentContainer.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
              continue;
            }
            for (const [fieldName, fieldContainer] of parentContainer.fields) {
              // Arguments can only be fully validated once all parents types are known
              this.validateArguments(fieldContainer, `${typeName}.${fieldName}`);
            }
          }
          const configurationData: ConfigurationData = {
            fieldNames: new Set<string>(),
            isRootNode: !!entity,
            typeName,
          };
          if (entity) {
            configurationData.keys = [...entity.keys()].map((selectionSet) => ({
              fieldName: '', selectionSet,
            }));
          }
          addIterableValuesToSet(parentContainer.fields.keys(), configurationData.fieldNames);
          validateEntityKeys(this, typeName);
          this.validateInterfaceImplementations(parentContainer);
          configurationDataMap.set(typeName, configurationData);
          definitions.push(objectLikeContainerToNode(this, parentContainer));
          break;
        case Kind.SCALAR_TYPE_DEFINITION:
          definitions.push(scalarContainerToNode(this, parentContainer));
          break;
        case Kind.UNION_TYPE_DEFINITION:
          definitions.push(unionContainerToNode(this, parentContainer));
          break;
        default:
          throw unexpectedKindFatalError(typeName);
      }
    }
    // Check that explicitly defined operations types are valid objects and that their fields are also valid
    for (const operationType of Object.values(OperationTypeNode)) {
      const node = this.schemaDefinition.operationTypes.get(operationType);
      const defaultTypeName = getOrThrowError(operationTypeNodeToDefaultType, operationType);
      // If an operation type name was not declared, use the default
      const operationTypeName = node ? getNamedTypeForChild(`schema.${operationType}`, node.type) : defaultTypeName;
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
      const rootNode = configurationDataMap.get(operationTypeName);
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
        // Operations whose response type is an extension orphan could be valid through a federated graph
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
      if (!this.parents.has(referencedTypeName) && !this.entityMap.has(referencedTypeName)) {
        this.errors.push(undefinedTypeError(referencedTypeName));
      }
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
        configurationDataMap,
        isVersionTwo: this.isSubgraphVersionTwo,
        operationTypes: this.operationTypeNames,
        subgraphAST: newAST,
        subgraphString: print(newAST),
        schema: buildASTSchema(newAST, { assumeValid: true }),
      },
    };
  }
}
