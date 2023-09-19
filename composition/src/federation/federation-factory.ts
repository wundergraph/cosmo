import { MultiGraph } from 'graphology';
import {
  buildASTSchema,
  ConstDirectiveNode,
  ConstValueNode,
  DirectiveDefinitionNode,
  DocumentNode,
  EnumValueDefinitionNode,
  FieldDefinitionNode,
  InputValueDefinitionNode,
  Kind,
  NamedTypeNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  TypeDefinitionNode,
  TypeNode,
} from 'graphql';
import {
  ConstValueNodeWithValue,
  directiveDefinitionNodeToMutable,
  enumTypeDefinitionNodeToMutable,
  enumValueDefinitionNodeToMutable,
  fieldDefinitionNodeToMutable,
  inputObjectTypeDefinitionNodeToMutable,
  inputValueDefinitionNodeToMutable,
  interfaceTypeDefinitionNodeToMutable,
  MutableEnumValueDefinitionNode,
  MutableInputValueDefinitionNode,
  MutableTypeDefinitionNode,
  objectTypeDefinitionNodeToMutable,
  objectTypeExtensionNodeToMutable,
  objectTypeExtensionNodeToMutableDefinitionNode,
  scalarTypeDefinitionNodeToMutable,
  unionTypeDefinitionNodeToMutable,
} from '../ast/ast';
import {
  extractExecutableDirectiveLocations,
  extractInterfaces,
  isNodeExternal,
  isNodeOverridden,
  isNodeShareable,
  mergeExecutableDirectiveLocations,
  pushPersistedDirectivesAndGetNode,
  setLongestDescriptionForNode,
  setToNameNodeArray,
  stringToNamedTypeNode,
} from '../ast/utils';
import {
  argumentTypeMergeFatalError,
  federationInvalidParentTypeError,
  federationRequiredInputFieldError,
  fieldTypeMergeFatalError,
  incompatibleArgumentDefaultValueError,
  incompatibleArgumentDefaultValueTypeError,
  incompatibleArgumentTypesError,
  incompatibleChildTypesError,
  incompatibleParentKindFatalError,
  incompatibleSharedEnumError,
  invalidDeprecatedDirectiveError,
  invalidRequiredArgumentsError,
  invalidSubgraphNameErrorMessage,
  invalidSubgraphNamesError,
  invalidTagDirectiveError,
  invalidUnionError,
  minimumSubgraphRequirementError,
  noBaseTypeExtensionError,
  noConcreteTypesForAbstractTypeError,
  noQueryRootTypeError,
  shareableFieldDefinitionsError,
  subgraphValidationError,
  subgraphValidationFailureErrorMessage,
  undefinedTypeError,
  unexpectedArgumentKindFatalError,
  unexpectedKindFatalError,
  unexpectedObjectResponseType,
  unexpectedParentKindErrorMessage,
  unimplementedInterfaceFieldsError,
  unresolvableFieldError,
} from '../errors/errors';
import {
  getLeastRestrictiveMergedTypeNode,
  getMostRestrictiveMergedTypeNode,
  getNamedTypeForChild,
  isTypeRequired,
} from '../type-merging/type-merging';
import {
  ArgumentContainer,
  ArgumentMap,
  DeprecatedDirectiveContainer,
  DirectiveContainer,
  DirectiveMap,
  EntityContainer,
  EnumValueContainer,
  ExtensionContainer,
  FederationResultContainer,
  FieldContainer,
  InputValueContainer,
  InterfaceContainer,
  MergeMethod,
  newPersistedDirectivesContainer,
  ObjectContainer,
  ObjectLikeContainer,
  ParentContainer,
  ParentMap,
  PersistedDirectivesContainer,
  RootTypeFieldData,
} from './utils';
import {
  InternalSubgraph,
  Subgraph,
  validateSubgraphName,
  walkSubgraphToCollectFields,
  walkSubgraphToCollectObjectLikesAndDirectiveDefinitions,
  walkSubgraphToFederate,
} from '../subgraph/subgraph';
import {
  DEFAULT_MUTATION,
  DEFAULT_QUERY,
  DEFAULT_SUBSCRIPTION,
  DEPRECATED,
  DIRECTIVE_DEFINITION,
  ENTITIES,
  EXTENSIONS,
  FIELD,
  INACCESSIBLE,
  PARENTS,
  QUERY,
  ROOT_TYPES,
  SELECTION_REPRESENTATION,
  TAG,
} from '../utils/string-constants';
import {
  addIterableValuesToSet,
  doSetsHaveAnyOverlap,
  getAllMutualEntries,
  getEntriesNotInHashSet,
  getOrThrowError,
  hasSimplePath,
  ImplementationErrors,
  InvalidFieldImplementation,
  InvalidRequiredArgument,
  kindToTypeString,
} from '../utils/utils';
import { printTypeNode } from '@graphql-tools/merge';
import { ArgumentConfigurationData } from '../subgraph/field-configuration';
import { BASE_SCALARS } from '../utils/constants';
import { normalizeSubgraph } from '../normalization/normalization-factory';

export class FederationFactory {
  abstractToConcreteTypeNames = new Map<string, Set<string>>();
  areFieldsExternal = false;
  areFieldsShareable = false;
  argumentTypeNameSet = new Set<string>();
  argumentConfigurations: ArgumentConfigurationData[] = [];
  executableDirectives = new Set<string>();
  parentTypeName = '';
  persistedDirectives = new Set<string>([DEPRECATED, INACCESSIBLE, TAG]);
  currentSubgraphName = '';
  childName = '';
  directiveDefinitions: DirectiveMap = new Map<string, DirectiveContainer>();
  entities = new Map<string, EntityContainer>();
  errors: Error[] = [];
  extensions = new Map<string, ExtensionContainer>();
  graph: MultiGraph = new MultiGraph();
  graphEdges = new Set<string>();
  graphPaths = new Map<string, boolean>();
  inputFieldTypeNameSet = new Set<string>();
  isCurrentParentEntity = false;
  isCurrentParentInterface = false;
  isCurrentSubgraphVersionTwo = false;
  isCurrentParentExtensionType = false;
  isParentRootType = false;
  isParentInputObject = false;
  keyFieldsByParentTypeName = new Map<string, Set<string>>();
  outputFieldTypeNameSet = new Set<string>();
  parents: ParentMap = new Map<string, ParentContainer>();
  rootTypeNames = new Set<string>([DEFAULT_MUTATION, DEFAULT_QUERY, DEFAULT_SUBSCRIPTION]);
  subgraphs: InternalSubgraph[] = [];
  shareableErrorTypeNames = new Map<string, Set<string>>();
  evaluatedObjectLikesBySubgraph = new Map<string, Set<string>>();

  constructor(subgraphs: InternalSubgraph[]) {
    this.subgraphs = subgraphs;
  }

  isObjectRootType(node: ObjectTypeDefinitionNode | ObjectTypeExtensionNode): boolean {
    return this.rootTypeNames.has(node.name.value);
  }

  upsertEntity(node: ObjectTypeDefinitionNode | ObjectTypeExtensionNode) {
    const typeName = node.name.value;
    const entity = this.entities.get(typeName);
    if (entity) {
      entity.subgraphs.add(this.currentSubgraphName);
      return;
    }
    this.entities.set(typeName, {
      fields: new Set<string>(),
      subgraphs: new Set<string>([this.currentSubgraphName]),
    });
  }

