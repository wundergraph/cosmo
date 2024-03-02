import { MultiGraph } from 'graphology';
import {
  BREAK,
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
  visit,
} from 'graphql';
import {
  ConstValueNodeWithValue,
  enumTypeDefinitionNodeToMutable,
  enumValueDefinitionNodeToMutable,
  fieldDefinitionNodeToMutable,
  inputObjectTypeDefinitionNodeToMutable,
  inputValueDefinitionNodeToMutable,
  interfaceTypeDefinitionNodeToMutable,
  MutableInputValueDefinitionNode,
  MutableTypeDefinitionNode,
  objectTypeDefinitionNodeToMutable,
  objectTypeExtensionNodeToMutable,
  scalarTypeDefinitionNodeToMutable,
  unionTypeDefinitionNodeToMutable,
} from '../ast/ast';
import {
  extractInterfaces,
  isKindAbstract,
  isNodeExternal,
  isNodeShareable,
  pushPersistedDirectivesAndGetNode,
  safeParse,
  stringToNamedTypeNode,
} from '../ast/utils';
import {
  allFieldDefinitionsAreInaccessibleError,
  argumentTypeMergeFatalError,
  federationInvalidParentTypeError,
  fieldTypeMergeFatalError,
  incompatibleArgumentDefaultValueError,
  incompatibleArgumentDefaultValueTypeError,
  incompatibleArgumentTypesError,
  incompatibleChildTypesError,
  incompatibleParentKindFatalError,
  incompatibleSharedEnumError,
  invalidDeprecatedDirectiveError,
  invalidFieldShareabilityError,
  invalidRequiredArgumentsError,
  invalidRequiredInputFieldError,
  invalidTagDirectiveError,
  invalidUnionError,
  minimumSubgraphRequirementError,
  noConcreteTypesForAbstractTypeError,
  noQueryRootTypeError,
  orScopesLimitError,
  undefinedEntityInterfaceImplementationsError,
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
} from '../schema-building/type-merging';
import {
  ArgumentContainer,
  ArgumentMap,
  DeprecatedDirectiveContainer,
  EnumValueContainer,
  ExtensionContainer,
  FederationFieldData,
  FederationResultContainer,
  InputValueContainer,
  InterfaceContainer,
  MergeMethod,
  newPersistedDirectivesContainer,
  ObjectContainer,
  ParentContainer,
  ParentMap,
  PersistedDirectivesContainer,
  RootTypeFieldData,
} from './utils';
import { InternalSubgraph, Subgraph, SubgraphConfig } from '../subgraph/subgraph';
import {
  AUTHENTICATED,
  DEFAULT_MUTATION,
  DEFAULT_QUERY,
  DEFAULT_SUBSCRIPTION,
  DEPRECATED,
  ENTITIES,
  EXTENSIONS,
  FIELD,
  INACCESSIBLE,
  PARENTS,
  QUERY,
  REQUIRES_SCOPES,
  ROOT_TYPES,
  SELECTION_REPRESENTATION,
  TAG,
} from '../utils/string-constants';
import {
  addIterableValuesToSet,
  AuthorizationData,
  doSetsHaveAnyOverlap,
  EntityContainer,
  EntityContainerByTypeName,
  EntityInterfaceFederationData,
  getAllMutualEntries,
  getOrThrowError,
  getValueOrDefault,
  hasSimplePath,
  ImplementationErrors,
  InvalidEntityInterface,
  InvalidFieldImplementation,
  InvalidRequiredArgument,
  kindToTypeString,
  mapToArrayOfValues,
  maxOrScopes,
  newAuthorizationData,
  newEntityInterfaceFederationData,
  subtractSourceSetFromTargetSet,
  upsertAuthorizationConfiguration,
  upsertEntityInterfaceFederationData,
  upsertFieldAuthorizationData,
} from '../utils/utils';
import { printTypeNode } from '@graphql-tools/merge';
import {
  ConfigurationData,
  FieldConfiguration,
  RequiredFieldConfiguration,
} from '../router-configuration/router-configuration';
import {
  AUTHENTICATED_DEFINITION,
  BASE_SCALARS,
  DEPRECATED_DEFINITION,
  INACCESSIBLE_DEFINITION,
  REQUIRES_SCOPES_DEFINITION,
  SCOPE_SCALAR_DEFINITION,
  TAG_DEFINITION,
} from '../utils/constants';
import { batchNormalize } from '../normalization/normalization-factory';
import { getNormalizedFieldSet, isNodeQuery } from '../normalization/utils';
import {
  DefinitionWithFieldsData,
  ObjectDefinitionData,
  ParentDefinitionData,
  ParentWithFieldsData as NormalizationObjectLikeData,
  PersistedDirectiveDefinitionData,
} from '../schema-building/type-definition-data';
import {
  addValidPersistedDirectiveDefinitionNodeByData,
  getNodeWithPersistedDirectivesByData,
  getNodeWithPersistedDirectivesByFieldData,
  getNodeWithPersistedDirectivesByInputValueData,
  getValidFieldArgumentNodes,
  isFieldExternalInAllMutualSubgraphs,
  isShareabilityOfAllFieldInstancesValid,
  isTypeRequired,
  pushAuthorizationDirectives,
  upsertObjectExtensionData,
  upsertParentDefinitionData,
  upsertPersistedDirectiveDefinitionData,
  upsertValidObjectExtensionData,
} from '../schema-building/utils';
import { MutableEnumValueNode, MutableFieldNode, MutableInputValueNode } from '../schema-building/ast';
import { ObjectExtensionData } from '../schema-building/type-extension-data';
import { createMultiGraphAndRenameRootTypes } from '../normalization/walkers';

export class FederationFactory {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  areFieldsExternal = false;
  areFieldsShareable = false;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  fieldConfigurationByFieldPath = new Map<string, FieldConfiguration>();
  namedInputValueTypeNames = new Set<string>();
  namedOutputTypeNames = new Set<string>();
  entityInterfaceFederationDataByTypeName: Map<string, EntityInterfaceFederationData>;
  executableDirectives = new Set<string>();
  parentTypeName = '';
  persistedDirectiveDefinitions = new Set<string>([AUTHENTICATED, DEPRECATED, INACCESSIBLE, TAG, REQUIRES_SCOPES]);
  currentSubgraphName = '';
  childName = '';
  entityContainersByTypeName: EntityContainerByTypeName;
  errors: Error[] = [];
  evaluatedObjectLikesBySubgraph = new Map<string, Set<string>>();
  extensions = new Map<string, ExtensionContainer>();
  graph: MultiGraph;
  graphEdges = new Set<string>();
  graphPaths = new Map<string, boolean>();
  invalidOrScopesHostPaths = new Set<string>();
  isCurrentParentEntity = false;
  isCurrentParentInterface = false;
  isCurrentSubgraphVersionTwo = false;
  isCurrentParentExtensionType = false;
  isParentRootType = false;
  isParentInputObject = false;
  keyFieldNamesByParentTypeName = new Map<string, Set<string>>();
  outputFieldTypeNames = new Set<string>();
  parentDefinitionDataByTypeName = new Map<string, ParentDefinitionData>();
  objectExtensionDataByTypeName = new Map<string, ObjectExtensionData>();
  parents: ParentMap = new Map<string, ParentContainer>();
  persistedDirectiveDefinitionByDirectiveName = new Map<string, DirectiveDefinitionNode>([
    [AUTHENTICATED, AUTHENTICATED_DEFINITION],
    [DEPRECATED, DEPRECATED_DEFINITION],
    [INACCESSIBLE, INACCESSIBLE_DEFINITION],
    [REQUIRES_SCOPES, REQUIRES_SCOPES_DEFINITION],
    [TAG, TAG_DEFINITION],
  ]);
  rootTypeNames = new Set<string>([DEFAULT_MUTATION, DEFAULT_QUERY, DEFAULT_SUBSCRIPTION]);
  internalSubgraphBySubgraphName: Map<string, InternalSubgraph>;
  shareableErrorTypeNames = new Map<string, Set<string>>();
  renamedTypeNameByOriginalTypeName = new Map<string, string>();
  warnings: string[];

  constructor(
    authorizationDataByParentTypeName: Map<string, AuthorizationData>,
    concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>,
    entityContainersByTypeName: EntityContainerByTypeName,
    entityInterfaceFederationDataByTypeName: Map<string, EntityInterfaceFederationData>,
    graph: MultiGraph,
    internalSubgraphBySubgraphName: Map<string, InternalSubgraph>,
    warnings?: string[],
  ) {
    this.authorizationDataByParentTypeName = authorizationDataByParentTypeName;
    this.concreteTypeNamesByAbstractTypeName = concreteTypeNamesByAbstractTypeName;
    this.entityContainersByTypeName = entityContainersByTypeName;
    this.entityInterfaceFederationDataByTypeName = entityInterfaceFederationDataByTypeName;
    this.graph = graph;
    this.internalSubgraphBySubgraphName = internalSubgraphBySubgraphName;
    this.warnings = warnings || [];
  }