  populateMultiGraphAndRenameOperations(subgraphs: InternalSubgraph[]) {
    for (const subgraph of subgraphs) {
      this.currentSubgraphName = subgraph.name;
      walkSubgraphToCollectObjectLikesAndDirectiveDefinitions(this, subgraph);
      walkSubgraphToCollectFields(this, subgraph);
    }
  }

  getEnumMergeMethod(enumName: string): MergeMethod {
    if (this.inputFieldTypeNameSet.has(enumName) || this.argumentTypeNameSet.has(enumName)) {
      if (this.outputFieldTypeNameSet.has(enumName)) {
        return MergeMethod.CONSISTENT;
      }
      return MergeMethod.INTERSECTION;
    }
    return MergeMethod.UNION;
  }

  validateArgumentDefaultValues(
    argName: string,
    existingDefaultValue: ConstValueNodeWithValue,
    newDefaultValue: ConstValueNode,
  ) {
    if (existingDefaultValue.kind !== newDefaultValue.kind) {
      // This should be caught by subgraph validation
      this.errors.push(
        incompatibleArgumentDefaultValueTypeError(
          argName,
          this.parentTypeName,
          this.childName,
          existingDefaultValue.kind,
          newDefaultValue.kind,
        ),
      );
    }
    if ('value' in newDefaultValue && existingDefaultValue.value !== newDefaultValue.value) {
      this.errors.push(
        incompatibleArgumentDefaultValueError(
          argName,
          this.parentTypeName,
          this.childName,
          existingDefaultValue.value,
          newDefaultValue.value,
        ),
      );
    }
  }

  compareAndValidateArgumentDefaultValues(existingArg: ArgumentContainer, newArg: InputValueDefinitionNode) {
    const newDefaultValue = newArg.defaultValue;
    existingArg.node.defaultValue = existingArg.node.defaultValue || newDefaultValue;
    if (!existingArg.node.defaultValue || !newDefaultValue) {
      existingArg.includeDefaultValue = false;
      return;
    }
    const argumentName = existingArg.node.name.value;
    const existingDefaultValue = existingArg.node.defaultValue;
    switch (existingDefaultValue.kind) {
      case Kind.LIST: // TODO
        break;
      case Kind.NULL:
        break;
      case Kind.OBJECT:
        break;
      // BOOLEAN, ENUM, FLOAT, INT, and STRING purposely fall through
      case Kind.BOOLEAN:
      case Kind.ENUM:
      case Kind.FLOAT:
      case Kind.INT:
      case Kind.STRING:
        this.validateArgumentDefaultValues(argumentName, existingDefaultValue, newDefaultValue);
        break;
      default:
        throw unexpectedArgumentKindFatalError(argumentName, this.childName);
    }
  }

  upsertRequiredSubgraph(set: Set<string>, isRequired: boolean): Set<string> {
    if (isRequired) {
      set.add(this.currentSubgraphName);
    }
    return set;
  }

  upsertExtensionFieldArgumentPersistedDirectives(extensionDirectives: PersistedDirectivesContainer, baseDirectives: PersistedDirectivesContainer) {
    // Add unique tag directives
    for (const [tagValue, tagDirectiveNode] of extensionDirectives.tags) {
      baseDirectives.tags.set(tagValue, tagDirectiveNode);
    }
    // Push other directives
    for (const [directiveName, directiveNodes] of extensionDirectives.directives) {
      const existingDirectives = baseDirectives.directives.get(directiveName);
      if (!existingDirectives) {
        baseDirectives.directives.set(directiveName, directiveNodes);
        continue;
      }
      existingDirectives.push(...directiveNodes);
    }
    // If the extension has no deprecated directive, there's nothing further to do
    const extensionDeprecatedDirective = extensionDirectives.deprecated.directive;
    const extensionDeprecatedReason = extensionDirectives.deprecated.reason;
    if (!extensionDeprecatedDirective || !extensionDeprecatedReason) {
      return;
    }
    // If there is no reason or the existing reason is longer, return
    if (
      baseDirectives.deprecated.directive && baseDirectives.deprecated.reason
      && extensionDeprecatedReason.length < baseDirectives.deprecated.reason.length
    ) {
      return;
    }
    // Only update if the new reason is longer
    baseDirectives.deprecated.directive = extensionDeprecatedDirective;
    baseDirectives.deprecated.reason = extensionDeprecatedReason;
  }

  upsertExtensionFieldArguments(extensionFieldArguments: ArgumentMap, baseFieldArguments: ArgumentMap) {
    for (const [argumentName, extensionArgumentContainer] of extensionFieldArguments) {
      const existingArgumentContainer = baseFieldArguments.get(argumentName);
      if (!existingArgumentContainer) {
        // If the argument doesn't exist on the base field, simply add it
        baseFieldArguments.set(argumentName, extensionArgumentContainer);
        continue;
      }
      if (extensionArgumentContainer.requiredSubgraphs.size > 0) {
        // If the argument is required on any extensions, add it to the base requiredSubgraphs set
        addIterableValuesToSet(
          extensionArgumentContainer.requiredSubgraphs, existingArgumentContainer.requiredSubgraphs,
        );
      }
      // Add the subgraphs in which the extensions' arguments are found to the base subgraphs set
      addIterableValuesToSet(extensionArgumentContainer.subgraphs, existingArgumentContainer.subgraphs);
      // Set the most restrictive type for the argument
      const { typeErrors, typeNode } = getMostRestrictiveMergedTypeNode(
        existingArgumentContainer.node.type,
        extensionArgumentContainer.node.type,
        this.childName,
        argumentName,
      );
      if (typeNode) {
        existingArgumentContainer.node.type = typeNode;
      } else {
        if (!typeErrors || typeErrors.length < 2) {
          throw argumentTypeMergeFatalError(argumentName, this.childName);
        }
        this.errors.push(
          incompatibleArgumentTypesError(argumentName, this.parentTypeName, this.childName, typeErrors[0], typeErrors[1]),
        );
      }
      this.compareAndValidateArgumentDefaultValues(existingArgumentContainer, extensionArgumentContainer.node);
      this.upsertExtensionFieldArgumentPersistedDirectives(
        extensionArgumentContainer.directives, existingArgumentContainer.directives,
      );
    }
  }

  // TODO validation of default values
  upsertArguments(node: DirectiveDefinitionNode | FieldDefinitionNode, argumentMap: ArgumentMap): ArgumentMap {
    if (!node.arguments) {
      return argumentMap;
    }
    for (const argumentNode of node.arguments) {
      const argName = argumentNode.name.value;
      const argPath = `${node.name.value}(${argName}...)`;
      this.argumentTypeNameSet.add(getNamedTypeForChild(argPath, argumentNode.type));
      const isRequired = isTypeRequired(argumentNode.type);
      const existingArgumentContainer = argumentMap.get(argName);
      if (!existingArgumentContainer) {
        argumentMap.set(argName, {
          directives: this.extractPersistedDirectives(
            argumentNode.directives || [], newPersistedDirectivesContainer(),
          ),
          includeDefaultValue: !!argumentNode.defaultValue,
          node: inputValueDefinitionNodeToMutable(argumentNode, this.childName),
          requiredSubgraphs: this.upsertRequiredSubgraph(new Set<string>(), isRequired),
          subgraphs: new Set<string>([this.currentSubgraphName]),
        });
        continue;
      }
      this.extractPersistedDirectives(argumentNode.directives || [], existingArgumentContainer.directives);
      setLongestDescriptionForNode(existingArgumentContainer.node, argumentNode.description);
      this.upsertRequiredSubgraph(existingArgumentContainer.requiredSubgraphs, isRequired);
      existingArgumentContainer.subgraphs.add(this.currentSubgraphName);
      const { typeErrors, typeNode } = getMostRestrictiveMergedTypeNode(
        existingArgumentContainer.node.type,
        argumentNode.type,
        this.childName,
        argName,
      );
      if (typeNode) {
        existingArgumentContainer.node.type = typeNode;
      } else {
        if (!typeErrors || typeErrors.length < 2) {
          throw argumentTypeMergeFatalError(argName, this.childName);
        }
        this.errors.push(
          incompatibleArgumentTypesError(argName, this.parentTypeName, this.childName, typeErrors[0], typeErrors[1]),
        );
      }
      this.compareAndValidateArgumentDefaultValues(existingArgumentContainer, argumentNode);
    }
    return argumentMap;
  }

  isFieldEntityKey(): boolean {
    const parent = this.keyFieldsByParentTypeName.get(this.parentTypeName);
    if (parent) {
      return parent.has(this.childName);
    }
    return false;
  }

  isFieldExternal(node: FieldDefinitionNode): boolean {
    return this.areFieldsExternal || isNodeExternal(node);
  }

  isFieldShareable(node: FieldDefinitionNode, parent: ParentContainer | ExtensionContainer): boolean {
    return (
      !this.isCurrentSubgraphVersionTwo
      || this.areFieldsShareable
      || this.isFieldEntityKey()
      || isNodeShareable(node)
      || isNodeOverridden(node)
    );
  }

  upsertDirectiveNode(node: DirectiveDefinitionNode) {
    const directiveName = node.name.value;
    const directiveDefinition = this.directiveDefinitions.get(directiveName);
    if (directiveDefinition) {
      if (!this.executableDirectives.has(directiveName)) {
        return;
      }
      if (mergeExecutableDirectiveLocations(node.locations, directiveDefinition).size < 1) {
        this.executableDirectives.delete(directiveName);
        return;
      }
      this.upsertArguments(node, directiveDefinition.arguments);
      setLongestDescriptionForNode(directiveDefinition.node, node.description);
      directiveDefinition.node.repeatable = directiveDefinition.node.repeatable && node.repeatable;
      directiveDefinition.subgraphs.add(this.currentSubgraphName);
      return;
    }
    const executableLocations = extractExecutableDirectiveLocations(node.locations, new Set<string>());
    this.directiveDefinitions.set(directiveName, {
      arguments: this.upsertArguments(node, new Map<string, ArgumentContainer>()),
      executableLocations,
      node: directiveDefinitionNodeToMutable(node),
      subgraphs: new Set<string>([this.currentSubgraphName]),
    });
    if (executableLocations.size > 0) {
      this.executableDirectives.add(directiveName);
    }
  }

  areAllFieldInstancesExternalOrShareable(fieldContainer: FieldContainer) {
    let shareableFields = 0;
    let unshareableFields = 0;
    for (const [subgraphName, isShareable] of fieldContainer.subgraphsByShareable) {
      if (isShareable) {
        shareableFields += 1;
        if (shareableFields && unshareableFields) {
          return false;
        }
        continue;
      }
      if (fieldContainer.subgraphsByExternal.get(subgraphName)) {
        continue;
      }
      unshareableFields += 1;
      if (shareableFields || unshareableFields > 1) {
        return false;
      }
    }
    return true;
  }

  upsertFieldNode(node: FieldDefinitionNode) {
    const parent = this.isCurrentParentExtensionType
      ? getOrThrowError(this.extensions, this.parentTypeName, EXTENSIONS)
      : getOrThrowError(this.parents, this.parentTypeName, PARENTS);
    if (
      parent.kind !== Kind.OBJECT_TYPE_DEFINITION
      && parent.kind !== Kind.INTERFACE_TYPE_DEFINITION
      && parent.kind !== Kind.OBJECT_TYPE_EXTENSION
    ) {
      throw unexpectedKindFatalError(this.parentTypeName);
    }
    const fieldMap = parent.fields;
    const isFieldExternal = this.isFieldExternal(node);
    const isFieldShareable = this.isFieldShareable(node, parent);
    const fieldPath = `${this.parentTypeName}.${this.childName}`;
    const fieldRootTypeName = getNamedTypeForChild(fieldPath, node.type);
    const existingFieldContainer = fieldMap.get(this.childName);
    if (existingFieldContainer) {
      this.extractPersistedDirectives(node.directives || [], existingFieldContainer.directives);
      setLongestDescriptionForNode(existingFieldContainer.node, node.description);
      existingFieldContainer.subgraphs.add(this.currentSubgraphName);
      existingFieldContainer.subgraphsByShareable.set(this.currentSubgraphName, isFieldShareable);
      existingFieldContainer.subgraphsByExternal.set(this.currentSubgraphName, isFieldExternal);
      const { typeErrors, typeNode } = getLeastRestrictiveMergedTypeNode(
        existingFieldContainer.node.type,
        node.type,
        this.parentTypeName,
        this.childName,
      );
      if (typeNode) {
        existingFieldContainer.node.type = typeNode;
      } else {
        if (!typeErrors || typeErrors.length < 2) {
          throw fieldTypeMergeFatalError(this.childName);
        }
        this.errors.push(
          incompatibleChildTypesError(this.parentTypeName, this.childName, typeErrors[0], typeErrors[1]),
        );
      }
      this.upsertArguments(node, existingFieldContainer.arguments);
      /* A field is valid if one of the following is true:
        1. The field is an interface
        2. The field is external
        3. The existing fields AND the current field are ALL shareable
        4. All other fields besides the current field are external
      */
      if (this.isCurrentParentInterface
        || isFieldExternal
        || (existingFieldContainer.isShareable && isFieldShareable)
        || this.areAllFieldInstancesExternalOrShareable(existingFieldContainer)
      ) {
        return;
      }
      const shareableErrorTypeNames = this.shareableErrorTypeNames.get(this.parentTypeName);
      if (shareableErrorTypeNames) {
        shareableErrorTypeNames.add(this.childName);
      } else {
        this.shareableErrorTypeNames.set(this.parentTypeName, new Set<string>([this.childName]));
      }
      return;
    }
    this.outputFieldTypeNameSet.add(fieldRootTypeName);
    fieldMap.set(this.childName, {
      arguments: this.upsertArguments(node, new Map<string, ArgumentContainer>()),
      directives: this.extractPersistedDirectives(
        node.directives || [], newPersistedDirectivesContainer(),
      ),
      isShareable: isFieldShareable,
      node: fieldDefinitionNodeToMutable(node, this.parentTypeName),
      namedTypeName: fieldRootTypeName,
      subgraphs: new Set<string>([this.currentSubgraphName]),
      subgraphsByShareable: new Map<string, boolean>([[this.currentSubgraphName, isFieldShareable]]),
      subgraphsByExternal: new Map<string, boolean>([[this.currentSubgraphName, isFieldExternal]]),
    });
  }