  isObjectRootType(node: ObjectTypeDefinitionNode | ObjectTypeExtensionNode): boolean {
    return this.rootTypeNames.has(node.name.value);
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
      // BOOLEAN, ENUM, FLOAT, INT, and STRING intentionally fall through
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

  upsertExtensionPersistedDirectives(
    extensionDirectives: PersistedDirectivesContainer,
    baseDirectives: PersistedDirectivesContainer,
  ) {
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
      baseDirectives.deprecated.directive &&
      baseDirectives.deprecated.reason &&
      extensionDeprecatedReason.length < baseDirectives.deprecated.reason.length
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
          extensionArgumentContainer.requiredSubgraphs,
          existingArgumentContainer.requiredSubgraphs,
        );
      }
      // Add the subgraphs in which the extensions' arguments are found to the base subgraphs set
      addIterableValuesToSet(extensionArgumentContainer.subgraphs, existingArgumentContainer.subgraphs);
      const hostPath = `${this.parentTypeName}.${this.childName}(${argumentName}: ...)`;
      // Set the most restrictive type for the argument
      const { typeErrors, typeNode } = getMostRestrictiveMergedTypeNode(
        existingArgumentContainer.node.type,
        extensionArgumentContainer.node.type,
        hostPath,
      );
      if (typeNode) {
        existingArgumentContainer.node.type = typeNode;
      } else {
        if (!typeErrors || typeErrors.length < 2) {
          throw argumentTypeMergeFatalError(argumentName, this.childName);
        }
        this.errors.push(incompatibleArgumentTypesError(argumentName, hostPath, typeErrors[0], typeErrors[1]));
      }
      this.compareAndValidateArgumentDefaultValues(existingArgumentContainer, extensionArgumentContainer.node);
      this.upsertExtensionPersistedDirectives(
        extensionArgumentContainer.directives,
        existingArgumentContainer.directives,
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
      this.namedInputValueTypeNames.add(getNamedTypeForChild(argPath, argumentNode.type));
      const isRequired = isTypeRequired(argumentNode.type);
      const existingArgumentContainer = argumentMap.get(argName);
      if (!existingArgumentContainer) {
        argumentMap.set(argName, {
          directives: this.extractPersistedDirectives(argumentNode.directives || [], newPersistedDirectivesContainer()),
          includeDefaultValue: !!argumentNode.defaultValue,
          node: inputValueDefinitionNodeToMutable(argumentNode, this.childName),
          requiredSubgraphs: this.upsertRequiredSubgraph(new Set<string>(), isRequired),
          subgraphs: new Set<string>([this.currentSubgraphName]),
        });
        continue;
      }
      this.extractPersistedDirectives(argumentNode.directives || [], existingArgumentContainer.directives);
      this.upsertRequiredSubgraph(existingArgumentContainer.requiredSubgraphs, isRequired);
      existingArgumentContainer.subgraphs.add(this.currentSubgraphName);
      const hostPath = `${this.parentTypeName}.${this.childName}(${argName}: ...)`;
      const { typeErrors, typeNode } = getMostRestrictiveMergedTypeNode(
        existingArgumentContainer.node.type,
        argumentNode.type,
        hostPath,
      );
      if (typeNode) {
        existingArgumentContainer.node.type = typeNode;
      } else {
        if (!typeErrors || typeErrors.length < 2) {
          throw argumentTypeMergeFatalError(argName, this.childName);
        }
        this.errors.push(incompatibleArgumentTypesError(argName, hostPath, typeErrors[0], typeErrors[1]));
      }
      this.compareAndValidateArgumentDefaultValues(existingArgumentContainer, argumentNode);
    }
    return argumentMap;
  }

  isFieldEntityKey(): boolean {
    const parent = this.keyFieldNamesByParentTypeName.get(this.parentTypeName);
    if (parent) {
      return parent.has(this.childName);
    }
    return false;
  }

  isFieldExternal(node: FieldDefinitionNode): boolean {
    return this.areFieldsExternal || isNodeExternal(node);
  }

  isFieldShareable(node: FieldDefinitionNode): boolean {
    return (
      !this.isCurrentSubgraphVersionTwo || this.areFieldsShareable || this.isFieldEntityKey() || isNodeShareable(node)
    );
  }

  // upsertDirectiveNode(node: DirectiveDefinitionNode) {
  //   const directiveName = node.name.value;
  //   const directiveDefinition = this.directiveDefinitions.get(directiveName);
  //   if (directiveDefinition) {
  //     if (!this.executableDirectives.has(directiveName)) {
  //       return;
  //     }
  //     if (
  //       mergeExecutableDirectiveLocations(node.locations, directiveDefinition).size < 1) {
  //       this.executableDirectives.delete(directiveName);
  //       return;
  //     }
  //     this.upsertArguments(node, directiveDefinition.arguments);
  //     setLongestDescriptionForNode(directiveDefinition.node, node.description);
  //     directiveDefinition.node.repeatable = directiveDefinition.node.repeatable && node.repeatable;
  //     directiveDefinition.subgraphNames.add(this.currentSubgraphName);
  //     return;
  //   }
  //   const executableLocations = extractExecutableDirectiveLocations(node.locations, new Set<string>());
  //   this.directiveDefinitions.set(directiveName, {
  //     arguments: this.upsertArguments(node, new Map<string, ArgumentContainer>()),
  //     executableLocations,
  //     node: directiveDefinitionNodeToMutable(node),
  //     subgraphNames: new Set<string>([this.currentSubgraphName]),
  //   });
  //   if (executableLocations.size > 0) {
  //     this.executableDirectives.add(directiveName);
  //   }
  // }

  isShareabilityOfAllFieldInstancesValid(fieldContainer: FederationFieldData) {
    let shareableFields = 0;
    let unshareableFields = 0;
    for (const [subgraphName, isShareable] of fieldContainer.subgraphsByShareable) {
      /*
        shareability is ignored if:
        1. the field is external
        2. the field is overridden by another subgraph (in which case it has not been upserted)
       */
      if (fieldContainer.subgraphsByExternal.get(subgraphName)) {
        continue;
      }
      if (isShareable) {
        if (unshareableFields) {
          return false;
        }
        shareableFields += 1;
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
      parent.kind !== Kind.OBJECT_TYPE_DEFINITION &&
      parent.kind !== Kind.INTERFACE_TYPE_DEFINITION &&
      parent.kind !== Kind.OBJECT_TYPE_EXTENSION
    ) {
      throw unexpectedKindFatalError(this.parentTypeName);
    }
    const fieldMap = parent.fields;
    const isFieldExternal = this.isFieldExternal(node);
    const isFieldShareable = this.isFieldShareable(node);
    const fieldPath = `${this.parentTypeName}.${this.childName}`;
    const fieldRootTypeName = getNamedTypeForChild(fieldPath, node.type);
    const existingFieldContainer = fieldMap.get(this.childName);
    if (existingFieldContainer) {
      this.extractPersistedDirectives(node.directives || [], existingFieldContainer.directives);
      existingFieldContainer.subgraphNames.add(this.currentSubgraphName);
      existingFieldContainer.subgraphsByShareable.set(this.currentSubgraphName, isFieldShareable);
      existingFieldContainer.subgraphsByExternal.set(this.currentSubgraphName, isFieldExternal);
      const { typeErrors, typeNode } = getLeastRestrictiveMergedTypeNode(
        existingFieldContainer.node.type,
        node.type,
        `${this.parentTypeName}.${this.childName}`,
      );
      if (typeNode) {
        existingFieldContainer.node.type = typeNode;
      } else {
        if (!typeErrors || typeErrors.length < 2) {
          throw fieldTypeMergeFatalError(this.childName);
        }
        this.errors.push(incompatibleChildTypesError(fieldPath, typeErrors[0], typeErrors[1]));
      }
      this.upsertArguments(node, existingFieldContainer.arguments);
      /* A field is valid if one of the following is true:
        1. The field is an interface
        2. The field is external
        3. Non-external fields are ALL shareable
        4. All other fields besides the current field are external
      */
      if (
        this.isCurrentParentInterface ||
        isFieldExternal ||
        (existingFieldContainer.isShareable && isFieldShareable) ||
        this.isShareabilityOfAllFieldInstancesValid(existingFieldContainer) ||
        this.entityInterfaceFederationDataByTypeName.has(this.parentTypeName) // TODO handle shareability with interfaceObjects
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
    this.namedOutputTypeNames.add(fieldRootTypeName);
    fieldMap.set(this.childName, {
      arguments: this.upsertArguments(node, new Map<string, ArgumentContainer>()),
      directives: this.extractPersistedDirectives(node.directives || [], newPersistedDirectivesContainer()),
      isShareable: isFieldShareable,
      node: fieldDefinitionNodeToMutable(node, this.parentTypeName),
      namedTypeName: fieldRootTypeName,
      subgraphNames: new Set<string>([this.currentSubgraphName]),
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
          enumValueContainer.appearances += 1;
          return;
        }
        enumValues.set(this.childName, {
          appearances: 1,
          directives: this.extractPersistedDirectives(node.directives || [], newPersistedDirectivesContainer()),
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
        const valuePath = `${this.parentTypeName}.${this.childName}`;
        if (inputValueContainer) {
          this.extractPersistedDirectives(node.directives || [], inputValueContainer.directives);
          inputValueContainer.appearances += 1;
          const { typeErrors, typeNode } = getMostRestrictiveMergedTypeNode(
            inputValueContainer.node.type,
            node.type,
            valuePath,
          );
          if (typeNode) {
            inputValueContainer.node.type = typeNode;
          } else {
            if (!typeErrors || typeErrors.length < 2) {
              throw fieldTypeMergeFatalError(this.childName);
            }
            this.errors.push(incompatibleChildTypesError(valuePath, typeErrors[0], typeErrors[1]));
          }
          return;
        }
        const inputValueNamedType = getNamedTypeForChild(valuePath, node.type);
        this.namedInputValueTypeNames.add(inputValueNamedType);
        inputValues.set(this.childName, {
          appearances: 1,
          directives: this.extractPersistedDirectives(node.directives || [], newPersistedDirectivesContainer()),
          includeDefaultValue: !!node.defaultValue,
          node: inputValueDefinitionNodeToMutable(node, this.parentTypeName),
        });
        return;
      default:
        throw unexpectedKindFatalError(this.childName);
    }
  }

  upsertInterfaceObjectParentNode(node: ObjectTypeDefinitionNode) {
    const parentTypeName = node.name.value;
    const parent = this.parents.get(parentTypeName);
    if (parent) {
      if (parent.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        throw incompatibleParentKindFatalError(parentTypeName, node.kind, parent.kind);
      }
      this.extractPersistedDirectives(node.directives || [], parent.directives);
      extractInterfaces(node, parent.interfaces);
      parent.subgraphNames.add(this.currentSubgraphName);
      return;
    }
    this.parents.set(parentTypeName, {
      directives: this.extractPersistedDirectives(node.directives || [], newPersistedDirectivesContainer()),
      fields: new Map<string, FederationFieldData>(),
      interfaces: extractInterfaces(node, new Set<string>()),
      kind: Kind.INTERFACE_TYPE_DEFINITION,
      node: interfaceTypeDefinitionNodeToMutable({
        ...node,
        kind: Kind.INTERFACE_TYPE_DEFINITION,
      }),
      subgraphNames: new Set<string>([this.currentSubgraphName]),
    });
  }

  upsertParentNode(node: TypeDefinitionNode) {
    const parentTypeName = node.name.value;
    const parent = this.parents.get(parentTypeName);
    if (parent) {
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
          directives: this.extractPersistedDirectives(node.directives || [], newPersistedDirectivesContainer()),
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
          directives: this.extractPersistedDirectives(node.directives || [], newPersistedDirectivesContainer()),
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
          parent.subgraphNames.add(this.currentSubgraphName);
          return;
        }
        this.parents.set(parentTypeName, {
          directives: this.extractPersistedDirectives(node.directives || [], newPersistedDirectivesContainer()),
          fields: new Map<string, FederationFieldData>(),
          interfaces: extractInterfaces(node, new Set<string>()),
          kind: node.kind,
          node: interfaceTypeDefinitionNodeToMutable(node),
          subgraphNames: new Set<string>([this.currentSubgraphName]),
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
          directives: this.extractPersistedDirectives(node.directives || [], newPersistedDirectivesContainer()),
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
          parent.subgraphNames.add(this.currentSubgraphName);
          return;
        }
        this.parents.set(parentTypeName, {
          directives: this.extractPersistedDirectives(node.directives || [], newPersistedDirectivesContainer()),
          fields: new Map<string, FederationFieldData>(),
          interfaces: extractInterfaces(node, new Set<string>()),
          isRootType: this.isParentRootType,
          kind: node.kind,
          node: objectTypeDefinitionNodeToMutable(node),
          subgraphNames: new Set<string>([this.currentSubgraphName]),
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
          directives: this.extractPersistedDirectives(node.directives || [], newPersistedDirectivesContainer()),
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
      extension.subgraphNames.add(this.currentSubgraphName);
      extractInterfaces(node, extension.interfaces);
      this.extractPersistedDirectives(node.directives || [], extension.directives);
      return;
    }
    // build a new extension
    const interfaces = extractInterfaces(node, new Set<string>());
    this.extensions.set(this.parentTypeName, {
      directives: this.extractPersistedDirectives(node.directives || [], newPersistedDirectivesContainer()),
      fields: new Map<string, FederationFieldData>(),
      interfaces,
      isRootType: this.isParentRootType,
      kind: Kind.OBJECT_TYPE_EXTENSION,
      node: objectTypeExtensionNodeToMutable(node),
      subgraphNames: new Set<string>([this.currentSubgraphName]),
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
          const concreteTypes = this.concreteTypeNamesByAbstractTypeName.get(originalTypeName);
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

  getValidImplementedInterfaces(data: DefinitionWithFieldsData): NamedTypeNode[] {
    const interfaces: NamedTypeNode[] = [];
    if (data.implementedInterfaceTypeNames.size < 1) {
      return interfaces;
    }
    const implementationErrorsMap = new Map<string, ImplementationErrors>();
    for (const interfaceName of data.implementedInterfaceTypeNames) {
      interfaces.push(stringToNamedTypeNode(interfaceName));
      const interfaceData = this.parentDefinitionDataByTypeName.get(interfaceName);
      if (!interfaceData) {
        this.errors.push(undefinedTypeError(interfaceName));
        continue;
      }
      if (interfaceData.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        throw incompatibleParentKindFatalError(interfaceName, Kind.INTERFACE_TYPE_DEFINITION, interfaceData.kind);
      }
      const implementationErrors: ImplementationErrors = {
        invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
        unimplementedFields: [],
      };
      let hasErrors = false;
      for (const [fieldName, interfaceField] of interfaceData.fieldDataByFieldName) {
        let hasNestedErrors = false;
        const fieldData = data.fieldDataByFieldName.get(fieldName);
        if (!fieldData) {
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
        if (!this.isTypeValidImplementation(interfaceField.node.type, fieldData.node.type)) {
          hasErrors = true;
          hasNestedErrors = true;
          invalidFieldImplementation.implementedResponseType = printTypeNode(fieldData.node.type);
        }
        const handledArguments = new Set<string>();
        for (const [argumentName, inputValueData] of interfaceField.argumentDataByArgumentName) {
          const interfaceArgument = inputValueData.node;
          handledArguments.add(argumentName);
          const argumentNode = fieldData.argumentDataByArgumentName.get(argumentName)?.node;
          // The type implementing the interface must include all arguments with no variation for that argument
          if (!argumentNode) {
            hasErrors = true;
            hasNestedErrors = true;
            invalidFieldImplementation.unimplementedArguments.add(argumentName);
            continue;
          }
          // Implemented arguments should be the exact same type
          const actualType = printTypeNode(argumentNode.type);
          const expectedType = printTypeNode(interfaceArgument.type);
          if (expectedType !== actualType) {
            hasErrors = true;
            hasNestedErrors = true;
            invalidFieldImplementation.invalidImplementedArguments.push({ actualType, argumentName, expectedType });
          }
        }
        // Additional arguments must be optional (nullable)
        for (const [argumentName, inputValueContainer] of fieldData.argumentDataByArgumentName) {
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
      this.errors.push(
        unimplementedInterfaceFieldsError(data.node.name.value, kindToTypeString(data.kind), implementationErrorsMap),
      );
    }
    return interfaces;
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
      this.errors.push(
        unimplementedInterfaceFieldsError(
          container.node.name.value,
          kindToTypeString(container.kind),
          implementationErrorsMap,
        ),
      );
    }
    return interfaces;
  }

  // TODO extract
  // mergeArguments(
  //   container: FederationFieldData | DirectiveContainer,
  //   args: MutableInputValueDefinitionNode[],
  //   errors: InvalidRequiredArgument[],
  //   argumentNames?: string[],
  // ) {
  //   for (const argumentContainer of container.arguments.values()) {
  //     const missingSubgraphs = getEntriesNotInHashSet(container.subgraphNames, argumentContainer.subgraphs);
  //     const argumentName = argumentContainer.node.name.value;
  //     if (missingSubgraphs.length > 0) {
  //       // Required arguments must be defined in all subgraphs that define the field
  //       if (argumentContainer.requiredSubgraphs.size > 0) {
  //         errors.push({
  //           argumentName,
  //           missingSubgraphs,
  //           requiredSubgraphs: [...argumentContainer.requiredSubgraphs],
  //         });
  //       }
  //       // If the argument is always optional, but it's not defined in all subgraphs that define the field,
  //       // the argument should not be included in the federated graph
  //       continue;
  //     }
  //     argumentContainer.node.defaultValue = argumentContainer.includeDefaultValue
  //       ? argumentContainer.node.defaultValue
  //       : undefined;
  //     args.push(pushPersistedDirectivesAndGetNode(argumentContainer));
  //     if (argumentNames) {
  //       argumentNames.push(argumentName);
  //     }
  //   }
  // }

  // addValidExecutableDirectiveDefinition(
  //   directiveName: string,
  //   directiveContainer: DirectiveContainer,
  //   definitions: MutableTypeDefinitionNode[],
  // ) {
  //   if (!this.executableDirectives.has(directiveName)) {
  //     return;
  //   }
  //   if (this.internalSubgraphBySubgraphName.size !== directiveContainer.subgraphNames.size) {
  //     return;
  //   }
  //   directiveContainer.node.locations = setToNameNodeArray(directiveContainer.executableLocations);
  //   if (!directiveContainer.arguments) {
  //     definitions.push(directiveContainer.node);
  //     return;
  //   }
  //   const args: MutableInputValueDefinitionNode[] = [];
  //   const errors: InvalidRequiredArgument[] = [];
  //   this.mergeArguments(directiveContainer, args, errors);
  //   if (errors.length > 0) {
  //     this.errors.push(invalidRequiredArgumentsError(DIRECTIVE_DEFINITION, directiveName, errors));
  //     return;
  //   }
  //   directiveContainer.node.arguments = args;
  //   definitions.push(directiveContainer.node);
  // }

  getMergedFieldDefinitionNode(fieldContainer: FederationFieldData, parentTypeName: string): FieldDefinitionNode {
    pushPersistedDirectivesAndGetNode(fieldContainer);
    if (fieldContainer.arguments.size < 1) {
      return fieldContainer.node;
    }
    const fieldName = fieldContainer.node.name.value;
    const fieldPath = `${parentTypeName}.${fieldName}`;
    const args: MutableInputValueDefinitionNode[] = [];
    const errors: InvalidRequiredArgument[] = [];
    const argumentNames: string[] = [];
    // this.mergeArguments(fieldContainer, args, errors, argumentNames);
    if (errors.length > 0) {
      this.errors.push(invalidRequiredArgumentsError(FIELD, fieldPath, errors));
    } else if (argumentNames.length > 0) {
      this.fieldConfigurationByFieldPath.set(`${parentTypeName}.${fieldName}`, {
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
      deprecatedDirectiveContainer.reason &&
      reasonArgument.value.length < deprecatedDirectiveContainer.reason.length
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
    directives: readonly ConstDirectiveNode[],
    container: PersistedDirectivesContainer,
  ): PersistedDirectivesContainer {
    if (directives.length < 1) {
      return container;
    }
    for (const directive of directives) {
      const directiveName = directive.name.value;
      if (!this.persistedDirectiveDefinitions.has(directiveName)) {
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
      // const definition = getOrThrowError(this.directiveDefinitions, directiveName, 'directiveDefinitions');
      // if (!definition.node.repeatable) {
      //   continue;
      // }
      existingDirectives.push(directive);
    }
    return container;
  }

  isFieldResolvableByEntityAncestor(
    entityAncestors: string[],
    fieldSubgraphs: Set<string>,
    parentTypeName: string,
  ): boolean {
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
          getOrThrowError(this.entityContainersByTypeName, entityAncestorName, ENTITIES).subgraphNames,
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
    for (const entityAncestorTypeName of entityAncestors) {
      const entityContainer = getOrThrowError(
        this.parentDefinitionDataByTypeName,
        entityAncestorTypeName,
        'parentDefinitionDataByTypeName',
      ) as ObjectDefinitionData;
      const mutualEntityAncestorRootTypeFieldSubgraphs = getAllMutualEntries(
        rootTypeFieldSubgraphs,
        entityContainer.subgraphNames,
      );
      const mutualEntityAncestorSubgraphsNames = getAllMutualEntries(
        mutualEntityAncestorRootTypeFieldSubgraphs,
        objectSubgraphs,
      );
      for (const mutualSubgraphName of mutualEntityAncestorSubgraphsNames) {
        const objects = this.evaluatedObjectLikesBySubgraph.get(mutualSubgraphName);
        if (objects) {
          objects.add(parentTypeName);
        } else {
          this.evaluatedObjectLikesBySubgraph.set(mutualSubgraphName, new Set<string>([parentTypeName]));
        }
      }
    }
  }

  evaluateResolvabilityOfObject(
    objectData: ObjectDefinitionData,
    rootTypeFieldData: RootTypeFieldData,
    currentFieldPath: string,
    evaluatedObjectLikes: Set<string>,
    entityAncestors: string[],
    isParentAbstract = false,
  ) {
    const parentTypeName = objectData.name;
    if (evaluatedObjectLikes.has(parentTypeName)) {
      return;
    }
    if (!this.shouldEvaluateObjectLike(rootTypeFieldData.subgraphs, parentTypeName)) {
      evaluatedObjectLikes.add(parentTypeName);
      return;
    }

    for (const [fieldName, fieldData] of objectData.fieldDataByFieldName) {
      const namedFieldTypeName = fieldData.namedTypeName;
      if (ROOT_TYPES.has(namedFieldTypeName)) {
        continue;
      }
      // Avoid an infinite loop with self-referential objects
      if (evaluatedObjectLikes.has(namedFieldTypeName)) {
        continue;
      }
      if (isFieldExternalInAllMutualSubgraphs(rootTypeFieldData.subgraphs, fieldData)) {
        continue;
      }
      this.updateEvaluatedSubgraphOccurrences(
        rootTypeFieldData.subgraphs,
        objectData.subgraphNames,
        entityAncestors,
        parentTypeName,
      );
      evaluatedObjectLikes.add(parentTypeName);
      const isFieldResolvable =
        doSetsHaveAnyOverlap(rootTypeFieldData.subgraphs, fieldData.subgraphNames) ||
        this.isFieldResolvableByEntityAncestor(entityAncestors, fieldData.subgraphNames, parentTypeName);
      const newCurrentFieldPath = currentFieldPath + (isParentAbstract ? ' ' : '.') + fieldName;
      const entity = this.entityContainersByTypeName.get(namedFieldTypeName);
      if (isFieldResolvable) {
        // The base scalars are not in this.parentMap
        if (BASE_SCALARS.has(namedFieldTypeName)) {
          continue;
        }
        const namedTypeData = getOrThrowError(
          this.parentDefinitionDataByTypeName,
          namedFieldTypeName,
          'parentDefinitionDataByTypeName',
        );
        switch (namedTypeData.kind) {
          case Kind.ENUM_TYPE_DEFINITION:
          // intentional fallthrough
          case Kind.SCALAR_TYPE_DEFINITION:
            continue;
          case Kind.OBJECT_TYPE_DEFINITION:
            this.evaluateResolvabilityOfObject(
              namedTypeData,
              rootTypeFieldData,
              newCurrentFieldPath,
              evaluatedObjectLikes,
              entity ? [...entityAncestors, namedFieldTypeName] : [...entityAncestors],
            );
            continue;
          case Kind.INTERFACE_TYPE_DEFINITION:
          // intentional fallthrough
          case Kind.UNION_TYPE_DEFINITION:
            this.evaluateResolvabilityOfAbstractType(
              namedFieldTypeName,
              namedTypeData.kind,
              rootTypeFieldData,
              newCurrentFieldPath,
              evaluatedObjectLikes,
              entity ? [...entityAncestors, namedFieldTypeName] : [...entityAncestors],
            );
            continue;
          default:
            this.errors.push(unexpectedObjectResponseType(newCurrentFieldPath, kindToTypeString(namedTypeData.kind)));
            continue;
        }
      }
      if (BASE_SCALARS.has(namedFieldTypeName)) {
        this.errors.push(
          unresolvableFieldError(
            rootTypeFieldData,
            fieldName,
            [...fieldData.subgraphNames],
            newCurrentFieldPath,
            parentTypeName,
          ),
        );
        continue;
      }
      const namedTypeData = getOrThrowError(
        this.parentDefinitionDataByTypeName,
        namedFieldTypeName,
        'parentDefinitionDataByTypeName',
      );
      switch (namedTypeData.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.SCALAR_TYPE_DEFINITION:
          this.errors.push(
            unresolvableFieldError(
              rootTypeFieldData,
              fieldName,
              [...fieldData.subgraphNames],
              newCurrentFieldPath,
              parentTypeName,
            ),
          );
          continue;
        case Kind.INTERFACE_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.UNION_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.OBJECT_TYPE_DEFINITION:
          this.errors.push(
            unresolvableFieldError(
              rootTypeFieldData,
              fieldName,
              [...fieldData.subgraphNames],
              newCurrentFieldPath + SELECTION_REPRESENTATION,
              parentTypeName,
            ),
          );
          continue;
        default:
          this.errors.push(unexpectedObjectResponseType(newCurrentFieldPath, kindToTypeString(namedTypeData.kind)));
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
  ) {
    if (evaluatedObjectLikes.has(abstractTypeName)) {
      return;
    }
    evaluatedObjectLikes.add(abstractTypeName);
    const concreteTypeNames = this.concreteTypeNamesByAbstractTypeName.get(abstractTypeName);
    if (!concreteTypeNames) {
      noConcreteTypesForAbstractTypeError(kindToTypeString(abstractKind), abstractTypeName);
      return;
    }
    for (const concreteTypeName of concreteTypeNames) {
      if (evaluatedObjectLikes.has(concreteTypeName)) {
        continue;
      }
      const concreteTypeData = getOrThrowError(
        this.parentDefinitionDataByTypeName,
        concreteTypeName,
        'parentDefinitionDataByTypeName',
      );
      if (concreteTypeData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        throw unexpectedParentKindErrorMessage(concreteTypeName, 'Object', kindToTypeString(concreteTypeData.kind));
      }

      // If the concrete type is unreachable through an inline fragment, it is not an error
      if (!doSetsHaveAnyOverlap(concreteTypeData.subgraphNames, rootTypeFieldData.subgraphs)) {
        continue;
      }
      const entity = this.entityContainersByTypeName.get(concreteTypeName);
      this.evaluateResolvabilityOfObject(
        concreteTypeData,
        rootTypeFieldData,
        currentFieldPath + ` ... on ` + concreteTypeName,
        evaluatedObjectLikes,
        entity ? [...entityAncestors, concreteTypeName] : [...entityAncestors],
        true,
      );
    }
  }

  validateKeyFieldSetsForImplicitEntity(entityContainer: EntityContainer) {
    const internalSubgraph = getOrThrowError(
      this.internalSubgraphBySubgraphName,
      this.currentSubgraphName,
      'internalSubgraphBySubgraphName',
    );
    const parentContainerByTypeName = internalSubgraph.parentDefinitionDataByTypeName;
    const extensionContainerByTypeName = internalSubgraph.parentExtensionDataByTypeName;
    const implicitEntityContainer =
      parentContainerByTypeName.get(entityContainer.typeName) ||
      extensionContainerByTypeName.get(entityContainer.typeName);
    if (
      !implicitEntityContainer ||
      (implicitEntityContainer.kind !== Kind.OBJECT_TYPE_DEFINITION &&
        implicitEntityContainer.kind !== Kind.OBJECT_TYPE_EXTENSION)
    ) {
      throw incompatibleParentKindFatalError(
        entityContainer.typeName,
        Kind.OBJECT_TYPE_DEFINITION,
        implicitEntityContainer?.kind || Kind.NULL,
      );
    }
    const configurationData = getOrThrowError(
      internalSubgraph.configurationDataMap,
      entityContainer.typeName,
      'internalSubgraph.configurationDataMap',
    );
    const keyFieldNames = new Set<string>();
    const keys: RequiredFieldConfiguration[] = [];
    // Any errors in the field sets would be caught when evaluating the explicit entities, so they are ignored here
    for (const fieldSet of entityContainer.keyFieldSets) {
      // Create a new selection set so that the value can be parsed as a new DocumentNode
      const { error, documentNode } = safeParse('{' + fieldSet + '}');
      if (error || !documentNode) {
        // This would be caught as an error elsewhere
        continue;
      }
      const parentContainers: NormalizationObjectLikeData[] = [implicitEntityContainer];
      const definedFields: Set<string>[] = [];
      let currentDepth = -1;
      let shouldDefineSelectionSet = true;
      let shouldAddKeyFieldSet = true;
      visit(documentNode, {
        Argument: {
          enter() {
            // Fields that define arguments are never allowed in a key FieldSet
            // However, at this stage, it actually means the argument is undefined on the field
            shouldAddKeyFieldSet = false;
            return BREAK;
          },
        },
        Field: {
          enter(node) {
            const parentContainer = parentContainers[currentDepth];
            const parentTypeName = parentContainer.name;
            // If an object-like was just visited, a selection set should have been entered
            if (shouldDefineSelectionSet) {
              shouldAddKeyFieldSet = false;
              return BREAK;
            }
            const fieldName = node.name.value;
            const fieldPath = `${parentTypeName}.${fieldName}`;
            const fieldContainer = parentContainer.fieldDataByFieldName.get(fieldName);
            // undefined if the field does not exist on the parent
            if (
              !fieldContainer ||
              fieldContainer.argumentDataByArgumentName.size ||
              definedFields[currentDepth].has(fieldName)
            ) {
              shouldAddKeyFieldSet = false;
              return BREAK;
            }
            definedFields[currentDepth].add(fieldName);
            // Depth 0 is the original parent type
            // If a field is external, but it's part of a key FieldSet, it will be included in the root configuration
            if (currentDepth === 0) {
              keyFieldNames.add(fieldName);
            }
            const namedTypeName = getNamedTypeForChild(fieldPath, fieldContainer.node.type);
            // The base scalars are not in the parents map
            if (BASE_SCALARS.has(namedTypeName)) {
              return;
            }
            // The child could itself be a parent and could exist as an object extension
            const childContainer =
              parentContainerByTypeName.get(namedTypeName) || extensionContainerByTypeName.get(namedTypeName);
            if (!childContainer) {
              shouldAddKeyFieldSet = false;
              return BREAK;
            }
            if (
              childContainer.kind === Kind.OBJECT_TYPE_DEFINITION ||
              childContainer.kind === Kind.OBJECT_TYPE_EXTENSION
            ) {
              shouldDefineSelectionSet = true;
              parentContainers.push(childContainer);
              return;
            }
            // interfaces and unions are invalid in a key directive
            if (isKindAbstract(childContainer.kind)) {
              shouldAddKeyFieldSet = false;
              return BREAK;
            }
          },
        },
        InlineFragment: {
          enter() {
            shouldAddKeyFieldSet = false;
            return BREAK;
          },
        },
        SelectionSet: {
          enter() {
            if (!shouldDefineSelectionSet) {
              shouldAddKeyFieldSet = false;
              return BREAK;
            }
            currentDepth += 1;
            shouldDefineSelectionSet = false;
            if (currentDepth < 0 || currentDepth >= parentContainers.length) {
              shouldAddKeyFieldSet = false;
              return BREAK;
            }
            definedFields.push(new Set<string>());
          },
          leave() {
            if (shouldDefineSelectionSet) {
              shouldAddKeyFieldSet = false;
              return BREAK;
            }
            // Empty selection sets would be a parse error, so it is unnecessary to handle them
            currentDepth -= 1;
            parentContainers.pop();
            definedFields.pop();
          },
        },
      });
      if (!shouldAddKeyFieldSet) {
        continue;
      }
      // Add any top-level fields that compose the key in case they are external
      addIterableValuesToSet(keyFieldNames, configurationData.fieldNames);
      keys.push({
        fieldName: '',
        selectionSet: getNormalizedFieldSet(documentNode),
        disableEntityResolver: true,
      });
    }
    if (keys.length > 0) {
      configurationData.isRootNode = true;
      configurationData.keys = keys;
    }
  }

  handleAuthorizationDataForRenamedTypes() {
    for (const [originalTypeName, renamedTypeName] of this.renamedTypeNameByOriginalTypeName) {
      const originalAuthorizationData = this.authorizationDataByParentTypeName.get(originalTypeName);
      if (!originalAuthorizationData) {
        continue;
      }
      originalAuthorizationData.typeName = renamedTypeName;
      const renamedAuthorizationData = this.authorizationDataByParentTypeName.get(renamedTypeName);
      if (!renamedAuthorizationData) {
        this.authorizationDataByParentTypeName.set(renamedTypeName, originalAuthorizationData);
      } else {
        for (const [
          fieldName,
          incomingFieldAuthorizationData,
        ] of renamedAuthorizationData.fieldAuthorizationDataByFieldName) {
          if (
            !upsertFieldAuthorizationData(
              originalAuthorizationData.fieldAuthorizationDataByFieldName,
              incomingFieldAuthorizationData,
            )
          ) {
            this.invalidOrScopesHostPaths.add(`${renamedTypeName}.${fieldName}`);
          }
        }
      }
      this.authorizationDataByParentTypeName.delete(originalTypeName);
    }
  }

  getEnumValueMergeMethod(enumTypeName: string): MergeMethod {
    if (this.namedInputValueTypeNames.has(enumTypeName)) {
      if (this.namedOutputTypeNames.has(enumTypeName)) {
        return MergeMethod.CONSISTENT;
      }
      return MergeMethod.INTERSECTION;
    }
    return MergeMethod.UNION;
  }

  federate(): FederationResultContainer {
    const persistedDirectiveDefinitionDataByDirectiveName = new Map<string, PersistedDirectiveDefinitionData>();
    let shouldSkipPersistedExecutableDirectives = false;
    let subgraphNumber = 0;
    let isVersionTwo = false;
    for (const internalSubgraph of this.internalSubgraphBySubgraphName.values()) {
      subgraphNumber += 1;
      this.currentSubgraphName = internalSubgraph.name;
      isVersionTwo ||= internalSubgraph.isVersionTwo;
      createMultiGraphAndRenameRootTypes(this, internalSubgraph);
      for (const parentDefinitionData of internalSubgraph.parentDefinitionDataByTypeName.values()) {
        upsertParentDefinitionData(
          this.parentDefinitionDataByTypeName,
          parentDefinitionData,
          this.persistedDirectiveDefinitionByDirectiveName,
          this.entityInterfaceFederationDataByTypeName,
          this.namedOutputTypeNames,
          this.namedInputValueTypeNames,
          internalSubgraph.name,
          this.errors,
        );
      }
      for (const objectExtensionData of internalSubgraph.parentExtensionDataByTypeName.values()) {
        upsertObjectExtensionData(
          this.objectExtensionDataByTypeName,
          objectExtensionData,
          this.persistedDirectiveDefinitionByDirectiveName,
          this.namedOutputTypeNames,
          this.namedInputValueTypeNames,
          this.errors,
        );
      }
      if (shouldSkipPersistedExecutableDirectives) {
        continue;
      }
      /* If a subgraph defines no executable directives, it is not possible for any definition to be in all subgraphs.
         Consequently, it is no longer necessary to check for any persisted executable directives. */
      if (!internalSubgraph.persistedDirectiveDefinitionDataByDirectiveName.size) {
        shouldSkipPersistedExecutableDirectives = true;
        continue;
      }
      for (const persistedDirectiveDefinitionData of internalSubgraph.persistedDirectiveDefinitionDataByDirectiveName.values()) {
        upsertPersistedDirectiveDefinitionData(
          persistedDirectiveDefinitionDataByDirectiveName,
          persistedDirectiveDefinitionData,
          this.persistedDirectiveDefinitionByDirectiveName,
          this.namedInputValueTypeNames,
          subgraphNumber,
          this.errors,
        );
      }
      /* Invalid directives keys are deleted; if there are no entries left, it is no longer necessary to evaluate more
         executable directives. */
      if (!persistedDirectiveDefinitionDataByDirectiveName.size) {
        shouldSkipPersistedExecutableDirectives = true;
      }
    }
    const definitions: MutableTypeDefinitionNode[] = isVersionTwo
      ? [
          AUTHENTICATED_DEFINITION,
          DEPRECATED_DEFINITION,
          INACCESSIBLE_DEFINITION,
          REQUIRES_SCOPES_DEFINITION,
          SCOPE_SCALAR_DEFINITION,
          TAG_DEFINITION,
        ]
      : [DEPRECATED_DEFINITION, TAG_DEFINITION];
    for (const data of persistedDirectiveDefinitionDataByDirectiveName.values()) {
      addValidPersistedDirectiveDefinitionNodeByData(
        definitions,
        data,
        this.persistedDirectiveDefinitionByDirectiveName,
        this.errors,
      );
    }
    // for (const subgraph of this.internalSubgraphBySubgraphName.values()) {
    //   this.isCurrentSubgraphVersionTwo = subgraph.isVersionTwo;
    //   this.currentSubgraphName = subgraph.name;
    //   this.keyFieldNamesByParentTypeName = subgraph.keyFieldNamesByParentTypeName;
    // walkSubgraphToFederate(subgraph.definitions, subgraph.overriddenFieldNamesByParentTypeName, this);
    // }
    this.handleAuthorizationDataForRenamedTypes();
    for (const [typeName, entityInterfaceData] of this.entityInterfaceFederationDataByTypeName) {
      subtractSourceSetFromTargetSet(
        entityInterfaceData.interfaceFieldNames,
        entityInterfaceData.interfaceObjectFieldNames,
      );
      const entityInterface = getOrThrowError(
        this.parentDefinitionDataByTypeName,
        typeName,
        'parentDefinitionDataByTypeName',
      );
      if (entityInterface.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        // TODO error
        continue;
      }
      for (const subgraphName of entityInterfaceData.interfaceObjectSubgraphs) {
        const configurationDataMap = getOrThrowError(
          this.internalSubgraphBySubgraphName,
          subgraphName,
          'internalSubgraphBySubgraphName',
        ).configurationDataMap;
        const concreteTypeNames = this.concreteTypeNamesByAbstractTypeName.get(typeName);
        if (!concreteTypeNames) {
          continue;
        }
        const interfaceObjectConfiguration = getOrThrowError(configurationDataMap, typeName, 'configurationDataMap');
        const keys = interfaceObjectConfiguration.keys;
        if (!keys) {
          // TODO no keys error
          continue;
        }
        interfaceObjectConfiguration.entityInterfaceConcreteTypeNames = entityInterfaceData.concreteTypeNames;
        const fieldNames = interfaceObjectConfiguration.fieldNames;
        const authorizationData = this.authorizationDataByParentTypeName.get(entityInterfaceData.typeName);
        for (const concreteTypeName of concreteTypeNames) {
          if (configurationDataMap.has(concreteTypeName)) {
            // error TODO
            continue;
          }
          if (authorizationData) {
            const concreteAuthorizationData = getValueOrDefault(
              this.authorizationDataByParentTypeName,
              concreteTypeName,
              () => newAuthorizationData(concreteTypeName),
            );
            for (const fieldAuthorizationData of authorizationData.fieldAuthorizationDataByFieldName.values()) {
              if (
                !upsertFieldAuthorizationData(
                  concreteAuthorizationData.fieldAuthorizationDataByFieldName,
                  fieldAuthorizationData,
                )
              ) {
                this.invalidOrScopesHostPaths.add(`${concreteTypeName}.${fieldAuthorizationData.fieldName}`);
              }
            }
          }
          const concreteTypeData = getOrThrowError(
            this.parentDefinitionDataByTypeName,
            concreteTypeName,
            'parentDefinitionDataByTypeName',
          );
          if (concreteTypeData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
            continue;
          }
          // The subgraph locations of the interface object must be added to the concrete types that implement it
          const entity = this.entityContainersByTypeName.get(concreteTypeName);
          if (entity) {
            // TODO error if not an entity
            entity.subgraphNames.add(subgraphName);
          }
          const configurationData: ConfigurationData = {
            fieldNames,
            isRootNode: true,
            keys,
            typeName: concreteTypeName,
          };
          for (const fieldName of entityInterfaceData.interfaceObjectFieldNames) {
            const existingFieldData = concreteTypeData.fieldDataByFieldName.get(fieldName);
            if (existingFieldData) {
              // TODO handle shareability
              continue;
            }
            const interfaceFieldData = getOrThrowError(
              entityInterface.fieldDataByFieldName,
              fieldName,
              `${typeName}.fieldDataByFieldName`,
            );
            concreteTypeData.fieldDataByFieldName.set(fieldName, { ...interfaceFieldData });
          }
          configurationDataMap.set(concreteTypeName, configurationData);
        }
      }
    }
    if (this.invalidOrScopesHostPaths.size > 0) {
      this.errors.push(orScopesLimitError(maxOrScopes, [...this.invalidOrScopesHostPaths]));
    }
    for (const [parentTypeName, objectExtensionData] of this.objectExtensionDataByTypeName) {
      upsertValidObjectExtensionData(
        this.parentDefinitionDataByTypeName,
        objectExtensionData,
        this.persistedDirectiveDefinitionByDirectiveName,
        this.namedOutputTypeNames,
        this.namedInputValueTypeNames,
        this.errors,
        this.authorizationDataByParentTypeName.get(parentTypeName),
      );
    }
    // for (const [typeName, extension] of this.extensions) {
    //   this.parentTypeName = typeName;
    //   if (extension.isRootType && !this.parents.has(typeName)) {
    //     this.upsertParentNode(objectTypeExtensionNodeToMutableDefinitionNode(extension.node));
    //   }
    //   const baseObject = this.parents.get(typeName);
    //   if (!baseObject) {
    //     this.errors.push(noBaseTypeExtensionError(typeName));
    //     continue;
    //   }
    //
    //   if (baseObject.kind !== Kind.OBJECT_TYPE_DEFINITION) {
    //     throw incompatibleParentKindFatalError(typeName, Kind.OBJECT_TYPE_DEFINITION, baseObject.kind);
    //   }
    //   this.upsertExtensionPersistedDirectives(extension.directives, baseObject.directives);
    //   for (const [extensionFieldName, extensionFieldContainer] of extension.fields) {
    //     const baseFieldContainer = baseObject.fields.get(extensionFieldName);
    //     if (!baseFieldContainer) {
    //       baseObject.fields.set(extensionFieldName, extensionFieldContainer);
    //       continue;
    //     }
    //     if (baseFieldContainer.isShareable && extensionFieldContainer.isShareable) {
    //       this.childName = extensionFieldName;
    //       this.upsertExtensionFieldArguments(extensionFieldContainer.arguments, baseFieldContainer.arguments);
    //       addIterableValuesToSet(extensionFieldContainer.subgraphNames, baseFieldContainer.subgraphNames);
    //       continue;
    //     }
    //     const parent = this.shareableErrorTypeNames.get(typeName);
    //     if (parent) {
    //       parent.add(extensionFieldName);
    //       continue;
    //     }
    //     this.shareableErrorTypeNames.set(typeName, new Set<string>([extensionFieldName]));
    //   }
    //   for (const interfaceName of extension.interfaces) {
    //     baseObject.interfaces.add(interfaceName);
    //   }
    // }
    // for (const [parentTypeName, children] of this.shareableErrorTypeNames) {
    //   const parent = getOrThrowError(this.parents, parentTypeName, PARENTS);
    //   if (parent.kind !== Kind.OBJECT_TYPE_DEFINITION) {
    //     throw incompatibleParentKindFatalError(parentTypeName, Kind.OBJECT_TYPE_DEFINITION, parent.kind);
    //   }
    //   this.errors.push(shareableFieldDefinitionsError(parent, children));
    // }
    const definitionsWithInterfaces: DefinitionWithFieldsData[] = [];
    for (const [parentTypeName, parentDefinitionData] of this.parentDefinitionDataByTypeName) {
      switch (parentDefinitionData.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
          const enumValueNodes: MutableEnumValueNode[] = [];
          const mergeMethod = this.getEnumValueMergeMethod(parentTypeName);
          for (const enumValueData of parentDefinitionData.enumValueDataByValueName.values()) {
            const enumValueNode = getNodeWithPersistedDirectivesByData(
              enumValueData,
              this.persistedDirectiveDefinitionByDirectiveName,
              this.errors,
            );
            switch (mergeMethod) {
              case MergeMethod.CONSISTENT:
                if (parentDefinitionData.appearances > enumValueData.appearances) {
                  this.errors.push(incompatibleSharedEnumError(parentTypeName));
                }
                enumValueNodes.push(enumValueNode);
                break;
              case MergeMethod.INTERSECTION:
                if (parentDefinitionData.appearances === enumValueData.appearances) {
                  enumValueNodes.push(enumValueNode);
                }
                break;
              default:
                enumValueNodes.push(enumValueNode);
                break;
            }
          }
          parentDefinitionData.node.values = enumValueNodes;
          definitions.push(
            getNodeWithPersistedDirectivesByData(
              parentDefinitionData,
              this.persistedDirectiveDefinitionByDirectiveName,
              this.errors,
            ),
          );
          break;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          const invalidRequiredFieldNames: string[] = [];
          const inputValueNodes: MutableInputValueNode[] = [];
          for (const [inputValueName, inputValueData] of parentDefinitionData.inputValueDataByValueName) {
            if (parentDefinitionData.appearances === inputValueData.subgraphNames.size) {
              inputValueNodes.push(
                getNodeWithPersistedDirectivesByInputValueData(
                  inputValueData,
                  this.persistedDirectiveDefinitionByDirectiveName,
                  this.errors,
                ),
              );
            } else if (isTypeRequired(inputValueData.type)) {
              invalidRequiredFieldNames.push(inputValueName);
            }
          }
          if (invalidRequiredFieldNames.length > 0) {
            this.errors.push(invalidRequiredInputFieldError(parentTypeName, invalidRequiredFieldNames));
            break;
          }
          parentDefinitionData.node.fields = inputValueNodes;
          definitions.push(
            getNodeWithPersistedDirectivesByData(
              parentDefinitionData,
              this.persistedDirectiveDefinitionByDirectiveName,
              this.errors,
            ),
          );
          break;
        case Kind.INTERFACE_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.OBJECT_TYPE_DEFINITION:
          const fieldNodes: MutableFieldNode[] = [];
          const invalidFieldNames = new Set<string>();
          const isObject = parentDefinitionData.kind === Kind.OBJECT_TYPE_DEFINITION;
          for (const [fieldName, fieldData] of parentDefinitionData.fieldDataByFieldName) {
            pushAuthorizationDirectives(fieldData, this.authorizationDataByParentTypeName.get(parentTypeName));
            const argumentNodes = getValidFieldArgumentNodes(
              fieldData,
              this.persistedDirectiveDefinitionByDirectiveName,
              this.fieldConfigurationByFieldPath,
              this.errors,
            );
            if (isObject && !isShareabilityOfAllFieldInstancesValid(fieldData)) {
              invalidFieldNames.add(fieldName);
            }

            if (fieldData.isInaccessible) {
              continue;
            }
            fieldNodes.push(
              getNodeWithPersistedDirectivesByFieldData(
                fieldData,
                this.persistedDirectiveDefinitionByDirectiveName,
                argumentNodes,
                this.errors,
              ),
            );
          }
          if (isObject && invalidFieldNames.size > 0) {
            this.errors.push(invalidFieldShareabilityError(parentDefinitionData, invalidFieldNames));
          }
          parentDefinitionData.node.fields = fieldNodes;
          // Implemented interfaces can only be validated after all fields are merged
          if (parentDefinitionData.implementedInterfaceTypeNames.size > 0) {
            definitionsWithInterfaces.push(parentDefinitionData);
          } else {
            definitions.push(
              getNodeWithPersistedDirectivesByData(
                parentDefinitionData,
                this.persistedDirectiveDefinitionByDirectiveName,
                this.errors,
              ),
            );
          }
          if (fieldNodes.length < 1) {
            if (isNodeQuery(parentTypeName)) {
              this.errors.push(noQueryRootTypeError);
            } else {
              this.errors.push(
                allFieldDefinitionsAreInaccessibleError(kindToTypeString(parentDefinitionData.kind), parentTypeName),
              );
            }
          }
          break;
        case Kind.SCALAR_TYPE_DEFINITION:
          if (!BASE_SCALARS.has(parentTypeName)) {
            definitions.push(
              getNodeWithPersistedDirectivesByData(
                parentDefinitionData,
                this.persistedDirectiveDefinitionByDirectiveName,
                this.errors,
              ),
            );
          }
          break;
        case Kind.UNION_TYPE_DEFINITION:
          parentDefinitionData.node.types = mapToArrayOfValues(parentDefinitionData.memberByMemberTypeName);
          definitions.push(
            getNodeWithPersistedDirectivesByData(
              parentDefinitionData,
              this.persistedDirectiveDefinitionByDirectiveName,
              this.errors,
            ),
          );
          break;
      }
    }
    // for (const [parentTypeName, parentContainer] of this.parents) {
    //   switch (parentContainer.kind) {
    // case Kind.ENUM_TYPE_DEFINITION:
    //   const values: MutableEnumValueDefinitionNode[] = [];
    //   const mergeMethod = this.getEnumMergeMethod(parentTypeName);
    //   for (const enumValueContainer of parentContainer.values.values()) {
    //     pushPersistedDirectivesAndGetNode(enumValueContainer);
    //     switch (mergeMethod) {
    //       case MergeMethod.CONSISTENT:
    //         if (enumValueContainer.appearances < parentContainer.appearances) {
    //           this.errors.push(incompatibleSharedEnumError(parentTypeName));
    //         }
    //         values.push(enumValueContainer.node);
    //         break;
    //       case MergeMethod.INTERSECTION:
    //         if (enumValueContainer.appearances === parentContainer.appearances) {
    //           values.push(enumValueContainer.node);
    //         }
    //         break;
    //       default:
    //         values.push(enumValueContainer.node);
    //         break;
    //     }
    //   }
    //   parentContainer.node.values = values;
    //   definitions.push(pushPersistedDirectivesAndGetNode(parentContainer));
    //   break;
    // case Kind.INPUT_OBJECT_TYPE_DEFINITION:
    //   const inputValues: InputValueDefinitionNode[] = [];
    //   for (const inputValueContainer of parentContainer.fields.values()) {
    //     pushPersistedDirectivesAndGetNode(inputValueContainer);
    //     if (parentContainer.appearances === inputValueContainer.appearances) {
    //       inputValues.push(inputValueContainer.node);
    //     } else if (isTypeRequired(inputValueContainer.node.type)) {
    //       this.errors.push(federationRequiredInputFieldError(parentTypeName, inputValueContainer.node.name.value));
    //       break;
    //     }
    //   }
    //   parentContainer.node.fields = inputValues;
    //   definitions.push(pushPersistedDirectivesAndGetNode(parentContainer));
    //   break;
    // case Kind.INTERFACE_TYPE_DEFINITION:
    //   const interfaceFields: FieldDefinitionNode[] = [];
    //   for (const fieldContainer of parentContainer.fields.values()) {
    //     if (isFieldInaccessible(fieldContainer)) {
    //       continue;
    //     }
    //     interfaceFields.push(this.getMergedFieldDefinitionNode(fieldContainer, parentTypeName));
    //   }
    //   parentContainer.node.fields = interfaceFields;
    //   pushPersistedDirectivesAndGetNode(parentContainer);
    //   // Interface implementations can only be evaluated after they've been fully merged
    //   if (parentContainer.interfaces.size > 0) {
    //     definitionsWithInterfaces.push(parentContainer);
    //   } else {
    //     definitions.push(parentContainer.node);
    //   }
    //   if (interfaceFields.length < 1) {
    //     this.errors.push(allFieldDefinitionsAreInaccessibleError('interface', parentTypeName));
    //   }
    //   break;
    // case Kind.OBJECT_TYPE_DEFINITION:
    //   const fields: FieldDefinitionNode[] = [];
    //   for (const fieldContainer of parentContainer.fields.values()) {
    //     if (isFieldInaccessible(fieldContainer)) {
    //       continue;
    //     }
    //     fields.push(this.getMergedFieldDefinitionNode(fieldContainer, parentTypeName));
    //   }
    //   parentContainer.node.fields = fields;
    //   pushPersistedDirectivesAndGetNode(parentContainer);
    //   // Interface implementations can only be evaluated after they've been fully merged
    //   if (parentContainer.interfaces.size > 0) {
    //     definitionsWithInterfaces.push(parentContainer);
    //   }
    // } else {
    //   definitions.push(parentContainer.node);
    // }
    // if (fields.length < 1) {
    //   if (isNodeQuery(parentTypeName)) {
    //     this.errors.push(noQueryRootTypeError);
    //   } else {
    //     this.errors.push(allFieldDefinitionsAreInaccessibleError('object', parentTypeName));
    //   }
    // }
    // break;
    // case Kind.SCALAR_TYPE_DEFINITION:
    //   if (!BASE_SCALARS.has(parentTypeName)) {
    //     definitions.push(pushPersistedDirectivesAndGetNode(parentContainer));
    //   }
    //   break;
    // case Kind.UNION_TYPE_DEFINITION:
    //   const types: NamedTypeNode[] = [];
    //   for (const memberName of parentContainer.members) {
    //     types.push(stringToNamedTypeNode(memberName));
    //   }
    //   parentContainer.node.types = types;
    //   definitions.push(pushPersistedDirectivesAndGetNode(parentContainer));
    //   break;
    //   }
    // }
    for (const data of definitionsWithInterfaces) {
      data.node.interfaces = this.getValidImplementedInterfaces(data);
      definitions.push(
        getNodeWithPersistedDirectivesByData(data, this.persistedDirectiveDefinitionByDirectiveName, this.errors),
      );
    }
    const query = this.parentDefinitionDataByTypeName.get(QUERY);
    if (!query || query.kind !== Kind.OBJECT_TYPE_DEFINITION || query.fieldDataByFieldName.size < 1) {
      this.errors.push(noQueryRootTypeError);
    }
    // return any composition errors before checking whether all fields are resolvable
    if (this.errors.length > 0) {
      return { errors: this.errors };
    }
    // TODO add back resolvability check

    for (const rootTypeName of ROOT_TYPES) {
      const rootTypeData = this.parentDefinitionDataByTypeName.get(rootTypeName);
      if (!rootTypeData || rootTypeData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        continue;
      }
      // After evaluating all of a root type's fields, break and return if there are errors
      if (this.errors.length > 0) {
        break;
      }
      // If a root type field returns a Scalar or Enum, track it so that it is not evaluated it again
      const evaluatedRootScalarsAndEnums = new Set<string>(BASE_SCALARS);
      for (const [rootTypeFieldName, fieldData] of rootTypeData.fieldDataByFieldName) {
        const namedRootFieldTypeName = fieldData.namedTypeName;
        if (evaluatedRootScalarsAndEnums.has(namedRootFieldTypeName)) {
          continue;
        }
        if (!this.shouldEvaluateObjectLike(fieldData.subgraphNames, namedRootFieldTypeName)) {
          continue;
        }
        const namedTypeData = getOrThrowError(
          this.parentDefinitionDataByTypeName,
          namedRootFieldTypeName,
          'parentDefinitionDataByTypeName',
        );
        const fieldPath = `${rootTypeName}.${rootTypeFieldName}`;
        const rootTypeFieldData: RootTypeFieldData = {
          fieldName: rootTypeFieldName,
          fieldTypeNodeString: printTypeNode(fieldData.node.type),
          path: fieldPath,
          typeName: rootTypeName,
          subgraphs: fieldData.subgraphNames,
        };
        switch (namedTypeData.kind) {
          case Kind.ENUM_TYPE_DEFINITION:
          // intentional fallthrough
          case Kind.SCALAR_TYPE_DEFINITION:
            // Root type fields whose response type is an Enums and Scalars will always be resolvable
            // Consequently, subsequent checks can be skipped
            evaluatedRootScalarsAndEnums.add(namedRootFieldTypeName);
            continue;
          case Kind.OBJECT_TYPE_DEFINITION:
            this.evaluateResolvabilityOfObject(
              namedTypeData,
              rootTypeFieldData,
              fieldPath,
              new Set<string>(),
              this.entityContainersByTypeName.has(namedRootFieldTypeName) ? [namedRootFieldTypeName] : [],
            );
            continue;
          case Kind.INTERFACE_TYPE_DEFINITION:
          // intentional fallthrough
          case Kind.UNION_TYPE_DEFINITION:
            this.evaluateResolvabilityOfAbstractType(
              namedRootFieldTypeName,
              namedTypeData.kind,
              rootTypeFieldData,
              fieldPath,
              new Set<string>(),
              this.entityContainersByTypeName.has(namedRootFieldTypeName) ? [namedRootFieldTypeName] : [],
            );
            continue;
          default:
            this.errors.push(unexpectedObjectResponseType(fieldPath, kindToTypeString(namedTypeData.kind)));
        }
      }
    }

    const warnings = this.warnings.length > 0 ? this.warnings : undefined;
    if (this.errors.length > 0) {
      return { errors: this.errors, warnings };
    }
    const newAst: DocumentNode = {
      kind: Kind.DOCUMENT,
      definitions,
    };
    const subgraphConfigBySubgraphName = new Map<string, SubgraphConfig>();
    for (const subgraph of this.internalSubgraphBySubgraphName.values()) {
      subgraphConfigBySubgraphName.set(subgraph.name, {
        configurationDataMap: subgraph.configurationDataMap,
        schema: subgraph.schema,
      });
    }
    for (const authorizationData of this.authorizationDataByParentTypeName.values()) {
      upsertAuthorizationConfiguration(this.fieldConfigurationByFieldPath, authorizationData);
    }

    return {
      federationResult: {
        fieldConfigurations: Array.from(this.fieldConfigurationByFieldPath.values()),
        subgraphConfigBySubgraphName,
        federatedGraphAST: newAst,
        federatedGraphSchema: buildASTSchema(newAst),
      },
      warnings,
    };
  }
}

export function federateSubgraphs(subgraphs: Subgraph[]): FederationResultContainer {
  if (subgraphs.length < 1) {
    return { errors: [minimumSubgraphRequirementError] };
  }
  const {
    authorizationDataByParentTypeName,
    concreteTypeNamesByAbstractTypeName,
    entityContainerByTypeName,
    errors,
    graph,
    internalSubgraphBySubgraphName,
    warnings,
  } = batchNormalize(subgraphs);
  if (errors) {
    return { errors };
  }
  const entityInterfaceFederationDataByTypeName = new Map<string, EntityInterfaceFederationData>();
  const invalidEntityInterfacesByTypeName = new Map<string, InvalidEntityInterface[]>();
  const validEntityInterfaceTypeNames = new Set<string>();
  for (const [subgraphName, internalSubgraph] of internalSubgraphBySubgraphName) {
    for (const [typeName, entityInterfaceData] of internalSubgraph.entityInterfaces) {
      // Always add each entity interface to the invalid entity interfaces map
      // If not, earlier checks would not account for implementations not yet seen
      const invalidEntityInterfaces = getValueOrDefault(invalidEntityInterfacesByTypeName, typeName, () => []);
      invalidEntityInterfaces.push({
        subgraphName,
        concreteTypeNames: entityInterfaceData.concreteTypeNames || new Set<string>(),
      });
      const existingData = entityInterfaceFederationDataByTypeName.get(typeName);
      if (!existingData) {
        validEntityInterfaceTypeNames.add(typeName);
        entityInterfaceFederationDataByTypeName.set(
          typeName,
          newEntityInterfaceFederationData(entityInterfaceData, subgraphName),
        );
        continue;
      }
      const areAnyImplementationsUndefined = upsertEntityInterfaceFederationData(
        existingData,
        entityInterfaceData,
        subgraphName,
      );
      if (areAnyImplementationsUndefined) {
        validEntityInterfaceTypeNames.delete(typeName);
      }
    }
  }

  // Remove the valid entity interfaces type names so only genuinely invalid entity interfaces remain
  for (const typeName of validEntityInterfaceTypeNames) {
    invalidEntityInterfacesByTypeName.delete(typeName);
  }
  if (invalidEntityInterfacesByTypeName.size > 0) {
    return {
      errors: [
        undefinedEntityInterfaceImplementationsError(
          invalidEntityInterfacesByTypeName,
          entityInterfaceFederationDataByTypeName,
        ),
      ],
    };
  }
  return new FederationFactory(
    authorizationDataByParentTypeName,
    concreteTypeNamesByAbstractTypeName,
    entityContainerByTypeName,
    entityInterfaceFederationDataByTypeName,
    graph,
    internalSubgraphBySubgraphName,
    warnings,
  ).federate();
}