  upsertValueNode(node: EnumValueDefinitionNode | InputValueDefinitionNode) {
    const parent = this.parents.get(this.parentTypeName);
    switch (node.kind) {
      case Kind.ENUM_VALUE_DEFINITION:
        if (!parent) {
          // This should never happen
          throw federationInvalidParentTypeError(this.parentTypeName, this.childName);
        }
        if (parent.kind !== Kind.ENUM_TYPE_DEFINITION) {
          throw incompatibleParentKindFatalError(this.parentTypeName, Kind.ENUM_TYPE_DEFINITION, parent.kind);
        }
        const enumValues = parent.values;
        const enumValueContainer = enumValues.get(this.childName);
        if (enumValueContainer) {
          this.extractPersistedDirectives(node.directives || [], enumValueContainer.directives);
          setLongestDescriptionForNode(enumValueContainer.node, node.description);
          enumValueContainer.appearances += 1;
          return;
        }
        enumValues.set(this.childName, {
          appearances: 1,
          directives: this.extractPersistedDirectives(
            node.directives || [], newPersistedDirectivesContainer(),
          ),
          node: enumValueDefinitionNodeToMutable(node),
        });
        return;
      case Kind.INPUT_VALUE_DEFINITION:
        if (!parent || !this.isParentInputObject) {
          // these are arguments to a directive
          return;
        }
        if (parent.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION) {
          throw incompatibleParentKindFatalError(this.parentTypeName, Kind.INPUT_OBJECT_TYPE_DEFINITION, parent.kind);
        }
        const inputValues = parent.fields;
        const inputValueContainer = inputValues.get(this.childName);
        if (inputValueContainer) {
          this.extractPersistedDirectives(node.directives || [], inputValueContainer.directives);
          inputValueContainer.appearances += 1;
          setLongestDescriptionForNode(inputValueContainer.node, node.description);
          const { typeErrors, typeNode } = getMostRestrictiveMergedTypeNode(
            inputValueContainer.node.type,
            node.type,
            this.parentTypeName,
            this.childName,
          );
          if (typeNode) {
            inputValueContainer.node.type = typeNode;
          } else {
            if (!typeErrors || typeErrors.length < 2) {
              throw fieldTypeMergeFatalError(this.childName);
            }
            this.errors.push(
              incompatibleChildTypesError(this.parentTypeName, this.childName, typeErrors[0], typeErrors[1]),
            );
          }
          return;
        }
        const valuePath = `${this.parentTypeName}.${this.childName}`;
        const inputValueNamedType = getNamedTypeForChild(valuePath, node.type);
        this.inputFieldTypeNameSet.add(inputValueNamedType);
        inputValues.set(this.childName, {
          appearances: 1,
          directives: this.extractPersistedDirectives(
            node.directives || [], newPersistedDirectivesContainer(),
          ),
          includeDefaultValue: !!node.defaultValue,
          node: inputValueDefinitionNodeToMutable(node, this.parentTypeName),
        });
        return;
      default:
        throw unexpectedKindFatalError(this.childName);
    }
  }

  upsertParentNode(node: TypeDefinitionNode) {
    const parentTypeName = node.name.value;
    const parent = this.parents.get(parentTypeName);
    if (parent) {
      setLongestDescriptionForNode(parent.node, node.description);
      this.extractPersistedDirectives(node.directives || [], parent.directives);
    }
    switch (node.kind) {
      case Kind.ENUM_TYPE_DEFINITION:
        if (parent) {
          if (parent.kind !== node.kind) {
            throw incompatibleParentKindFatalError(parentTypeName, node.kind, parent.kind);
          }
          parent.appearances += 1;
          return;
        }
        this.parents.set(parentTypeName, {
          appearances: 1,
          directives: this.extractPersistedDirectives(
            node.directives || [], newPersistedDirectivesContainer(),
          ),
          values: new Map<string, EnumValueContainer>(),
          kind: node.kind,
          node: enumTypeDefinitionNodeToMutable(node),
        });
        return;
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
        if (parent) {
          if (parent.kind !== node.kind) {
            throw incompatibleParentKindFatalError(parentTypeName, node.kind, parent.kind);
          }
          parent.appearances += 1;
          return;
        }
        this.parents.set(parentTypeName, {
          appearances: 1,
          directives: this.extractPersistedDirectives(
            node.directives || [], newPersistedDirectivesContainer(),
          ),
          fields: new Map<string, InputValueContainer>(),
          kind: node.kind,
          node: inputObjectTypeDefinitionNodeToMutable(node),
        });
        return;
      case Kind.INTERFACE_TYPE_DEFINITION:
        if (parent) {
          if (parent.kind !== node.kind) {
            throw incompatibleParentKindFatalError(parentTypeName, node.kind, parent.kind);
          }
          extractInterfaces(node, parent.interfaces);
          parent.subgraphs.add(this.currentSubgraphName);
          return;
        }
        const nestedInterfaces = new Set<string>();
        extractInterfaces(node, nestedInterfaces);
        this.parents.set(parentTypeName, {
          directives: this.extractPersistedDirectives(
            node.directives || [], newPersistedDirectivesContainer(),
          ),
          fields: new Map<string, FieldContainer>(),
          interfaces: nestedInterfaces,
          kind: node.kind,
          node: interfaceTypeDefinitionNodeToMutable(node),
          subgraphs: new Set<string>([this.currentSubgraphName]),
        });
        return;
      case Kind.SCALAR_TYPE_DEFINITION:
        if (parent) {
          if (parent.kind !== node.kind) {
            throw incompatibleParentKindFatalError(parentTypeName, node.kind, parent.kind);
          }
          return;
        }
        this.parents.set(parentTypeName, {
          directives: this.extractPersistedDirectives(
            node.directives || [], newPersistedDirectivesContainer(),
          ),
          kind: node.kind,
          node: scalarTypeDefinitionNodeToMutable(node),
        });
        return;
      case Kind.OBJECT_TYPE_DEFINITION:
        if (parent) {
          if (parent.kind !== node.kind) {
            throw incompatibleParentKindFatalError(parentTypeName, node.kind, parent.kind);
          }
          extractInterfaces(node, parent.interfaces);
          parent.subgraphs.add(this.currentSubgraphName);
          return;
        }
        const interfaces = new Set<string>();
        extractInterfaces(node, interfaces);
        this.parents.set(parentTypeName, {
          directives: this.extractPersistedDirectives(
            node.directives || [], newPersistedDirectivesContainer(),
          ),
          fields: new Map<string, FieldContainer>(),
          interfaces,
          isRootType: this.isParentRootType,
          kind: node.kind,
          node: objectTypeDefinitionNodeToMutable(node),
          subgraphs: new Set<string>([this.currentSubgraphName]),
        });
        return;
      case Kind.UNION_TYPE_DEFINITION:
        if (parent) {
          if (parent.kind !== node.kind) {
            throw incompatibleParentKindFatalError(parentTypeName, node.kind, parent.kind);
          }
          if (!node.types || node.types.length < 1) {
            this.errors.push(invalidUnionError(parent.node.name.value));
            return;
          }
          node.types?.forEach((member) => parent.members.add(member.name.value));
          return;
        }
        this.parents.set(parentTypeName, {
          directives: this.extractPersistedDirectives(
            node.directives || [], newPersistedDirectivesContainer(),
          ),
          kind: node.kind,
          members: new Set<string>(node.types?.map((member) => member.name.value)),
          node: unionTypeDefinitionNodeToMutable(node),
        });
        return;
    }
  }

  upsertExtensionNode(node: ObjectTypeExtensionNode) {
    const extension = this.extensions.get(this.parentTypeName);
    if (extension) {
      if (extension.kind !== Kind.OBJECT_TYPE_EXTENSION) {
        throw incompatibleParentKindFatalError(this.parentTypeName, Kind.OBJECT_TYPE_EXTENSION, extension.kind);
      }
      extension.subgraphs.add(this.currentSubgraphName);
      extractInterfaces(node, extension.interfaces);
      this.extractPersistedDirectives(node.directives || [], extension.directives);
      return;
    }
    // build a new extension
    const interfaces = extractInterfaces(node, new Set<string>());
    this.extensions.set(this.parentTypeName, {
      directives: this.extractPersistedDirectives(
        node.directives || [], newPersistedDirectivesContainer(),
      ),
      fields: new Map<string, FieldContainer>(),
      interfaces,
      isRootType: this.isParentRootType,
      kind: Kind.OBJECT_TYPE_EXTENSION,
      node: objectTypeExtensionNodeToMutable(node),
      subgraphs: new Set<string>([this.currentSubgraphName]),
    });
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

  getAndValidateImplementedInterfaces(container: ObjectContainer | InterfaceContainer): NamedTypeNode[] {
    const interfaces: NamedTypeNode[] = [];
    if (container.interfaces.size < 1) {
      return interfaces;
    }
    const implementationErrorsMap = new Map<string, ImplementationErrors>();
    for (const interfaceName of container.interfaces) {
      interfaces.push(stringToNamedTypeNode(interfaceName));
      const interfaceContainer = this.parents.get(interfaceName);
      if (!interfaceContainer) {
        this.errors.push(undefinedTypeError(interfaceName));
        continue;
      }
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
        for (const [argumentName, inputValueContainer] of interfaceField.arguments) {
          const interfaceArgument = inputValueContainer.node;
          handledArguments.add(argumentName);
          const containerArgument = containerField.arguments.get(argumentName)?.node;
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
        for (const [argumentName, inputValueContainer] of containerField.arguments) {
          const argumentNode = inputValueContainer.node;
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
        container.node.name.value, kindToTypeString(container.kind), implementationErrorsMap,
      ));
    }
    return interfaces;
  }

  mergeArguments(
    container: FieldContainer | DirectiveContainer,
    args: MutableInputValueDefinitionNode[],
    errors: InvalidRequiredArgument[],
    argumentNames?: string[],
  ) {
    for (const argumentContainer of container.arguments.values()) {
      const missingSubgraphs = getEntriesNotInHashSet(
        container.subgraphs, argumentContainer.subgraphs,
      );
      const argumentName = argumentContainer.node.name.value;
      if (missingSubgraphs.length > 0) {
        // Required arguments must be defined in all subgraphs that define the field
        if (argumentContainer.requiredSubgraphs.size > 0) {
          errors.push({
            argumentName,
            missingSubgraphs,
            requiredSubgraphs: [...argumentContainer.requiredSubgraphs],
          });
        }
        // If the argument is always optional, but it's not defined in all subgraphs that define the field,
        // the argument should not be included in the federated graph
        continue;
      }
      argumentContainer.node.defaultValue = argumentContainer.includeDefaultValue
        ? argumentContainer.node.defaultValue : undefined;
      args.push(pushPersistedDirectivesAndGetNode(argumentContainer));
      if (argumentNames) {
        argumentNames.push(argumentName);
      }
    }
  }

  addValidExecutableDirectiveDefinition(
    directiveName: string, directiveContainer: DirectiveContainer, definitions: MutableTypeDefinitionNode[],
  ) {
    if (!this.executableDirectives.has(directiveName)) {
      return;
    }
    if (this.subgraphs.length !== directiveContainer.subgraphs.size) {
      return;
    }
    directiveContainer.node.locations = setToNameNodeArray(directiveContainer.executableLocations);
    if (!directiveContainer.arguments) {
      definitions.push(directiveContainer.node);
      return;
    }
    const args: MutableInputValueDefinitionNode[] = [];
    const errors: InvalidRequiredArgument[] = [];
    this.mergeArguments(directiveContainer, args, errors);
    if (errors.length > 0) {
      this.errors.push(invalidRequiredArgumentsError(DIRECTIVE_DEFINITION, directiveName, errors));
      return;
    }
    directiveContainer.node.arguments = args;
    definitions.push(directiveContainer.node);
  }

  getMergedFieldDefinitionNode(fieldContainer: FieldContainer, parentTypeName: string): FieldDefinitionNode {
    if (!fieldContainer.arguments) {
      return fieldContainer.node;
    }
    pushPersistedDirectivesAndGetNode(fieldContainer);
    const fieldName = fieldContainer.node.name.value;
    const fieldPath = `${parentTypeName}.${fieldName}`;
    const args: MutableInputValueDefinitionNode[] = [];
    const errors: InvalidRequiredArgument[] = [];
    const argumentNames: string[] = [];
    this.mergeArguments(fieldContainer, args, errors, argumentNames);
    if (errors.length > 0) {
      this.errors.push(invalidRequiredArgumentsError(FIELD, fieldPath, errors));
    } else if (argumentNames.length > 0) {
      this.argumentConfigurations.push({
        argumentNames,
        fieldName,
        typeName: parentTypeName,
      });
    }
    fieldContainer.node.arguments = args;
    return fieldContainer.node;
  }

  // the deprecated directive with the longest reason is kept
  upsertDeprecatedDirective(directive: ConstDirectiveNode, deprecatedDirectiveContainer: DeprecatedDirectiveContainer) {
    if (!directive.arguments || directive.arguments.length < 1) {
      deprecatedDirectiveContainer.directive = directive;
      return;
    }
    if (directive.arguments.length !== 1) {
      this.errors.push(invalidDeprecatedDirectiveError);
      return;
    }
    const reasonArgument = directive.arguments[0].value;
    if (reasonArgument.kind !== Kind.STRING) {
      this.errors.push(invalidDeprecatedDirectiveError);
      return;
    }
    if (
      deprecatedDirectiveContainer.reason
      && reasonArgument.value.length < deprecatedDirectiveContainer.reason.length
    ) {
      return;
    }
    deprecatedDirectiveContainer.reason = reasonArgument.value;
    deprecatedDirectiveContainer.directive = directive;
  }

  // tags with the same name string are merged
  mergeTagDirectives(directive: ConstDirectiveNode, map: Map<string, ConstDirectiveNode>) {
    // the directive has been validated in the normalizer
    if (!directive.arguments || directive.arguments.length !== 1) {
      this.errors.push(invalidTagDirectiveError); // should never happen
      return;
    }
    const nameArgument = directive.arguments[0].value;
    if (nameArgument.kind !== Kind.STRING) {
      this.errors.push(invalidTagDirectiveError); // should never happen
      return;
    }
    map.set(nameArgument.value, directive);
  }

  extractPersistedDirectives(
    directives: readonly ConstDirectiveNode[], container: PersistedDirectivesContainer,
  ): PersistedDirectivesContainer {
    if (directives.length < 1) {
      return container;
    }
    for (const directive of directives) {
      const directiveName = directive.name.value;
      if (!this.persistedDirectives.has(directiveName)) {
        continue;
      }
      if (directiveName == DEPRECATED) {
        this.upsertDeprecatedDirective(directive, container.deprecated);
        continue;
      }
      if (directiveName === TAG) {
        this.mergeTagDirectives(directive, container.tags);
        continue;
      }
      const existingDirectives = container.directives.get(directiveName);
      if (!existingDirectives) {
        container.directives.set(directiveName, [directive]);
        continue;
      }
      // Naïvely ignore non-repeatable directives
      const definition = getOrThrowError(
        this.directiveDefinitions, directiveName, 'directiveDefinitions',
      );
      if (!definition.node.repeatable) {
        continue;
      }
      existingDirectives.push(directive);
    }
    return container;
  }

  isFieldResolvableByEntityAncestor(entityAncestors: string[], fieldSubgraphs: Set<string>, parentTypeName: string): boolean {
    if (!this.graph.hasNode(parentTypeName)) {
      return false;
    }
    for (const entityAncestorName of entityAncestors) {
      const path = `${entityAncestorName}.${parentTypeName}`;
      if (entityAncestorName !== parentTypeName && this.graphPaths.get(path)) {
        return true;
      }
      if (entityAncestorName === parentTypeName) {
        const hasOverlap = doSetsHaveAnyOverlap(
          fieldSubgraphs,
          getOrThrowError(this.entities, entityAncestorName, ENTITIES).subgraphs,
        );
        this.graphPaths.set(path, hasOverlap);
        return hasOverlap;
      }
      if (hasSimplePath(this.graph, entityAncestorName, parentTypeName)) {
        this.graphPaths.set(path, true);
        return true;
      }
      this.graphPaths.set(path, false);
    }
    return false;
  }

  shouldEvaluateObjectLike(rootTypeFieldSubgraphs: Set<string>, parentTypeName: string): boolean {
    for (const subgraph of rootTypeFieldSubgraphs) {
      const evaluatedObjectLikes = this.evaluatedObjectLikesBySubgraph.get(subgraph);
      if (evaluatedObjectLikes && evaluatedObjectLikes.has(parentTypeName)) {
        continue;
      }
      return true;
    }
    return false;
  }

  isFieldExternalInAllMutualSubgraphs(subgraphs: Set<string>, fieldContainer: FieldContainer): boolean {
    const mutualSubgraphs = getAllMutualEntries(subgraphs, fieldContainer.subgraphs);
    if (mutualSubgraphs.size < 1) {
      return false;
    }
    for (const mutualSubgraph of mutualSubgraphs) {
      const isExternal = fieldContainer.subgraphsByExternal.get(mutualSubgraph);
      if (isExternal) {
        continue;
      }
      return false;
    }
    return true;
  }

  updateEvaluatedSubgraphOccurrences(
    rootTypeFieldSubgraphs: Set<string>,
    objectSubgraphs: Set<string>,
    entityAncestors: string[],
    parentTypeName: string,
  ) {
    const mutualSubgraphs = getAllMutualEntries(rootTypeFieldSubgraphs, objectSubgraphs);
    if (mutualSubgraphs.size > 0) {
      for (const mutualSubgraph of mutualSubgraphs) {
        const evaluatedObjects = this.evaluatedObjectLikesBySubgraph.get(mutualSubgraph);
        if (evaluatedObjects) {
          evaluatedObjects.add(parentTypeName);
        } else {
          this.evaluatedObjectLikesBySubgraph.set(mutualSubgraph, new Set<string>([parentTypeName]));
        }
      }
    }
    for (const entityAncestor of entityAncestors) {
      const entityContainer = getOrThrowError(this.parents, entityAncestor, PARENTS) as ObjectContainer;
      const mutualEntityAncestorRootTypeFieldSubgraphs = getAllMutualEntries(
        rootTypeFieldSubgraphs, entityContainer.subgraphs,
      );
      const mutualEntityAncestorSubgraphs = getAllMutualEntries(
        mutualEntityAncestorRootTypeFieldSubgraphs, objectSubgraphs,
      );
      for (const mutualSubgraph of mutualEntityAncestorSubgraphs) {
        const objects = this.evaluatedObjectLikesBySubgraph.get(mutualSubgraph);
        if (objects) {
          objects.add(parentTypeName);
        } else {
          this.evaluatedObjectLikesBySubgraph.set(mutualSubgraph, new Set<string>([parentTypeName]));
        }
      }
    }
  }

  evaluateResolvabilityOfObject(
    parentContainer: ObjectContainer,
    rootTypeFieldData: RootTypeFieldData,
    currentFieldPath: string,
    evaluatedObjectLikes: Set<string>,
    entityAncestors: string[],
    isParentAbstract = false,
  ) {
    const parentTypeName = parentContainer.node.name.value;
    if (evaluatedObjectLikes.has(parentTypeName)) {
      return;
    }
    if (!this.shouldEvaluateObjectLike(rootTypeFieldData.subgraphs, parentTypeName)) {
      evaluatedObjectLikes.add(parentTypeName);
      return;
    }

    for (const [fieldName, fieldContainer] of parentContainer.fields) {
      const fieldNamedTypeName = fieldContainer.namedTypeName;
      if (ROOT_TYPES.has(fieldNamedTypeName)) {
        continue;
      }
      // Avoid an infinite loop with self-referential objects
      if (evaluatedObjectLikes.has(fieldNamedTypeName)) {
        continue;
      }
      if (this.isFieldExternalInAllMutualSubgraphs(rootTypeFieldData.subgraphs, fieldContainer)) {
        continue;
      }
      this.updateEvaluatedSubgraphOccurrences(
        rootTypeFieldData.subgraphs, parentContainer.subgraphs, entityAncestors, parentTypeName,
      );
      evaluatedObjectLikes.add(parentTypeName);
      const isFieldResolvable = doSetsHaveAnyOverlap(rootTypeFieldData.subgraphs, fieldContainer.subgraphs)
        || this.isFieldResolvableByEntityAncestor(entityAncestors, fieldContainer.subgraphs, parentTypeName);
      const newCurrentFieldPath = currentFieldPath + (isParentAbstract ? ' ' : '.') + fieldName;
      const entity = this.entities.get(fieldNamedTypeName);
      if (isFieldResolvable) {
        // The base scalars are not in this.parentMap
        if (BASE_SCALARS.has(fieldNamedTypeName)) {
          continue;
        }
        const childContainer = getOrThrowError(this.parents, fieldNamedTypeName, PARENTS);
        switch (childContainer.kind) {
          case Kind.ENUM_TYPE_DEFINITION:
          // intentional fallthrough
          case Kind.SCALAR_TYPE_DEFINITION:
            continue;
          case Kind.OBJECT_TYPE_DEFINITION:
            this.evaluateResolvabilityOfObject(
              childContainer,
              rootTypeFieldData,
              newCurrentFieldPath,
              evaluatedObjectLikes,
              entity ? [...entityAncestors, fieldNamedTypeName] : [...entityAncestors],
            );
            continue;
          case Kind.INTERFACE_TYPE_DEFINITION:
          // intentional fallthrough
          case Kind.UNION_TYPE_DEFINITION:
            this.evaluateResolvabilityOfAbstractType(
              fieldNamedTypeName,
              childContainer.kind,
              rootTypeFieldData,
              newCurrentFieldPath,
              evaluatedObjectLikes,
              entity ? [...entityAncestors, fieldNamedTypeName] : [...entityAncestors],
              fieldContainer.subgraphs,
            );
            continue;
          default:
            this.errors.push(unexpectedObjectResponseType(newCurrentFieldPath, kindToTypeString(childContainer.kind)));
            continue;
        }
      }
      if (BASE_SCALARS.has(fieldNamedTypeName)) {
        this.errors.push(unresolvableFieldError(
          rootTypeFieldData,
          fieldName,
          [...fieldContainer.subgraphs],
          newCurrentFieldPath,
          parentTypeName,
        ));
        continue;
      }
      const childContainer = getOrThrowError(this.parents, fieldNamedTypeName, PARENTS);
      switch (childContainer.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.SCALAR_TYPE_DEFINITION:
          this.errors.push(unresolvableFieldError(
            rootTypeFieldData,
            fieldName,
            [...fieldContainer.subgraphs],
            newCurrentFieldPath,
            parentTypeName,
          ));
          continue;
        case Kind.INTERFACE_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.UNION_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.OBJECT_TYPE_DEFINITION:
          this.errors.push(unresolvableFieldError(
            rootTypeFieldData,
            fieldName,
            [...fieldContainer.subgraphs],
            newCurrentFieldPath + SELECTION_REPRESENTATION,
            parentTypeName,
          ));
          continue;
        default:
          this.errors.push(unexpectedObjectResponseType(newCurrentFieldPath, kindToTypeString(childContainer.kind)));
      }
    }
  }

  evaluateResolvabilityOfAbstractType(
    abstractTypeName: string,
    abstractKind: Kind,
    rootTypeFieldData: RootTypeFieldData,
    currentFieldPath: string,
    evaluatedObjectLikes: Set<string>,
    entityAncestors: string[],
    parentSubgraphs: Set<string>,
  ) {
    if (evaluatedObjectLikes.has(abstractTypeName)) {
      return;
    }
    evaluatedObjectLikes.add(abstractTypeName);
    const concreteTypeNames = this.abstractToConcreteTypeNames.get(abstractTypeName);
    if (!concreteTypeNames) {
      noConcreteTypesForAbstractTypeError(kindToTypeString(abstractKind), abstractTypeName);
      return;
    }
    for (const concreteTypeName of concreteTypeNames) {
      if (evaluatedObjectLikes.has(concreteTypeName)) {
        continue;
      }
      const concreteParentContainer = getOrThrowError(this.parents, concreteTypeName, PARENTS);
      if (concreteParentContainer.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        throw unexpectedParentKindErrorMessage(
          concreteTypeName, 'Object', kindToTypeString(concreteParentContainer.kind),
        );
      }

      // If the concrete type is unreachable through the abstract type, it is not an error
      if (!doSetsHaveAnyOverlap(concreteParentContainer.subgraphs, parentSubgraphs)) {
        continue;
      }
      const entity = this.entities.get(concreteTypeName);
      this.evaluateResolvabilityOfObject(
        concreteParentContainer,
        rootTypeFieldData,
        currentFieldPath + ` ... on ` + concreteTypeName,
        evaluatedObjectLikes,
        entity ? [...entityAncestors, concreteTypeName] : [...entityAncestors],
        true,
      );
    }
  }

  federate(): FederationResultContainer {
    this.populateMultiGraphAndRenameOperations(this.subgraphs);
    const factory = this;
    for (const subgraph of this.subgraphs) {
      this.isCurrentSubgraphVersionTwo = subgraph.isVersionTwo;
      this.currentSubgraphName = subgraph.name;
      this.keyFieldsByParentTypeName = subgraph.keyFieldsByParentTypeName;
      walkSubgraphToFederate(subgraph.definitions, factory);
    }
    const definitions: MutableTypeDefinitionNode[] = [];
    for (const [directiveName, directiveContainer] of this.directiveDefinitions) {
      if (this.persistedDirectives.has(directiveName)) {
        definitions.push(directiveContainer.node);
        continue;
      }
      // The definitions must be present in all subgraphs to kept in the federated graph
      this.addValidExecutableDirectiveDefinition(directiveName, directiveContainer, definitions);
    }
    for (const [typeName, extension] of this.extensions) {
      this.parentTypeName = typeName;
      if (extension.isRootType && !this.parents.has(typeName)) {
        this.upsertParentNode(objectTypeExtensionNodeToMutableDefinitionNode(extension.node));
      }
      const baseObject = this.parents.get(typeName);
      if (!baseObject) {
        this.errors.push(noBaseTypeExtensionError(typeName));
        continue;
      }

      if (baseObject.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        throw incompatibleParentKindFatalError(typeName, Kind.OBJECT_TYPE_DEFINITION, baseObject.kind);
      }
      for (const [extensionFieldName, extensionFieldContainer] of extension.fields) {
        const baseFieldContainer = baseObject.fields.get(extensionFieldName);
        if (!baseFieldContainer) {
          baseObject.fields.set(extensionFieldName, extensionFieldContainer);
          continue;
        }
        if (baseFieldContainer.isShareable && extensionFieldContainer.isShareable) {
          this.childName = extensionFieldName;
          this.upsertExtensionFieldArguments(extensionFieldContainer.arguments, baseFieldContainer.arguments);
          setLongestDescriptionForNode(baseFieldContainer.node, extensionFieldContainer.node.description);
          addIterableValuesToSet(extensionFieldContainer.subgraphs, baseFieldContainer.subgraphs);
          continue;
        }
        const parent = this.shareableErrorTypeNames.get(typeName);
        if (parent) {
          parent.add(extensionFieldName);
          continue;
        }
        this.shareableErrorTypeNames.set(typeName, new Set<string>([extensionFieldName]));
      }
      for (const interfaceName of extension.interfaces) {
        baseObject.interfaces.add(interfaceName);
      }
    }
    for (const [parentTypeName, children] of this.shareableErrorTypeNames) {
      const parent = getOrThrowError(this.parents, parentTypeName, PARENTS);
      if (parent.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        throw incompatibleParentKindFatalError(parentTypeName, Kind.OBJECT_TYPE_DEFINITION, parent.kind);
      }
      this.errors.push(shareableFieldDefinitionsError(parent, children));
    }
    const objectLikeContainersWithInterfaces: ObjectLikeContainer[] = [];
    for (const parentContainer of this.parents.values()) {
      const parentTypeName = parentContainer.node.name.value;
      switch (parentContainer.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
          const values: MutableEnumValueDefinitionNode[] = [];
          const mergeMethod = this.getEnumMergeMethod(parentTypeName);
          for (const enumValueContainer of parentContainer.values.values()) {
            pushPersistedDirectivesAndGetNode(enumValueContainer);
            switch (mergeMethod) {
              case MergeMethod.CONSISTENT:
                if (enumValueContainer.appearances < parentContainer.appearances) {
                  this.errors.push(incompatibleSharedEnumError(parentTypeName));
                }
                values.push(enumValueContainer.node);
                break;
              case MergeMethod.INTERSECTION:
                if (enumValueContainer.appearances === parentContainer.appearances) {
                  values.push(enumValueContainer.node);
                }
                break;
              default:
                values.push(enumValueContainer.node);
                break;
            }
          }
          parentContainer.node.values = values;
          definitions.push(pushPersistedDirectivesAndGetNode(parentContainer));
          break;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          const inputValues: InputValueDefinitionNode[] = [];
          for (const inputValueContainer of parentContainer.fields.values()) {
            pushPersistedDirectivesAndGetNode(inputValueContainer);
            if (parentContainer.appearances === inputValueContainer.appearances) {
              inputValues.push(inputValueContainer.node);
            } else if (isTypeRequired(inputValueContainer.node.type)) {
              this.errors.push(federationRequiredInputFieldError(parentTypeName, inputValueContainer.node.name.value));
              break;
            }
          }
          parentContainer.node.fields = inputValues;
          definitions.push(pushPersistedDirectivesAndGetNode(parentContainer));
          break;
        case Kind.INTERFACE_TYPE_DEFINITION:
          const interfaceFields: FieldDefinitionNode[] = [];
          for (const fieldContainer of parentContainer.fields.values()) {
            interfaceFields.push(this.getMergedFieldDefinitionNode(fieldContainer, parentTypeName));
          }
          parentContainer.node.fields = interfaceFields;
          pushPersistedDirectivesAndGetNode(parentContainer);
          // Interface implementations can only be evaluated after they've been fully merged
          if (parentContainer.interfaces.size > 0) {
            objectLikeContainersWithInterfaces.push(parentContainer);
          } else {
            definitions.push(parentContainer.node);
          }
          break;
        case Kind.OBJECT_TYPE_DEFINITION:
          const fields: FieldDefinitionNode[] = [];
          for (const fieldContainer of parentContainer.fields.values()) {
            fields.push(this.getMergedFieldDefinitionNode(fieldContainer, parentTypeName));
          }
          parentContainer.node.fields = fields;
          pushPersistedDirectivesAndGetNode(parentContainer);
          // Interface implementations can only be evaluated after they've been fully merged
          if (parentContainer.interfaces.size > 0) {
            objectLikeContainersWithInterfaces.push(parentContainer);
          } else {
            definitions.push(parentContainer.node);
          }
          break;
        case Kind.SCALAR_TYPE_DEFINITION:
          if (!BASE_SCALARS.has(parentTypeName)) {
            definitions.push(pushPersistedDirectivesAndGetNode(parentContainer));
          }
          break;
        case Kind.UNION_TYPE_DEFINITION:
          const types: NamedTypeNode[] = [];
          for (const memberName of parentContainer.members) {
            types.push(stringToNamedTypeNode(memberName));
          }
          parentContainer.node.types = types;
          definitions.push(pushPersistedDirectivesAndGetNode(parentContainer));
          break;
      }
    }
    for (const container of objectLikeContainersWithInterfaces) {
      container.node.interfaces = this.getAndValidateImplementedInterfaces(container);
      definitions.push(container.node);
    }
    if (!this.parents.has(QUERY)) {
      this.errors.push(noQueryRootTypeError);
    }
    // return any composition errors before checking whether all fields are resolvable
    if (this.errors.length > 0) {
      return { errors: this.errors };
    }
    for (const rootTypeName of ROOT_TYPES) {
      const rootTypeContainer = this.parents.get(rootTypeName);
      if (!rootTypeContainer || rootTypeContainer.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        continue;
      }
      // After evaluating all of a root type's fields, break and return if there are errors
      if (this.errors.length > 0) {
        break;
      }
      // If a root type field returns a Scalar or Enum, track it so that it is not evaluated it again
      const evaluatedRootScalarsAndEnums = new Set<string>(BASE_SCALARS);
      for (const [rootTypeFieldName, rootTypeFieldContainer] of rootTypeContainer.fields) {
        const rootTypeFieldNamedTypeName = rootTypeFieldContainer.namedTypeName;
        if (evaluatedRootScalarsAndEnums.has(rootTypeFieldNamedTypeName)) {
          continue;
        }
        if (!this.shouldEvaluateObjectLike(rootTypeFieldContainer.subgraphs, rootTypeFieldNamedTypeName)) {
          continue;
        }
        const childContainer = getOrThrowError(this.parents, rootTypeFieldNamedTypeName, PARENTS);
        const fieldPath = `${rootTypeName}.${rootTypeFieldName}`;
        const rootTypeFieldData: RootTypeFieldData = {
          fieldName: rootTypeFieldName,
          fieldTypeNodeString: printTypeNode(rootTypeFieldContainer.node.type),
          path: fieldPath,
          typeName: rootTypeName,
          subgraphs: rootTypeFieldContainer.subgraphs,
        };
        switch (childContainer.kind) {
          case Kind.ENUM_TYPE_DEFINITION:
          // intentional fallthrough
          case Kind.SCALAR_TYPE_DEFINITION:
            // Root type fields whose response type is an Enums and Scalars will always be resolvable
            // Consequently, subsequent checks can be skipped
            evaluatedRootScalarsAndEnums.add(rootTypeFieldNamedTypeName);
            continue;
          case Kind.OBJECT_TYPE_DEFINITION:
            this.evaluateResolvabilityOfObject(
              childContainer,
              rootTypeFieldData,
              fieldPath,
              new Set<string>(),
              this.entities.has(rootTypeFieldNamedTypeName) ? [rootTypeFieldNamedTypeName] : [],
            );
            continue;
          case Kind.INTERFACE_TYPE_DEFINITION:
          // intentional fallthrough
          case Kind.UNION_TYPE_DEFINITION:
            this.evaluateResolvabilityOfAbstractType(
              rootTypeFieldNamedTypeName,
              childContainer.kind,
              rootTypeFieldData,
              fieldPath,
              new Set<string>(),
              this.entities.has(rootTypeFieldNamedTypeName) ? [rootTypeFieldNamedTypeName] : [],
              rootTypeFieldContainer.subgraphs,
            );
            continue;
          default:
            this.errors.push(unexpectedObjectResponseType(fieldPath, kindToTypeString(childContainer.kind)));
        }
      }
    }
    if (this.errors.length > 0) {
      return { errors: this.errors };
    }
    const newAst: DocumentNode = {
      kind: Kind.DOCUMENT,
      definitions,
    };
    return {
      federationResult: {
        argumentConfigurations: this.argumentConfigurations,
        federatedGraphAST: newAst,
        federatedGraphSchema: buildASTSchema(newAst),
      },
    };
  }
}

export function federateSubgraphs(subgraphs: Subgraph[]): FederationResultContainer {
  if (subgraphs.length < 1) {
    throw minimumSubgraphRequirementError;
  }
  const normalizedSubgraphs: InternalSubgraph[] = [];
  const validationErrors: Error[] = [];
  const subgraphNames = new Set<string>();
  const nonUniqueSubgraphNames = new Set<string>();
  const invalidNameErrorMessages: string[] = [];
  for (let i = 0; i < subgraphs.length; i++) {
    const subgraph = subgraphs[i];
    const name = subgraph.name || `subgraph-${i}-${Date.now()}`;
    if (!subgraph.name) {
      invalidNameErrorMessages.push(invalidSubgraphNameErrorMessage(i, name));
    } else {
      validateSubgraphName(subgraph.name, subgraphNames, nonUniqueSubgraphNames);
    }
    const { errors, normalizationResult } = normalizeSubgraph(subgraph.definitions);
    if (errors) {
      validationErrors.push(subgraphValidationError(name, errors));
      continue;
    }
    if (!normalizationResult) {
      validationErrors.push(subgraphValidationError(name, [subgraphValidationFailureErrorMessage]));
      continue;
    }
    normalizedSubgraphs.push({
      definitions: normalizationResult.subgraphAST,
      keyFieldsByParentTypeName: normalizationResult.keyFieldsByParentTypeName,
      isVersionTwo: normalizationResult.isVersionTwo,
      name,
      operationTypes: normalizationResult.operationTypes,
      url: subgraph.url,
    });
  }
  const allErrors: Error[] = [];
  if (invalidNameErrorMessages.length > 0 || nonUniqueSubgraphNames.size > 0) {
    allErrors.push(invalidSubgraphNamesError([...nonUniqueSubgraphNames], invalidNameErrorMessages));
  }
  allErrors.push(...validationErrors);
  if (allErrors.length > 0) {
    return { errors: allErrors };
  }
  const federationFactory = new FederationFactory(normalizedSubgraphs);
  return federationFactory.federate();
}