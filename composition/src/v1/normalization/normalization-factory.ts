import {
  ConstDirectiveNode,
  ConstValueNode,
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
  ListValueNode,
  NamedTypeNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  OperationTypeDefinitionNode,
  OperationTypeNode,
  print,
  SchemaDefinitionNode,
  StringValueNode,
  TypeDefinitionNode,
  TypeExtensionNode,
  TypeNode,
} from 'graphql';
import {
  EnumTypeNode,
  extractExecutableDirectiveLocations,
  formatDescription,
  InputObjectTypeNode,
  InterfaceTypeNode,
  nodeKindToDirectiveLocation,
  ObjectTypeNode,
  operationTypeNodeToDefaultType,
  safeParse,
  ScalarTypeNode,
  SchemaNode,
  setToNamedTypeNodeArray,
  UnionTypeNode,
} from '../../ast/utils';
import {
  addFieldNamesToConfigurationData,
  ExtractArgumentDataResult,
  FieldSetData,
  HandleOverrideDirectiveParams,
  HandleRequiresScopesDirectiveParams,
  initializeDirectiveDefinitionDatas,
  InputValidationContainer,
  isNodeQuery,
  KeyFieldSetData,
  validateAndAddConditionalFieldSetsToConfiguration,
  validateArgumentTemplateReferences,
  ValidateDirectiveParams,
  validateKeyFieldSets,
} from './utils';
import {
  ALL_IN_BUILT_DIRECTIVE_NAMES,
  BASE_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME,
  BASE_DIRECTIVE_DEFINITIONS,
  BASE_SCALARS,
  CONFIGURE_CHILD_DESCRIPTIONS_DEFINITION,
  CONFIGURE_DESCRIPTION_DEFINITION,
  EDFS_NATS_STREAM_CONFIGURATION_DEFINITION,
  EVENT_DRIVEN_DIRECTIVE_DEFINITIONS_BY_DIRECTIVE_NAME,
  FIELD_SET_SCALAR_DEFINITION,
  LINK_DEFINITION,
  LINK_IMPORT_DEFINITION,
  LINK_PURPOSE_DEFINITION,
  SCOPE_SCALAR_DEFINITION,
  SUBSCRIPTION_FIELD_CONDITION_DEFINITION,
  SUBSCRIPTION_FILTER_CONDITION_DEFINITION,
  SUBSCRIPTION_FILTER_DEFINITION,
  SUBSCRIPTION_FILTER_VALUE_DEFINITION,
  V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME,
  VERSION_TWO_DIRECTIVE_DEFINITIONS,
} from '../utils/constants';
import {
  addIterableValuesToSet,
  fieldDatasToSimpleFieldDatas,
  generateSimpleDirective,
  getAuthorizationDataToUpdate,
  getEntriesNotInHashSet,
  getOrThrowError,
  getValueOrDefault,
  ImplementationErrors,
  InvalidArgument,
  InvalidFieldImplementation,
  isNodeKindInterface,
  isNodeKindObject,
  kindToConvertedTypeString,
  kindToTypeString,
  mapToArrayOfValues,
  maxOrScopes,
  mergeAuthorizationDataByAND,
  newAuthorizationData,
  numberToOrdinal,
  resetAuthorizationData,
  setAndGetValue,
  subtractSourceSetFromTargetSet,
  upsertAuthorizationData,
  upsertEntityData,
  upsertFieldAuthorizationData,
} from '../utils/utils';
import {
  configureDescriptionNoDescriptionError,
  duplicateArgumentsError,
  duplicateDirectiveArgumentDefinitionsErrorMessage,
  duplicateDirectiveDefinitionArgumentErrorMessage,
  duplicateDirectiveDefinitionError,
  duplicateDirectiveDefinitionLocationErrorMessage,
  duplicateImplementedInterfaceError,
  duplicateOverriddenFieldErrorMessage,
  duplicateOverriddenFieldsError,
  duplicateTypeDefinitionError,
  duplicateUnionMemberDefinitionError,
  equivalentSourceAndTargetOverrideErrorMessage,
  expectedEntityError,
  externalInterfaceFieldsError,
  incompatibleInputValueDefaultValueTypeError,
  invalidArgumentsError,
  invalidArgumentValueErrorMessage,
  invalidDirectiveDefinitionError,
  invalidDirectiveDefinitionLocationErrorMessage,
  invalidDirectiveError,
  invalidDirectiveLocationErrorMessage,
  invalidEdfsDirectiveName,
  invalidEdfsPublishResultObjectErrorMessage,
  invalidEventDirectiveError,
  invalidEventDrivenGraphError,
  invalidEventDrivenMutationResponseTypeErrorMessage,
  invalidEventProviderIdErrorMessage,
  invalidEventSubjectErrorMessage,
  invalidEventSubjectsErrorMessage,
  invalidEventSubjectsItemErrorMessage,
  invalidExternalDirectiveError,
  invalidImplementedTypeError,
  invalidInterfaceImplementationError,
  invalidKeyFieldSetsEventDrivenErrorMessage,
  invalidNatsStreamConfigurationDefinitionErrorMessage,
  invalidNatsStreamInputErrorMessage,
  invalidNatsStreamInputFieldsErrorMessage,
  invalidRepeatedDirectiveErrorMessage,
  invalidRootTypeDefinitionError,
  invalidRootTypeError,
  invalidRootTypeFieldEventsDirectivesErrorMessage,
  invalidRootTypeFieldResponseTypesEventDrivenErrorMessage,
  invalidSubgraphNameErrorMessage,
  invalidSubgraphNamesError,
  invalidSubscriptionFilterLocationError,
  invalidUnionMemberTypeError,
  multipleNamedTypeDefinitionError,
  noBaseScalarDefinitionError,
  noDefinedEnumValuesError,
  noDefinedUnionMembersError,
  noFieldDefinitionsError,
  noInputValueDefinitionsError,
  nonEntityObjectExtensionsEventDrivenErrorMessage,
  nonExternalKeyFieldNamesEventDrivenErrorMessage,
  nonKeyComposingObjectTypeNamesEventDrivenErrorMessage,
  nonKeyFieldNamesEventDrivenErrorMessage,
  operationDefinitionError,
  orScopesLimitError,
  selfImplementationError,
  subgraphInvalidSyntaxError,
  subgraphValidationError,
  subgraphValidationFailureError,
  undefinedDirectiveError,
  undefinedObjectLikeParentError,
  undefinedRequiredArgumentsErrorMessage,
  undefinedTypeError,
  unexpectedDirectiveArgumentErrorMessage,
  unexpectedKindFatalError,
} from '../../errors/errors';
import {
  EVENT_DIRECTIVE_NAMES,
  STREAM_CONFIGURATION_FIELD_NAMES,
  TYPE_SYSTEM_DIRECTIVE_LOCATIONS,
} from '../utils/string-constants';
import { buildASTSchema } from '../../buildASTSchema/buildASTSchema';
import { ConfigurationData, EventConfiguration, NatsEventType } from '../../router-configuration/router-configuration';
import { printTypeNode } from '@graphql-tools/merge';
import { recordSubgraphName } from '../subgraph/subgraph';
import {
  consumerInactiveThresholdInvalidValueWarning,
  externalInterfaceFieldsWarning,
  invalidExternalFieldWarning,
  invalidOverrideTargetSubgraphNameWarning,
  unimplementedInterfaceOutputTypeWarning,
} from '../warnings/warnings';
import {
  consolidateAuthorizationDirectives,
  upsertDirectiveSchemaAndEntityDefinitions,
  upsertParentsAndChildren,
} from './walkers';
import {
  ArgumentData,
  AuthorizationData,
  CompositeOutputData,
  ConditionalFieldData,
  ConfigureDescriptionData,
  EntityData,
  EntityInterfaceSubgraphData,
  EnumDefinitionData,
  EnumValueData,
  ExtensionType,
  FieldAuthorizationData,
  FieldData,
  InputObjectDefinitionData,
  InputValueData,
  InterfaceDefinitionData,
  NodeData,
  ObjectDefinitionData,
  ParentDefinitionData,
  PersistedDirectiveDefinitionData,
  ScalarDefinitionData,
  SchemaData,
  UnionDefinitionData,
} from '../../schema-building/types';
import {
  areDefaultValuesCompatible,
  childMapToValueArray,
  getParentTypeName,
  isNodeExternalOrShareable,
  isTypeRequired,
  isTypeValidImplementation,
  newPersistedDirectivesData,
  removeIgnoredDirectives,
  removeInheritableDirectivesFromObjectParent,
} from '../../schema-building/utils';
import {
  CompositeOutputNode,
  getMutableEnumNode,
  getMutableFieldNode,
  getMutableInputObjectNode,
  getMutableInputValueNode,
  getMutableInterfaceNode,
  getMutableObjectNode,
  getMutableScalarNode,
  getMutableTypeNode,
  getMutableUnionNode,
  getNamedTypeNode,
  getTypeNodeNamedTypeName,
} from '../../schema-building/ast';
import { InvalidRootTypeFieldEventsDirectiveData } from '../../errors/utils';
import { Graph } from '../../resolvability-graph/graph';
import { DEFAULT_CONSUMER_INACTIVE_THRESHOLD } from '../utils/integer-constants';
import { InternalSubgraph, Subgraph } from '../../subgraph/types';
import { Warning } from '../../warnings/warnings';
import { BatchNormalizationResult, NormalizationResult } from '../../normalization/types';
import {
  ARGUMENT,
  AUTHENTICATED,
  BOOLEAN_SCALAR,
  CONFIGURE_CHILD_DESCRIPTIONS,
  CONFIGURE_DESCRIPTION,
  CONSUMER_INACTIVE_THRESHOLD,
  CONSUMER_NAME,
  DEFAULT_EDFS_PROVIDER_ID,
  DESCRIPTION_OVERRIDE,
  EDFS_KAFKA_PUBLISH,
  EDFS_KAFKA_SUBSCRIBE,
  EDFS_NATS_PUBLISH,
  EDFS_NATS_REQUEST,
  EDFS_NATS_STREAM_CONFIGURATION,
  EDFS_NATS_SUBSCRIBE,
  EDFS_PUBLISH_RESULT,
  ENTITIES_FIELD,
  EXECUTABLE_DIRECTIVE_LOCATIONS,
  EXECUTION,
  EXTENDS,
  EXTERNAL,
  FIELD_SET_SCALAR,
  FIELDS,
  FLOAT_SCALAR,
  ID_SCALAR,
  INACCESSIBLE,
  INPUT_FIELD,
  INT_SCALAR,
  KEY,
  LINK,
  LINK_IMPORT,
  LINK_PURPOSE,
  MUTATION,
  NON_NULLABLE_BOOLEAN,
  NON_NULLABLE_EDFS_PUBLISH_EVENT_RESULT,
  NON_NULLABLE_INT,
  NON_NULLABLE_STRING,
  NOT_APPLICABLE,
  OPERATION_TO_DEFAULT,
  OVERRIDE,
  PROPAGATE,
  PROVIDER_ID,
  PROVIDER_TYPE_KAFKA,
  PROVIDER_TYPE_NATS,
  PUBLISH,
  QUERY,
  REQUEST,
  REQUIRES_SCOPES,
  RESOLVABLE,
  ROOT_TYPE_NAMES,
  SCHEMA,
  SCOPE_SCALAR,
  SCOPES,
  SECURITY,
  SERVICE_FIELD,
  SHAREABLE,
  STREAM_CONFIGURATION,
  STREAM_NAME,
  STRING_SCALAR,
  SUBJECT,
  SUBJECTS,
  SUBSCRIBE,
  SUBSCRIPTION,
  SUBSCRIPTION_FIELD_CONDITION,
  SUBSCRIPTION_FILTER,
  SUBSCRIPTION_FILTER_CONDITION,
  SUCCESS,
  TOPIC,
  TOPICS,
} from '../../utils/string-constants';
import { MAX_INT32 } from '../../utils/integer-constants';

export type BatchNormalizationContainer = {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  entityDataByTypeName: Map<string, EntityData>;
  internalSubgraphBySubgraphName: Map<string, InternalSubgraph>;
  internalGraph: Graph;
  warnings: Array<Warning>;
  errors?: Array<Error>;
};

export function normalizeSubgraphFromString(subgraphSDL: string, noLocation = true): NormalizationResult {
  const { error, documentNode } = safeParse(subgraphSDL, noLocation);
  if (error || !documentNode) {
    return { errors: [subgraphInvalidSyntaxError(error)], success: false, warnings: [] };
  }
  const normalizationFactory = new NormalizationFactory(new Graph());
  return normalizationFactory.normalize(documentNode);
}

export function normalizeSubgraph(
  document: DocumentNode,
  subgraphName?: string,
  internalGraph?: Graph,
): NormalizationResult {
  const normalizationFactory = new NormalizationFactory(internalGraph || new Graph(), subgraphName);
  return normalizationFactory.normalize(document);
}

export class NormalizationFactory {
  argumentName = '';
  authorizationDataByParentTypeName = new Map<string, AuthorizationData>();
  childName = '';
  concreteTypeNamesByAbstractTypeName = new Map<string, Set<string>>();
  conditionalFieldDataByCoordinates = new Map<string, ConditionalFieldData>();
  configurationDataByParentTypeName = new Map<string, ConfigurationData>();
  customDirectiveDefinitions = new Map<string, DirectiveDefinitionNode>();
  definedDirectiveNames = new Set<string>();
  directiveDefinitionByDirectiveName = new Map<string, DirectiveDefinitionNode>();
  directiveDefinitionDataByDirectiveName = initializeDirectiveDefinitionDatas();
  edfsDirectiveReferences = new Set<string>();
  errors: Error[] = [];
  entityDataByTypeName = new Map<string, EntityData>();
  entityInterfaceDataByTypeName = new Map<string, EntityInterfaceSubgraphData>();
  eventsConfigurations = new Map<string, EventConfiguration[]>();
  unvalidatedExternalFieldCoords = new Set<string>();
  interfaceTypeNamesWithAuthorizationDirectives = new Set<string>();
  internalGraph: Graph;
  invalidConfigureDescriptionNodeDatas: Array<NodeData> = [];
  invalidRepeatedDirectiveNameByCoords = new Map<string, Set<string>>();
  isCurrentParentExtension = false;
  isParentObjectExternal = false;
  isParentObjectShareable = false;
  isSubgraphEventDrivenGraph = false;
  isSubgraphVersionTwo = false;
  fieldSetDataByTypeName = new Map<string, FieldSetData>();
  heirFieldAuthorizationDataByTypeName = new Map<string, FieldAuthorizationData[]>();
  lastParentNodeKind: Kind = Kind.NULL;
  lastChildNodeKind: Kind = Kind.NULL;
  leafTypeNamesWithAuthorizationDirectives = new Set<string>();
  keyFieldSetDataByTypeName = new Map<string, KeyFieldSetData>();
  keyFieldNamesByParentTypeName = new Map<string, Set<string>>();
  operationTypeNodeByTypeName = new Map<string, OperationTypeNode>();
  originalParentTypeName = '';
  originalTypeNameByRenamedTypeName = new Map<string, string>();
  parentDefinitionDataByTypeName = new Map<string, ParentDefinitionData>();
  parentsWithChildArguments = new Set<string>();
  overridesByTargetSubgraphName = new Map<string, Map<string, Set<string>>>();
  invalidOrScopesHostPaths = new Set<string>();
  schemaData: SchemaData;
  referencedDirectiveNames = new Set<string>();
  referencedTypeNames = new Set<string>();
  renamedParentTypeName = '';
  subgraphName: string;
  usesEdfsNatsStreamConfiguration: boolean = false;
  warnings: Warning[] = [];

  constructor(internalGraph: Graph, subgraphName?: string) {
    for (const [baseDirectiveName, baseDirectiveDefinition] of BASE_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME) {
      this.directiveDefinitionByDirectiveName.set(baseDirectiveName, baseDirectiveDefinition);
    }
    this.subgraphName = subgraphName || NOT_APPLICABLE;
    this.internalGraph = internalGraph;
    this.internalGraph.setSubgraphName(this.subgraphName);
    this.schemaData = {
      directivesByDirectiveName: new Map<string, ConstDirectiveNode[]>(),
      kind: Kind.SCHEMA_DEFINITION,
      name: SCHEMA,
      operationTypes: new Map<OperationTypeNode, OperationTypeDefinitionNode>(),
    };
  }

  validateInputNamedType(namedType: string): InputValidationContainer {
    if (BASE_SCALARS.has(namedType)) {
      return { hasUnhandledError: false, typeString: '' };
    }
    const parentData = this.parentDefinitionDataByTypeName.get(namedType);
    if (!parentData) {
      this.errors.push(undefinedTypeError(namedType));
      return { hasUnhandledError: false, typeString: '' };
    }
    switch (parentData.kind) {
      case Kind.ENUM_TYPE_DEFINITION:
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
      case Kind.SCALAR_TYPE_DEFINITION:
        return { hasUnhandledError: false, typeString: '' };
      default:
        return { hasUnhandledError: true, typeString: kindToTypeString(parentData.kind) };
    }
  }

  validateArguments(fieldData: FieldData, fieldPath: string) {
    const invalidArguments: InvalidArgument[] = [];
    for (const [argumentName, argumentNode] of fieldData.argumentDataByArgumentName) {
      const namedTypeName = getTypeNodeNamedTypeName(argumentNode.type);
      const { hasUnhandledError, typeString } = this.validateInputNamedType(namedTypeName);
      if (hasUnhandledError) {
        invalidArguments.push({
          argumentName,
          namedType: namedTypeName,
          typeString,
          typeName: printTypeNode(argumentNode.type),
        });
      }
    }
    if (invalidArguments.length > 0) {
      this.errors.push(invalidArgumentsError(fieldPath, invalidArguments));
    }
  }

  // Note that directive validation errors are handled elsewhere
  getAuthorizationData(node: InterfaceTypeNode | ObjectTypeNode): AuthorizationData | undefined {
    const parentTypeName = this.renamedParentTypeName || this.originalParentTypeName;
    let authorizationData = this.authorizationDataByParentTypeName.get(parentTypeName);
    resetAuthorizationData(authorizationData);
    if (!node.directives) {
      return authorizationData;
    }
    let requiresAuthentication = false;
    const requiresScopes: ConstDirectiveNode[] = [];
    for (const directiveNode of node.directives) {
      const directiveName = directiveNode.name.value;
      if (directiveName === AUTHENTICATED) {
        // @authenticated is not repeatable
        if (requiresAuthentication) {
          return;
        }
        requiresAuthentication = true;
        continue;
      }
      if (directiveName !== REQUIRES_SCOPES) {
        continue;
      }
      // @requiresScopes is not repeatable
      if (requiresScopes.length > 0) {
        return;
      }
      requiresScopes.push(directiveNode);
    }
    if (!requiresAuthentication && requiresScopes.length < 1) {
      return authorizationData;
    }
    if (isNodeKindInterface(node.kind)) {
      this.interfaceTypeNamesWithAuthorizationDirectives.add(parentTypeName);
    }
    if (!authorizationData) {
      authorizationData = setAndGetValue(
        this.authorizationDataByParentTypeName,
        this.renamedParentTypeName || this.originalParentTypeName,
        newAuthorizationData(parentTypeName),
      );
    }
    authorizationData.hasParentLevelAuthorization = true;
    authorizationData.requiresAuthentication = requiresAuthentication;
    if (requiresScopes.length !== 1) {
      return authorizationData;
    }
    const directiveNode = requiresScopes[0];
    if (!directiveNode.arguments || directiveNode.arguments.length !== 1) {
      return;
    }
    const scopesArgument = directiveNode.arguments[0];
    if (scopesArgument.name.value !== SCOPES || scopesArgument.value.kind !== Kind.LIST) {
      return;
    }
    const orScopes = scopesArgument.value.values;
    if (orScopes.length < 1) {
      return authorizationData;
    }
    if (orScopes.length > maxOrScopes) {
      this.invalidOrScopesHostPaths.add(this.originalParentTypeName);
      return;
    }
    for (const scopes of orScopes) {
      if (scopes.kind !== Kind.LIST) {
        return;
      }
      const andScopes = new Set<string>();
      for (const scope of scopes.values) {
        if (scope.kind !== Kind.STRING) {
          return;
        }
        andScopes.add(scope.value);
      }
      if (andScopes.size) {
        authorizationData.requiredScopes.push(andScopes);
      }
    }
    return authorizationData;
  }

  isTypeNameRootType(typeName: string): boolean {
    return ROOT_TYPE_NAMES.has(typeName) || this.operationTypeNodeByTypeName.has(typeName);
  }

  isArgumentValueValid(typeNode: TypeNode, argumentValue: ConstValueNode): boolean {
    if (argumentValue.kind === Kind.NULL) {
      return typeNode.kind !== Kind.NON_NULL_TYPE;
    }
    switch (typeNode.kind) {
      case Kind.LIST_TYPE: {
        if (argumentValue.kind !== Kind.LIST) {
          // This handles List coercion
          return this.isArgumentValueValid(getNamedTypeNode(typeNode.type), argumentValue);
        }
        for (const value of argumentValue.values) {
          if (!this.isArgumentValueValid(typeNode.type, value)) {
            return false;
          }
        }
        return true;
      }
      case Kind.NAMED_TYPE: {
        switch (typeNode.name.value) {
          case BOOLEAN_SCALAR: {
            return argumentValue.kind === Kind.BOOLEAN;
          }
          case FLOAT_SCALAR: {
            return argumentValue.kind === Kind.FLOAT || argumentValue.kind === Kind.INT;
          }
          case ID_SCALAR: {
            return argumentValue.kind === Kind.STRING || argumentValue.kind === Kind.INT;
          }
          case INT_SCALAR: {
            return argumentValue.kind === Kind.INT;
          }
          case FIELD_SET_SCALAR:
          // intentional fallthrough
          case SCOPE_SCALAR:
          // intentional fallthrough
          case STRING_SCALAR: {
            return argumentValue.kind === Kind.STRING;
          }
          case LINK_IMPORT: {
            return true;
          }
          case LINK_PURPOSE: {
            if (argumentValue.kind !== Kind.ENUM) {
              return false;
            }
            return argumentValue.value === SECURITY || argumentValue.value === EXECUTION;
          }
          case SUBSCRIPTION_FIELD_CONDITION:
          // intentional fallthrough
          case SUBSCRIPTION_FILTER_CONDITION:
            return argumentValue.kind === Kind.OBJECT;
          default: {
            const parentData = this.parentDefinitionDataByTypeName.get(typeNode.name.value);
            if (!parentData) {
              return false;
            }
            if (parentData.kind === Kind.SCALAR_TYPE_DEFINITION) {
              // For now, allow custom scalars to be any value kind.
              return true;
            }
            if (parentData.kind === Kind.ENUM_TYPE_DEFINITION) {
              if (argumentValue.kind !== Kind.ENUM) {
                return false;
              }
              const enumValue = parentData.enumValueDataByValueName.get(argumentValue.value);
              if (!enumValue) {
                return false;
              }
              return !enumValue.directivesByDirectiveName.has(INACCESSIBLE);
            }
            if (parentData.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION) {
              return false;
            }
            // TODO deep comparison
            return argumentValue.kind === Kind.OBJECT;
          }
        }
      }
      default: {
        return this.isArgumentValueValid(typeNode.type, argumentValue);
      }
    }
  }

  addInheritedDirectivesToFieldData(fieldDirectivesByDirectiveName: Map<string, Array<ConstDirectiveNode>>) {
    if (this.isParentObjectShareable) {
      getValueOrDefault(fieldDirectivesByDirectiveName, SHAREABLE, () => [generateSimpleDirective(SHAREABLE)]);
    }
    if (this.isParentObjectExternal) {
      getValueOrDefault(fieldDirectivesByDirectiveName, EXTERNAL, () => [generateSimpleDirective(EXTERNAL)]);
    }
    return fieldDirectivesByDirectiveName;
  }

  extractDirectives(
    node:
      | TypeDefinitionNode
      | TypeExtensionNode
      | FieldDefinitionNode
      | InputValueDefinitionNode
      | EnumValueDefinitionNode
      | SchemaNode,
    directivesByDirectiveName: Map<string, Array<ConstDirectiveNode>>,
  ) {
    if (!node.directives) {
      return directivesByDirectiveName;
    }
    for (const directiveNode of node.directives) {
      const directiveName = directiveNode.name.value;
      // Don't create pointless repetitions of @shareable
      if (directiveName === SHAREABLE) {
        getValueOrDefault(directivesByDirectiveName, directiveName, () => [directiveNode]);
      } else {
        getValueOrDefault(directivesByDirectiveName, directiveName, () => []).push(directiveNode);
      }
      if (!isNodeKindObject(node.kind)) {
        continue;
      }
      this.isParentObjectExternal ||= directiveName === EXTERNAL;
      this.isParentObjectShareable ||= directiveName === SHAREABLE;
    }
    return directivesByDirectiveName;
  }

  validateDirective({
    data,
    definitionData,
    directiveCoords,
    directiveNode,
    errorMessages,
    requiredArgumentNames,
  }: ValidateDirectiveParams): Array<string> {
    const directiveName = directiveNode.name.value;
    const parentTypeName =
      data.kind === Kind.FIELD_DEFINITION ? data.renamedParentTypeName || data.originalParentTypeName : data.name;
    const isAuthenticated = directiveName === AUTHENTICATED;
    const isOverride = directiveName === OVERRIDE;
    const isRequiresScopes = directiveName === REQUIRES_SCOPES;
    if (!directiveNode.arguments || directiveNode.arguments.length < 1) {
      if (definitionData.requiredArgumentNames.size > 0) {
        errorMessages.push(undefinedRequiredArgumentsErrorMessage(directiveName, requiredArgumentNames, []));
      }
      if (isAuthenticated) {
        this.handleAuthenticatedDirective(data, parentTypeName);
      }
      return errorMessages;
    }
    const definedArgumentNames = new Set<string>();
    const duplicateArgumentNames = new Set<string>();
    const unexpectedArgumentNames = new Set<string>();
    const requiredScopes: Array<Set<string>> = [];
    for (const argumentNode of directiveNode.arguments) {
      const argumentName = argumentNode.name.value;
      if (definedArgumentNames.has(argumentName)) {
        duplicateArgumentNames.add(argumentName);
        continue;
      }
      definedArgumentNames.add(argumentName);
      const argumentData = definitionData.argumentTypeNodeByArgumentName.get(argumentName);
      if (!argumentData) {
        unexpectedArgumentNames.add(argumentName);
        continue;
      }
      if (!this.isArgumentValueValid(argumentData.typeNode, argumentNode.value)) {
        errorMessages.push(
          invalidArgumentValueErrorMessage(
            print(argumentNode.value),
            `@${directiveName}`,
            argumentName,
            printTypeNode(argumentData.typeNode),
          ),
        );
        continue;
      }
      // The directive location validation means the kind check should be unnecessary
      if (isOverride && data.kind === Kind.FIELD_DEFINITION) {
        this.handleOverrideDirective({
          data,
          directiveCoords,
          errorMessages,
          targetSubgraphName: (argumentNode.value as StringValueNode).value,
        });
        continue;
      }
      if (!isRequiresScopes || argumentName !== SCOPES) {
        continue;
      }
      this.handleRequiresScopesDirective({
        directiveCoords,
        // Casts are safe because invalid arguments would short circuit
        orScopes: (argumentNode.value as ListValueNode).values,
        requiredScopes,
      });
    }
    if (duplicateArgumentNames.size > 0) {
      errorMessages.push(duplicateDirectiveArgumentDefinitionsErrorMessage([...duplicateArgumentNames]));
    }
    if (unexpectedArgumentNames.size > 0) {
      errorMessages.push(unexpectedDirectiveArgumentErrorMessage(directiveName, [...unexpectedArgumentNames]));
    }
    const undefinedArgumentNames = getEntriesNotInHashSet(requiredArgumentNames, definedArgumentNames);
    if (undefinedArgumentNames.length > 0) {
      errorMessages.push(
        undefinedRequiredArgumentsErrorMessage(directiveName, requiredArgumentNames, undefinedArgumentNames),
      );
    }
    if (errorMessages.length > 0 || !isRequiresScopes) {
      return errorMessages;
    }
    if (
      data.kind !== Kind.ENUM_TYPE_DEFINITION &&
      data.kind !== Kind.FIELD_DEFINITION &&
      data.kind !== Kind.SCALAR_TYPE_DEFINITION
    ) {
      return errorMessages;
    }
    if (data.kind !== Kind.FIELD_DEFINITION) {
      this.leafTypeNamesWithAuthorizationDirectives.add(parentTypeName);
    }
    const parentAuthorizationData = getValueOrDefault(this.authorizationDataByParentTypeName, parentTypeName, () =>
      newAuthorizationData(parentTypeName),
    );
    const authorizationData = getAuthorizationDataToUpdate(parentAuthorizationData, data.node);
    authorizationData.requiredScopes.push(...requiredScopes);
    return errorMessages;
  }

  validateDirectives(data: NodeData | SchemaData, directiveCoords: string) {
    const undefinedDirectiveNames = new Set<string>();
    for (const [directiveName, directiveNodes] of data.directivesByDirectiveName) {
      const definitionData = this.directiveDefinitionDataByDirectiveName.get(directiveName);
      if (!definitionData) {
        if (!undefinedDirectiveNames.has(directiveName)) {
          this.errors.push(undefinedDirectiveError(directiveName, directiveCoords));
          undefinedDirectiveNames.add(directiveName);
        }
        continue;
      }
      const definitionErrorMessages: Array<string> = [];
      const directiveLocation = nodeKindToDirectiveLocation(data.kind);
      if (!definitionData.locations.has(directiveLocation)) {
        definitionErrorMessages.push(invalidDirectiveLocationErrorMessage(directiveName, directiveLocation));
      }
      if (directiveNodes.length > 1 && !definitionData.isRepeatable) {
        const handledDirectiveNames = getValueOrDefault(
          this.invalidRepeatedDirectiveNameByCoords,
          directiveCoords,
          () => new Set<string>(),
        );
        if (!handledDirectiveNames.has(directiveName)) {
          handledDirectiveNames.add(directiveName);
          definitionErrorMessages.push(invalidRepeatedDirectiveErrorMessage(directiveName));
        }
      }
      const requiredArgumentNames = [...definitionData.requiredArgumentNames];
      for (let i = 0; i < directiveNodes.length; i++) {
        const errorMessages = this.validateDirective({
          data,
          directiveNode: directiveNodes[i],
          definitionData,
          directiveCoords,
          errorMessages: i < 1 ? definitionErrorMessages : [],
          requiredArgumentNames,
        });
        if (errorMessages.length > 0) {
          this.errors.push(
            invalidDirectiveError(directiveName, directiveCoords, numberToOrdinal(i + 1), errorMessages),
          );
        }
      }
    }
    switch (data.kind) {
      case Kind.ENUM_TYPE_DEFINITION: {
        for (const [enumValueName, enumValueData] of data.enumValueDataByValueName) {
          this.validateDirectives(enumValueData, `${data.name}.${enumValueName}`);
        }
        return;
      }
      case Kind.FIELD_DEFINITION: {
        for (const [argumentName, argumentData] of data.argumentDataByArgumentName) {
          this.validateDirectives(argumentData, `${data.originalParentTypeName}.${data.name}(${argumentName}: ...)`);
        }
        return;
      }
      case Kind.INPUT_OBJECT_TYPE_DEFINITION: {
        for (const [inputValueName, inputValueData] of data.inputValueDataByValueName) {
          this.validateDirectives(inputValueData, `${data.name}.${inputValueName}`);
        }
        return;
      }
      case Kind.INTERFACE_TYPE_DEFINITION:
      // intentional fallthrough
      case Kind.OBJECT_TYPE_DEFINITION: {
        for (const [fieldName, fieldData] of data.fieldDataByFieldName) {
          this.validateDirectives(fieldData, `${data.name}.${fieldName}`);
        }
        return;
      }
      default:
        return;
    }
  }

  /* ExtensionType uses a trichotomy rather than a boolean because @extends is still a definition.
   * A definition and another definition with @extends would still be an error, so it cannot be treated
   * as a regular extension.
   * V1 definitions with @extends need a base type.
   */
  getNodeExtensionType(
    isRealExtension: boolean,
    directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
    isRootType = false,
  ): ExtensionType {
    // If the extend keyword is present, it's simply an extension
    if (isRealExtension) {
      return ExtensionType.REAL;
    }
    /*
     * @extends is not interpreted as an extension under the following circumstances:
     * 1. It's a root type
     * 2. It's a V2 subgraph
     * 3. And (of course) if @extends isn't defined at all
     */
    if (isRootType || this.isSubgraphVersionTwo || !directivesByDirectiveName.has(EXTENDS)) {
      return ExtensionType.NONE;
    }
    // If it's a V1 subgraph and defines @extends, it is considered an extension across subgraphs
    return ExtensionType.EXTENDS;
  }

  setParentDataExtensionType(parentData: ParentDefinitionData, incomingExtensionType: ExtensionType) {
    switch (parentData.extensionType) {
      case ExtensionType.EXTENDS:
      // intentional fallthrough
      case ExtensionType.NONE: {
        if (incomingExtensionType === ExtensionType.REAL) {
          return;
        }
        this.errors.push(duplicateTypeDefinitionError(kindToTypeString(parentData.kind), parentData.name));
        return;
      }
      default: {
        parentData.extensionType = incomingExtensionType;
      }
    }
  }

  extractConfigureDescriptionData(data: NodeData, directiveNode: ConstDirectiveNode) {
    if (!directiveNode.arguments || directiveNode.arguments.length < 1) {
      if (!data.description) {
        this.invalidConfigureDescriptionNodeDatas.push(data);
      }
      data.configureDescriptionDataBySubgraphName.set(this.subgraphName, {
        propagate: true,
        description: data.description?.value || '',
      });
      return;
    }
    const configureDescriptionData: ConfigureDescriptionData = {
      propagate: true,
      description: data.description?.value || '',
    };
    for (const argument of directiveNode.arguments) {
      switch (argument.name.value) {
        case PROPAGATE: {
          if (argument.value.kind != Kind.BOOLEAN) {
            return;
          }
          configureDescriptionData.propagate = argument.value.value;
          break;
        }
        case DESCRIPTION_OVERRIDE: {
          if (argument.value.kind != Kind.STRING) {
            return;
          }
          configureDescriptionData.description = argument.value.value;
          break;
        }
        default: {
          return;
        }
      }
    }
    if (!data.description && !configureDescriptionData.description) {
      this.invalidConfigureDescriptionNodeDatas.push(data);
    }
    data.configureDescriptionDataBySubgraphName.set(this.subgraphName, configureDescriptionData);
  }

  extractConfigureDescriptionsData(data: NodeData) {
    const configureDescriptionNodes = data.directivesByDirectiveName.get(CONFIGURE_DESCRIPTION);
    if (configureDescriptionNodes && configureDescriptionNodes.length == 1) {
      this.extractConfigureDescriptionData(data, configureDescriptionNodes[0]);
    }
    // TODO configureChildDescriptions will be added in another PR
    // const configureChildDescriptionsNodes = data.directivesByDirectiveName.get(CONFIGURE_CHILD_DESCRIPTIONS);
    // if (configureChildDescriptionsNodes && configureChildDescriptionsNodes.length == 1) {
    // }
  }

  extractImplementedInterfaceTypeNames(
    node: InterfaceTypeDefinitionNode | InterfaceTypeExtensionNode | ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
    implementedInterfaceTypeNames: Set<string>,
  ): Set<string> {
    if (!node.interfaces) {
      return implementedInterfaceTypeNames;
    }
    const parentTypeName = node.name.value;
    for (const implementedInterface of node.interfaces) {
      const interfaceTypeName = implementedInterface.name.value;
      if (implementedInterfaceTypeNames.has(interfaceTypeName)) {
        this.errors.push(
          duplicateImplementedInterfaceError(kindToConvertedTypeString(node.kind), parentTypeName, interfaceTypeName),
        );
        continue;
      }
      implementedInterfaceTypeNames.add(interfaceTypeName);
    }
    return implementedInterfaceTypeNames;
  }

  updateCompositeOutputDataByNode(node: CompositeOutputNode, data: CompositeOutputData, extensionType: ExtensionType) {
    this.setParentDataExtensionType(data, extensionType);
    this.extractImplementedInterfaceTypeNames(node, data.implementedInterfaceTypeNames);
    data.description ||= formatDescription('description' in node ? node.description : undefined);
    this.extractConfigureDescriptionsData(data);
    data.isEntity ||= data.directivesByDirectiveName.has(KEY);
    data.isInaccessible ||= data.directivesByDirectiveName.has(INACCESSIBLE);
    data.subgraphNames.add(this.subgraphName);
  }

  addConcreteTypeNamesForImplementedInterfaces(interfaceTypeNames: Set<string>, concreteTypeName: string) {
    for (const interfaceName of interfaceTypeNames) {
      getValueOrDefault(this.concreteTypeNamesByAbstractTypeName, interfaceName, () => new Set<string>()).add(
        concreteTypeName,
      );
      this.internalGraph.addEdge(
        this.internalGraph.addOrUpdateNode(interfaceName, { isAbstract: true }),
        this.internalGraph.addOrUpdateNode(concreteTypeName),
        concreteTypeName,
        true,
      );
    }
  }

  extractArguments(
    argumentDataByArgumentName: Map<string, InputValueData>,
    node: FieldDefinitionNode,
  ): Map<string, InputValueData> {
    if (!node.arguments?.length) {
      return argumentDataByArgumentName;
    }
    const fieldName = node.name.value;
    const originalFieldPath = `${this.originalParentTypeName}.${fieldName}`;
    const renamedFieldPath = `${this.renamedParentTypeName}.${fieldName}`;
    this.parentsWithChildArguments.add(this.originalParentTypeName);
    const duplicatedArguments = new Set<string>();
    for (const argumentNode of node.arguments) {
      const argumentName = argumentNode.name.value;
      if (argumentDataByArgumentName.has(argumentName)) {
        duplicatedArguments.add(argumentName);
        continue;
      }
      this.addInputValueDataByNode(
        argumentDataByArgumentName,
        argumentNode,
        `${originalFieldPath}(${argumentName}: ...)`,
        `${renamedFieldPath}(${argumentName}: ...)`,
      );
    }
    if (duplicatedArguments.size > 0) {
      this.errors.push(duplicateArgumentsError(originalFieldPath, [...duplicatedArguments]));
    }
    return argumentDataByArgumentName;
  }

  addPersistedDirectiveDefinitionDataByNode(
    persistedDirectiveDefinitionDataByDirectiveName: Map<string, PersistedDirectiveDefinitionData>,
    node: DirectiveDefinitionNode,
    executableLocations: Set<string>,
  ) {
    const name = node.name.value;
    const argumentDataByArgumentName = new Map<string, InputValueData>();
    for (const argumentNode of node.arguments || []) {
      const originalPath = `@${name}(${argumentNode.name.value}: ...)`;
      this.addInputValueDataByNode(argumentDataByArgumentName, argumentNode, originalPath, originalPath);
    }
    persistedDirectiveDefinitionDataByDirectiveName.set(name, {
      argumentDataByArgumentName,
      executableLocations,
      name,
      repeatable: node.repeatable,
      subgraphNames: new Set<string>([this.subgraphName]),
      description: formatDescription(node.description),
    });
  }

  extractDirectiveLocations(node: DirectiveDefinitionNode, errorMessages: Array<string>): Set<string> {
    const locations = new Set<string>();
    const handledLocations = new Set<string>();
    for (const locationNode of node.locations) {
      const locationName = locationNode.value;
      if (handledLocations.has(locationName)) {
        continue;
      }
      if (!EXECUTABLE_DIRECTIVE_LOCATIONS.has(locationName) && !TYPE_SYSTEM_DIRECTIVE_LOCATIONS.has(locationName)) {
        errorMessages.push(invalidDirectiveDefinitionLocationErrorMessage(locationName));
        handledLocations.add(locationName);
        continue;
      }
      if (locations.has(locationName)) {
        errorMessages.push(duplicateDirectiveDefinitionLocationErrorMessage(locationName));
        handledLocations.add(locationName);
        continue;
      }
      locations.add(locationName);
    }
    return locations;
  }

  extractArgumentData(
    argumentNodes: ReadonlyArray<InputValueDefinitionNode> | Array<InputValueDefinitionNode> | undefined,
    errorMessages: Array<string>,
  ): ExtractArgumentDataResult {
    const argumentTypeNodeByArgumentName = new Map<string, ArgumentData>();
    const optionalArgumentNames = new Set<string>();
    const requiredArgumentNames = new Set<string>();
    const output = {
      argumentTypeNodeByArgumentName,
      optionalArgumentNames,
      requiredArgumentNames,
    };
    if (!argumentNodes) {
      return output;
    }
    const duplicateArgumentNames = new Set<string>();
    for (const argumentNode of argumentNodes) {
      const name = argumentNode.name.value;
      if (argumentTypeNodeByArgumentName.has(name)) {
        duplicateArgumentNames.add(name);
        continue;
      }
      if (argumentNode.defaultValue) {
        optionalArgumentNames.add(name);
      }
      if (isTypeRequired(argumentNode.type) && !argumentNode.defaultValue) {
        requiredArgumentNames.add(name);
      }
      argumentTypeNodeByArgumentName.set(name, {
        name,
        typeNode: argumentNode.type,
        defaultValue: argumentNode.defaultValue,
      });
    }
    if (duplicateArgumentNames.size > 0) {
      errorMessages.push(duplicateDirectiveDefinitionArgumentErrorMessage([...duplicateArgumentNames]));
    }
    return output;
  }

  // returns true if the directive is custom; otherwise, false
  addDirectiveDefinitionDataByNode(node: DirectiveDefinitionNode): boolean {
    const name = node.name.value;
    if (this.definedDirectiveNames.has(name)) {
      this.errors.push(duplicateDirectiveDefinitionError(name));
      return false;
    }
    this.definedDirectiveNames.add(name);
    this.directiveDefinitionByDirectiveName.set(name, node);
    // Normalize federation directives by replacing them with predefined definitions
    if (V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME.has(name)) {
      this.isSubgraphVersionTwo = true;
      return false;
    }
    if (ALL_IN_BUILT_DIRECTIVE_NAMES.has(name)) {
      return false;
    }
    const errorMessages: Array<string> = [];
    const { argumentTypeNodeByArgumentName, optionalArgumentNames, requiredArgumentNames } = this.extractArgumentData(
      node.arguments,
      errorMessages,
    );
    this.directiveDefinitionDataByDirectiveName.set(name, {
      argumentTypeNodeByArgumentName,
      isRepeatable: node.repeatable,
      locations: this.extractDirectiveLocations(node, errorMessages),
      name,
      node,
      optionalArgumentNames,
      requiredArgumentNames,
    });
    if (errorMessages.length > 0) {
      this.errors.push(invalidDirectiveDefinitionError(name, errorMessages));
    }
    return true;
  }

  addFieldDataByNode(
    fieldDataByFieldName: Map<string, FieldData>,
    node: FieldDefinitionNode,
    argumentDataByArgumentName: Map<string, InputValueData>,
    directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
  ): FieldData {
    const name = node.name.value;
    const fieldPath = `${this.originalParentTypeName}.${name}`;
    const isNodeExternalOrShareableResult = isNodeExternalOrShareable(
      node,
      !this.isSubgraphVersionTwo,
      directivesByDirectiveName,
    );
    const fieldData: FieldData = {
      argumentDataByArgumentName: argumentDataByArgumentName,
      configureDescriptionDataBySubgraphName: new Map<string, ConfigureDescriptionData>(),
      isExternalBySubgraphName: new Map<string, boolean>([
        [this.subgraphName, isNodeExternalOrShareableResult.isExternal],
      ]),
      isInaccessible: directivesByDirectiveName.has(INACCESSIBLE),
      isShareableBySubgraphName: new Map<string, boolean>([
        [this.subgraphName, isNodeExternalOrShareableResult.isShareable],
      ]),
      kind: Kind.FIELD_DEFINITION,
      name,
      namedTypeName: getTypeNodeNamedTypeName(node.type),
      node: getMutableFieldNode(node, fieldPath, this.errors),
      originalParentTypeName: this.originalParentTypeName,
      persistedDirectivesData: newPersistedDirectivesData(),
      renamedParentTypeName: this.renamedParentTypeName || this.originalParentTypeName,
      subgraphNames: new Set<string>([this.subgraphName]),
      type: getMutableTypeNode(node.type, fieldPath, this.errors),
      directivesByDirectiveName,
      description: formatDescription(node.description),
    };
    this.extractConfigureDescriptionsData(fieldData);
    fieldDataByFieldName.set(name, fieldData);
    return fieldData;
  }

  addInputValueDataByNode(
    inputValueDataByValueName: Map<string, InputValueData>,
    node: InputValueDefinitionNode,
    originalPath: string,
    renamedPath?: string,
  ) {
    const name = node.name.value;
    // Only arguments have renamed paths
    const isArgument = !!renamedPath;
    if (node.defaultValue && !areDefaultValuesCompatible(node.type, node.defaultValue)) {
      this.errors.push(
        incompatibleInputValueDefaultValueTypeError(
          (isArgument ? ARGUMENT : INPUT_FIELD) + ` "${name}"`,
          originalPath,
          printTypeNode(node.type),
          print(node.defaultValue),
        ),
      );
    }
    const inputValueData: InputValueData = {
      configureDescriptionDataBySubgraphName: new Map<string, ConfigureDescriptionData>(),
      directivesByDirectiveName: this.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
      includeDefaultValue: !!node.defaultValue,
      isArgument,
      kind: isArgument ? Kind.ARGUMENT : Kind.INPUT_VALUE_DEFINITION,
      name,
      node: getMutableInputValueNode(node, originalPath, this.errors),
      originalPath,
      persistedDirectivesData: newPersistedDirectivesData(),
      renamedPath: renamedPath || originalPath,
      requiredSubgraphNames: new Set<string>(isTypeRequired(node.type) ? [this.subgraphName] : []),
      subgraphNames: new Set<string>([this.subgraphName]),
      type: getMutableTypeNode(node.type, originalPath, this.errors),
      defaultValue: node.defaultValue, // TODO validate
      description: formatDescription(node.description),
    };
    this.extractConfigureDescriptionsData(inputValueData);
    inputValueDataByValueName.set(name, inputValueData);
  }

  upsertInterfaceDataByNode(node: InterfaceTypeNode, isRealExtension: boolean = false) {
    const typeName = node.name.value;
    const parentData = this.parentDefinitionDataByTypeName.get(typeName);
    const directivesByDirectiveName = this.extractDirectives(
      node,
      parentData?.directivesByDirectiveName || new Map<string, ConstDirectiveNode[]>(),
    );
    const extensionType = this.getNodeExtensionType(isRealExtension, directivesByDirectiveName);
    const entityInterfaceData = this.entityInterfaceDataByTypeName.get(typeName);
    if (entityInterfaceData && node.fields) {
      for (const fieldNode of node.fields) {
        entityInterfaceData.interfaceFieldNames.add(fieldNode.name.value);
      }
    }
    if (parentData) {
      if (parentData.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        this.errors.push(
          multipleNamedTypeDefinitionError(
            typeName,
            kindToTypeString(parentData.kind),
            kindToConvertedTypeString(node.kind),
          ),
        );
        return;
      }
      this.updateCompositeOutputDataByNode(node, parentData, extensionType);
      return;
    }
    const newParentData: InterfaceDefinitionData = {
      configureDescriptionDataBySubgraphName: new Map<string, ConfigureDescriptionData>(),
      directivesByDirectiveName,
      extensionType,
      fieldDataByFieldName: new Map<string, FieldData>(),
      implementedInterfaceTypeNames: this.extractImplementedInterfaceTypeNames(node, new Set<string>()),
      isEntity: directivesByDirectiveName.has(KEY),
      isInaccessible: directivesByDirectiveName.has(INACCESSIBLE),
      kind: Kind.INTERFACE_TYPE_DEFINITION,
      name: typeName,
      node: getMutableInterfaceNode(node.name),
      persistedDirectivesData: newPersistedDirectivesData(),
      subgraphNames: new Set<string>([this.subgraphName]),
      description: formatDescription('description' in node ? node.description : undefined),
    };
    this.extractConfigureDescriptionsData(newParentData);
    this.parentDefinitionDataByTypeName.set(typeName, newParentData);
  }

  getRenamedRootTypeName(typeName: string) {
    const operationTypeNode = this.operationTypeNodeByTypeName.get(typeName);
    if (!operationTypeNode) {
      return typeName;
    }
    switch (operationTypeNode) {
      case OperationTypeNode.MUTATION:
        return MUTATION;
      case OperationTypeNode.SUBSCRIPTION:
        return SUBSCRIPTION;
      default:
        return QUERY;
    }
  }

  addInterfaceObjectFieldsByNode(node: ObjectTypeNode) {
    const typeName = node.name.value;
    const entityInterfaceData = this.entityInterfaceDataByTypeName.get(typeName);
    if (!entityInterfaceData || !entityInterfaceData.isInterfaceObject || !node.fields) {
      return;
    }
    for (const fieldNode of node.fields) {
      entityInterfaceData.interfaceObjectFieldNames.add(fieldNode.name.value);
    }
  }

  upsertObjectDataByNode(node: ObjectTypeNode, isRealExtension: boolean = false) {
    const typeName = node.name.value;
    const parentData = this.parentDefinitionDataByTypeName.get(typeName);
    const directivesByDirectiveName = this.extractDirectives(
      node,
      parentData?.directivesByDirectiveName || new Map<string, ConstDirectiveNode[]>(),
    );
    const isRootType = this.isTypeNameRootType(typeName);
    const extensionType = this.getNodeExtensionType(isRealExtension, directivesByDirectiveName, isRootType);
    this.addInterfaceObjectFieldsByNode(node);
    if (parentData) {
      if (parentData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        this.errors.push(
          multipleNamedTypeDefinitionError(
            typeName,
            kindToTypeString(parentData.kind),
            kindToConvertedTypeString(node.kind),
          ),
        );
        return;
      }
      this.updateCompositeOutputDataByNode(node, parentData, extensionType);
      this.addConcreteTypeNamesForImplementedInterfaces(parentData.implementedInterfaceTypeNames, typeName);
      return;
    }
    const implementedInterfaceTypeNames = this.extractImplementedInterfaceTypeNames(node, new Set<string>());
    this.addConcreteTypeNamesForImplementedInterfaces(implementedInterfaceTypeNames, typeName);
    const newParentData: ObjectDefinitionData = {
      configureDescriptionDataBySubgraphName: new Map<string, ConfigureDescriptionData>(),
      directivesByDirectiveName,
      extensionType,
      fieldDataByFieldName: new Map<string, FieldData>(),
      implementedInterfaceTypeNames,
      isEntity: directivesByDirectiveName.has(KEY),
      isInaccessible: directivesByDirectiveName.has(INACCESSIBLE),
      isRootType,
      kind: Kind.OBJECT_TYPE_DEFINITION,
      name: typeName,
      node: getMutableObjectNode(node.name),
      persistedDirectivesData: newPersistedDirectivesData(),
      renamedTypeName: this.getRenamedRootTypeName(typeName),
      subgraphNames: new Set<string>([this.subgraphName]),
      description: formatDescription('description' in node ? node.description : undefined),
    };
    this.extractConfigureDescriptionsData(newParentData);
    this.parentDefinitionDataByTypeName.set(typeName, newParentData);
  }

  upsertEnumDataByNode(node: EnumTypeNode, isRealExtension: boolean = false) {
    const typeName = node.name.value;
    this.internalGraph.addOrUpdateNode(typeName, { isLeaf: true });
    const parentData = this.parentDefinitionDataByTypeName.get(typeName);
    const directivesByDirectiveName = this.extractDirectives(
      node,
      parentData?.directivesByDirectiveName || new Map<string, ConstDirectiveNode[]>(),
    );
    const extensionType = this.getNodeExtensionType(isRealExtension, directivesByDirectiveName);
    if (parentData) {
      if (parentData.kind !== Kind.ENUM_TYPE_DEFINITION) {
        this.errors.push(
          multipleNamedTypeDefinitionError(
            typeName,
            kindToTypeString(parentData.kind),
            kindToConvertedTypeString(node.kind),
          ),
        );
        return;
      }
      this.setParentDataExtensionType(parentData, extensionType);
      parentData.subgraphNames.add(this.subgraphName);
      parentData.description ||= formatDescription('description' in node ? node.description : undefined);
      this.extractConfigureDescriptionsData(parentData);
      return;
    }
    const newParentData: EnumDefinitionData = {
      appearances: 1,
      configureDescriptionDataBySubgraphName: new Map<string, ConfigureDescriptionData>(),
      directivesByDirectiveName,
      extensionType,
      enumValueDataByValueName: new Map<string, EnumValueData>(),
      kind: Kind.ENUM_TYPE_DEFINITION,
      name: typeName,
      node: getMutableEnumNode(node.name),
      persistedDirectivesData: newPersistedDirectivesData(),
      subgraphNames: new Set([this.subgraphName]),
      description: formatDescription('description' in node ? node.description : undefined),
    };
    this.extractConfigureDescriptionsData(newParentData);
    this.parentDefinitionDataByTypeName.set(typeName, newParentData);
  }

  upsertInputObjectByNode(node: InputObjectTypeNode, isRealExtension: boolean = false) {
    const typeName = node.name.value;
    const parentData = this.parentDefinitionDataByTypeName.get(typeName);
    const directivesByDirectiveName = this.extractDirectives(
      node,
      parentData?.directivesByDirectiveName || new Map<string, ConstDirectiveNode[]>(),
    );
    const extensionType = this.getNodeExtensionType(isRealExtension, directivesByDirectiveName);
    if (parentData) {
      if (parentData.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION) {
        this.errors.push(
          multipleNamedTypeDefinitionError(
            typeName,
            kindToTypeString(parentData.kind),
            kindToConvertedTypeString(node.kind),
          ),
        );
        return;
      }
      this.setParentDataExtensionType(parentData, extensionType);
      parentData.isInaccessible ||= directivesByDirectiveName.has(INACCESSIBLE);
      parentData.subgraphNames.add(this.subgraphName);
      parentData.description ||= formatDescription('description' in node ? node.description : undefined);
      this.extractConfigureDescriptionsData(parentData);
      return;
    }
    const newParentData: InputObjectDefinitionData = {
      configureDescriptionDataBySubgraphName: new Map<string, ConfigureDescriptionData>(),
      directivesByDirectiveName,
      extensionType,
      inputValueDataByValueName: new Map<string, InputValueData>(),
      isInaccessible: directivesByDirectiveName.has(INACCESSIBLE),
      kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
      name: typeName,
      node: getMutableInputObjectNode(node.name),
      persistedDirectivesData: newPersistedDirectivesData(),
      subgraphNames: new Set<string>([this.subgraphName]),
      description: formatDescription('description' in node ? node.description : undefined),
    };
    this.extractConfigureDescriptionsData(newParentData);
    this.parentDefinitionDataByTypeName.set(typeName, newParentData);
  }

  upsertScalarByNode(node: ScalarTypeNode, isRealExtension: boolean = false) {
    const typeName = node.name.value;
    this.internalGraph.addOrUpdateNode(typeName, { isLeaf: true });
    const parentData = this.parentDefinitionDataByTypeName.get(typeName);
    const directivesByDirectiveName = this.extractDirectives(
      node,
      parentData?.directivesByDirectiveName || new Map<string, ConstDirectiveNode[]>(),
    );
    const extensionType = this.getNodeExtensionType(isRealExtension, directivesByDirectiveName);
    if (parentData) {
      if (parentData.kind !== Kind.SCALAR_TYPE_DEFINITION) {
        this.errors.push(
          multipleNamedTypeDefinitionError(
            typeName,
            kindToTypeString(parentData.kind),
            kindToConvertedTypeString(node.kind),
          ),
        );
        return;
      }
      this.setParentDataExtensionType(parentData, extensionType);
      parentData.description ||= formatDescription('description' in node ? node.description : undefined);
      this.extractConfigureDescriptionsData(parentData);
      return;
    }
    const newParentData: ScalarDefinitionData = {
      configureDescriptionDataBySubgraphName: new Map<string, ConfigureDescriptionData>(),
      directivesByDirectiveName,
      extensionType,
      kind: Kind.SCALAR_TYPE_DEFINITION,
      name: typeName,
      node: getMutableScalarNode(node.name),
      persistedDirectivesData: newPersistedDirectivesData(),
      description: formatDescription('description' in node ? node.description : undefined),
    };
    this.extractConfigureDescriptionsData(newParentData);
    this.parentDefinitionDataByTypeName.set(typeName, newParentData);
  }

  extractUnionMembers(
    node: UnionTypeNode,
    membersByMemberTypeName: Map<string, NamedTypeNode>,
  ): Map<string, NamedTypeNode> {
    if (!node.types) {
      return membersByMemberTypeName;
    }
    const unionTypeName = node.name.value;
    for (const member of node.types) {
      const memberTypeName = member.name.value;
      if (membersByMemberTypeName.has(memberTypeName)) {
        this.errors.push(duplicateUnionMemberDefinitionError(unionTypeName, memberTypeName));
        continue;
      }
      getValueOrDefault(this.concreteTypeNamesByAbstractTypeName, unionTypeName, () => new Set<string>()).add(
        memberTypeName,
      );
      /*
       * Scalars are never valid Union member types.
       * However, base scalars are not upserted to the type definition data.
       * Consequently, reference checks would yield unknown type errors in addition to invalid member errors.
       * This check prevents error doubling were a Union member a base Scalar.
       * */
      if (!BASE_SCALARS.has(memberTypeName)) {
        this.referencedTypeNames.add(memberTypeName);
      }
      membersByMemberTypeName.set(memberTypeName, member);
    }
    return membersByMemberTypeName;
  }

  upsertUnionByNode(node: UnionTypeNode, isRealExtension: boolean = false) {
    const typeName = node.name.value;
    const parentData = this.parentDefinitionDataByTypeName.get(typeName);
    const directivesByDirectiveName = this.extractDirectives(
      node,
      parentData?.directivesByDirectiveName || new Map<string, ConstDirectiveNode[]>(),
    );
    const extensionType = this.getNodeExtensionType(isRealExtension, directivesByDirectiveName);
    // Also adds the concrete type name edges to the internal graph
    this.addConcreteTypeNamesForUnion(node);
    if (parentData) {
      if (parentData.kind !== Kind.UNION_TYPE_DEFINITION) {
        this.errors.push(
          multipleNamedTypeDefinitionError(
            typeName,
            kindToTypeString(parentData.kind),
            kindToConvertedTypeString(node.kind),
          ),
        );
        return;
      }
      this.setParentDataExtensionType(parentData, extensionType);
      this.extractUnionMembers(node, parentData.memberByMemberTypeName);
      parentData.description ||= formatDescription('description' in node ? node.description : undefined);
      this.extractConfigureDescriptionsData(parentData);
      return;
    }
    const newParentData: UnionDefinitionData = {
      configureDescriptionDataBySubgraphName: new Map<string, ConfigureDescriptionData>(),
      directivesByDirectiveName,
      extensionType,
      kind: Kind.UNION_TYPE_DEFINITION,
      memberByMemberTypeName: this.extractUnionMembers(node, new Map<string, NamedTypeNode>()),
      name: typeName,
      node: getMutableUnionNode(node.name),
      persistedDirectivesData: newPersistedDirectivesData(),
      description: formatDescription('description' in node ? node.description : undefined),
    };
    this.extractConfigureDescriptionsData(newParentData);
    this.parentDefinitionDataByTypeName.set(typeName, newParentData);
  }

  extractKeyFieldSets(node: CompositeOutputNode, keyFieldSetData: KeyFieldSetData) {
    const isUnresolvableByRawKeyFieldSet = keyFieldSetData.isUnresolvableByKeyFieldSet;
    const parentTypeName = node.name.value;
    if (!node.directives?.length) {
      // This should never happen
      this.errors.push(expectedEntityError(parentTypeName));
      return;
    }
    // validation happens elsewhere
    for (const directive of node.directives) {
      if (directive.name.value !== KEY) {
        continue;
      }
      if (!directive.arguments || directive.arguments.length < 1) {
        continue;
      }
      let keyFieldSet;
      let isUnresolvable = false;
      for (const arg of directive.arguments) {
        if (arg.name.value === RESOLVABLE) {
          if (arg.value.kind === Kind.BOOLEAN && !arg.value.value) {
            isUnresolvable = true;
          }
          continue;
        }
        if (arg.name.value !== FIELDS) {
          keyFieldSet = undefined;
          break;
        }
        if (arg.value.kind !== Kind.STRING) {
          keyFieldSet = undefined;
          break;
        }
        keyFieldSet = arg.value.value;
      }
      if (keyFieldSet !== undefined) {
        isUnresolvableByRawKeyFieldSet.set(keyFieldSet, isUnresolvable);
      }
    }
  }

  validateInterfaceImplementations(data: CompositeOutputData) {
    if (data.implementedInterfaceTypeNames.size < 1) {
      return;
    }
    const isParentInaccessible = data.directivesByDirectiveName.has(INACCESSIBLE);
    const implementationErrorsMap = new Map<string, ImplementationErrors>();
    const invalidImplementationTypeStringByTypeName = new Map<string, string>();
    let doesInterfaceImplementItself = false;
    for (const interfaceName of data.implementedInterfaceTypeNames) {
      const interfaceData = this.parentDefinitionDataByTypeName.get(interfaceName);
      if (!interfaceData) {
        this.errors.push(undefinedTypeError(interfaceName));
        continue;
      }
      if (interfaceData.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        invalidImplementationTypeStringByTypeName.set(interfaceData.name, kindToTypeString(interfaceData.kind));
        continue;
      }
      if (data.name === interfaceData.name) {
        doesInterfaceImplementItself = true;
        continue;
      }
      const implementationErrors: ImplementationErrors = {
        invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
        unimplementedFields: [],
      };
      let hasErrors = false;
      for (const [fieldName, interfaceField] of interfaceData.fieldDataByFieldName) {
        this.unvalidatedExternalFieldCoords.delete(`${data.name}.${fieldName}`);
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
          isInaccessible: false,
          originalResponseType: printTypeNode(interfaceField.node.type),
          unimplementedArguments: new Set<string>(),
        };
        // The implemented field type must be equally or more restrictive than the original interface field type
        if (
          !isTypeValidImplementation(
            interfaceField.node.type,
            fieldData.node.type,
            this.concreteTypeNamesByAbstractTypeName,
          )
        ) {
          hasErrors = true;
          hasNestedErrors = true;
          invalidFieldImplementation.implementedResponseType = printTypeNode(fieldData.node.type);
        }
        const handledArguments = new Set<string>();
        for (const [argumentName, interfaceArgument] of interfaceField.argumentDataByArgumentName) {
          handledArguments.add(argumentName);
          const containerArgument = fieldData.argumentDataByArgumentName.get(argumentName);
          // The type implementing the interface must include all arguments with no variation for that argument
          if (!containerArgument) {
            hasErrors = true;
            hasNestedErrors = true;
            invalidFieldImplementation.unimplementedArguments.add(argumentName);
            continue;
          }
          // Implemented arguments should be the exact same type
          const actualType = printTypeNode(containerArgument.type as TypeNode);
          const expectedType = printTypeNode(interfaceArgument.type as TypeNode);
          if (expectedType !== actualType) {
            hasErrors = true;
            hasNestedErrors = true;
            invalidFieldImplementation.invalidImplementedArguments.push({ actualType, argumentName, expectedType });
          }
        }
        // Additional arguments must be optional (nullable)
        for (const [argumentName, argumentData] of fieldData.argumentDataByArgumentName) {
          if (handledArguments.has(argumentName)) {
            continue;
          }
          if (argumentData.type.kind !== Kind.NON_NULL_TYPE) {
            continue;
          }
          hasErrors = true;
          hasNestedErrors = true;
          invalidFieldImplementation.invalidAdditionalArguments.add(argumentName);
        }
        if (!isParentInaccessible && fieldData.isInaccessible && !interfaceField.isInaccessible) {
          hasErrors = true;
          hasNestedErrors = true;
          invalidFieldImplementation.isInaccessible = true;
        }
        if (hasNestedErrors) {
          implementationErrors.invalidFieldImplementations.set(fieldName, invalidFieldImplementation);
        }
      }
      if (hasErrors) {
        implementationErrorsMap.set(interfaceName, implementationErrors);
      }
    }
    if (invalidImplementationTypeStringByTypeName.size > 0) {
      this.errors.push(invalidImplementedTypeError(data.name, invalidImplementationTypeStringByTypeName));
    }
    if (doesInterfaceImplementItself) {
      this.errors.push(selfImplementationError(data.name));
    }
    if (implementationErrorsMap.size > 0) {
      this.errors.push(
        invalidInterfaceImplementationError(data.name, kindToTypeString(data.kind), implementationErrorsMap),
      );
    }
  }

  handleAuthenticatedDirective(data: NodeData | SchemaData, parentTypeName: string) {
    if (
      data.kind !== Kind.ENUM_TYPE_DEFINITION &&
      data.kind !== Kind.FIELD_DEFINITION &&
      data.kind !== Kind.SCALAR_TYPE_DEFINITION
    ) {
      return;
    }
    if (data.kind !== Kind.FIELD_DEFINITION) {
      this.leafTypeNamesWithAuthorizationDirectives.add(parentTypeName);
    }
    const parentAuthorizationData = getValueOrDefault(this.authorizationDataByParentTypeName, parentTypeName, () =>
      newAuthorizationData(parentTypeName),
    );
    getAuthorizationDataToUpdate(parentAuthorizationData, data.node).requiresAuthentication = true;
  }

  handleOverrideDirective({ data, directiveCoords, errorMessages, targetSubgraphName }: HandleOverrideDirectiveParams) {
    if (targetSubgraphName === this.subgraphName) {
      errorMessages.push(equivalentSourceAndTargetOverrideErrorMessage(targetSubgraphName, directiveCoords));
      return;
    }
    const overrideDataForSubgraph = getValueOrDefault(
      this.overridesByTargetSubgraphName,
      targetSubgraphName,
      () => new Map<string, Set<string>>(),
    );
    getValueOrDefault(
      overrideDataForSubgraph,
      data.renamedParentTypeName || data.originalParentTypeName,
      () => new Set<string>(),
    ).add(data.name);
  }

  handleRequiresScopesDirective({ directiveCoords, orScopes, requiredScopes }: HandleRequiresScopesDirectiveParams) {
    if (orScopes.length > maxOrScopes) {
      this.invalidOrScopesHostPaths.add(directiveCoords);
      return;
    }
    for (const scopes of orScopes) {
      const andScopes = new Set<string>();
      for (const scope of (scopes as ListValueNode).values) {
        andScopes.add((scope as StringValueNode).value);
      }
      if (andScopes.size > 0) {
        requiredScopes.push(andScopes);
      }
    }
  }

  getKafkaPublishConfiguration(
    directive: ConstDirectiveNode,
    argumentDataByArgumentName: Map<string, InputValueData>,
    errorMessages: string[],
  ): EventConfiguration | undefined {
    const topics: string[] = [];
    let providerId = DEFAULT_EDFS_PROVIDER_ID;
    for (const argumentNode of directive.arguments || []) {
      switch (argumentNode.name.value) {
        case TOPIC: {
          if (argumentNode.value.kind !== Kind.STRING || argumentNode.value.value.length < 1) {
            errorMessages.push(invalidEventSubjectErrorMessage(TOPIC));
            continue;
          }
          validateArgumentTemplateReferences(argumentNode.value.value, argumentDataByArgumentName, errorMessages);
          topics.push(argumentNode.value.value);
          break;
        }
        case PROVIDER_ID: {
          if (argumentNode.value.kind !== Kind.STRING || argumentNode.value.value.length < 1) {
            errorMessages.push(invalidEventProviderIdErrorMessage);
            continue;
          }
          providerId = argumentNode.value.value;
          break;
        }
      }
    }
    if (errorMessages.length > 0) {
      return;
    }
    return { fieldName: this.childName, providerId, providerType: PROVIDER_TYPE_KAFKA, topics, type: PUBLISH };
  }

  getKafkaSubscribeConfiguration(
    directive: ConstDirectiveNode,
    argumentDataByArgumentName: Map<string, InputValueData>,
    errorMessages: string[],
  ): EventConfiguration | undefined {
    const topics: string[] = [];
    let providerId = DEFAULT_EDFS_PROVIDER_ID;
    for (const argumentNode of directive.arguments || []) {
      switch (argumentNode.name.value) {
        case TOPICS: {
          if (argumentNode.value.kind !== Kind.LIST) {
            errorMessages.push(invalidEventSubjectsErrorMessage(TOPICS));
            continue;
          }
          for (const value of argumentNode.value.values) {
            if (value.kind !== Kind.STRING || value.value.length < 1) {
              errorMessages.push(invalidEventSubjectsItemErrorMessage(TOPICS));
              break;
            }
            validateArgumentTemplateReferences(value.value, argumentDataByArgumentName, errorMessages);
            topics.push(value.value);
          }
          break;
        }
        case PROVIDER_ID: {
          if (argumentNode.value.kind !== Kind.STRING || argumentNode.value.value.length < 1) {
            errorMessages.push(invalidEventProviderIdErrorMessage);
            continue;
          }
          providerId = argumentNode.value.value;
          break;
        }
      }
    }
    if (errorMessages.length > 0) {
      return;
    }
    return {
      fieldName: this.childName,
      providerId,
      providerType: PROVIDER_TYPE_KAFKA,
      topics: topics,
      type: SUBSCRIBE,
    };
  }

  getNatsPublishAndRequestConfiguration(
    eventType: NatsEventType,
    directive: ConstDirectiveNode,
    argumentDataByArgumentName: Map<string, InputValueData>,
    errorMessages: string[],
  ): EventConfiguration | undefined {
    const subjects: string[] = [];
    let providerId = DEFAULT_EDFS_PROVIDER_ID;
    for (const argumentNode of directive.arguments || []) {
      switch (argumentNode.name.value) {
        case SUBJECT: {
          if (argumentNode.value.kind !== Kind.STRING || argumentNode.value.value.length < 1) {
            errorMessages.push(invalidEventSubjectErrorMessage(SUBJECT));
            continue;
          }
          validateArgumentTemplateReferences(argumentNode.value.value, argumentDataByArgumentName, errorMessages);
          subjects.push(argumentNode.value.value);
          break;
        }
        case PROVIDER_ID: {
          if (argumentNode.value.kind !== Kind.STRING || argumentNode.value.value.length < 1) {
            errorMessages.push(invalidEventProviderIdErrorMessage);
            continue;
          }
          providerId = argumentNode.value.value;
          break;
        }
      }
    }
    if (errorMessages.length > 0) {
      return;
    }
    return { fieldName: this.childName, providerId, providerType: PROVIDER_TYPE_NATS, subjects, type: eventType };
  }

  getNatsSubscribeConfiguration(
    directive: ConstDirectiveNode,
    argumentDataByArgumentName: Map<string, InputValueData>,
    errorMessages: string[],
  ): EventConfiguration | undefined {
    const subjects: string[] = [];
    let providerId = DEFAULT_EDFS_PROVIDER_ID;
    let consumerInactiveThreshold = DEFAULT_CONSUMER_INACTIVE_THRESHOLD;
    let consumerName = '';
    let streamName = '';
    for (const argumentNode of directive.arguments || []) {
      switch (argumentNode.name.value) {
        case SUBJECTS: {
          if (argumentNode.value.kind !== Kind.LIST) {
            // errorMessages.push(invalidEventSubjectsErrorMessage(SUBJECTS));
            continue;
          }
          for (const value of argumentNode.value.values) {
            if (value.kind !== Kind.STRING || value.value.length < 1) {
              errorMessages.push(invalidEventSubjectsItemErrorMessage(SUBJECTS));
              break;
            }
            validateArgumentTemplateReferences(value.value, argumentDataByArgumentName, errorMessages);
            subjects.push(value.value);
          }
          break;
        }
        case PROVIDER_ID: {
          if (argumentNode.value.kind !== Kind.STRING || argumentNode.value.value.length < 1) {
            errorMessages.push(invalidEventProviderIdErrorMessage);
            continue;
          }
          providerId = argumentNode.value.value;
          break;
        }
        case STREAM_CONFIGURATION: {
          this.usesEdfsNatsStreamConfiguration = true;
          if (argumentNode.value.kind !== Kind.OBJECT || argumentNode.value.fields.length < 1) {
            errorMessages.push(invalidNatsStreamInputErrorMessage);
            continue;
          }
          let isValid = true;
          const invalidFieldNames = new Set<string>();
          const allowedFieldNames = new Set(STREAM_CONFIGURATION_FIELD_NAMES);
          const missingRequiredFieldNames = new Set<string>([CONSUMER_NAME, STREAM_NAME]);
          const duplicateFieldNames = new Set<string>();
          const invalidRequiredFieldNames = new Set<string>();
          for (const field of argumentNode.value.fields) {
            const fieldName = field.name.value;
            if (!STREAM_CONFIGURATION_FIELD_NAMES.has(fieldName)) {
              invalidFieldNames.add(fieldName);
              isValid = false;
              continue;
            }
            if (allowedFieldNames.has(fieldName)) {
              allowedFieldNames.delete(fieldName);
            } else {
              duplicateFieldNames.add(fieldName);
              isValid = false;
              continue;
            }
            if (missingRequiredFieldNames.has(fieldName)) {
              missingRequiredFieldNames.delete(fieldName);
            }
            switch (fieldName) {
              case CONSUMER_NAME:
                if (field.value.kind != Kind.STRING || field.value.value.length < 1) {
                  invalidRequiredFieldNames.add(fieldName);
                  isValid = false;
                  continue;
                }
                consumerName = field.value.value;
                break;
              case STREAM_NAME:
                if (field.value.kind != Kind.STRING || field.value.value.length < 1) {
                  invalidRequiredFieldNames.add(fieldName);
                  isValid = false;
                  continue;
                }
                streamName = field.value.value;
                break;
              case CONSUMER_INACTIVE_THRESHOLD:
                if (field.value.kind != Kind.INT) {
                  errorMessages.push(
                    invalidArgumentValueErrorMessage(
                      print(field.value),
                      'edfs__NatsStreamConfiguration',
                      `consumerInactiveThreshold`,
                      INT_SCALAR,
                    ),
                  );
                  isValid = false;
                  continue;
                }

                // It should not be possible for this to error
                try {
                  consumerInactiveThreshold = parseInt(field.value.value, 10);
                } catch (e) {
                  errorMessages.push(
                    invalidArgumentValueErrorMessage(
                      print(field.value),
                      'edfs__NatsStreamConfiguration',
                      `consumerInactiveThreshold`,
                      INT_SCALAR,
                    ),
                  );
                  isValid = false;
                }
                break;
            }
          }
          if (!isValid || missingRequiredFieldNames.size > 0) {
            errorMessages.push(
              invalidNatsStreamInputFieldsErrorMessage(
                [...missingRequiredFieldNames],
                [...duplicateFieldNames],
                [...invalidRequiredFieldNames],
                [...invalidFieldNames],
              ),
            );
          }
        }
      }
    }
    if (errorMessages.length > 0) {
      return;
    }
    if (consumerInactiveThreshold < 0) {
      consumerInactiveThreshold = DEFAULT_CONSUMER_INACTIVE_THRESHOLD;
      this.warnings.push(
        consumerInactiveThresholdInvalidValueWarning(
          this.subgraphName,
          `The value has been set to ${DEFAULT_CONSUMER_INACTIVE_THRESHOLD}.`,
        ),
      );
    } else if (consumerInactiveThreshold > MAX_INT32) {
      consumerInactiveThreshold = 0;
      this.warnings.push(
        consumerInactiveThresholdInvalidValueWarning(
          this.subgraphName,
          'The value has been set to 0. This means the consumer will remain indefinitely active until its manual deletion.',
        ),
      );
    }
    return {
      fieldName: this.childName,
      providerId,
      providerType: PROVIDER_TYPE_NATS,
      subjects,
      type: SUBSCRIBE,
      ...(consumerName && streamName
        ? {
            streamConfiguration: {
              consumerInactiveThreshold: consumerInactiveThreshold,
              consumerName: consumerName,
              streamName,
            },
          }
        : {}),
    };
  }

  validateSubscriptionFilterDirectiveLocation(node: FieldDefinitionNode) {
    if (!node.directives) {
      return;
    }
    const parentTypeName = this.renamedParentTypeName || this.originalParentTypeName;
    const fieldPath = `${parentTypeName}.${node.name.value}`;
    const isSubscription = this.getOperationTypeNodeForRootTypeName(parentTypeName) === OperationTypeNode.SUBSCRIPTION;
    for (const directiveNode of node.directives) {
      if (directiveNode.name.value !== SUBSCRIPTION_FILTER) {
        continue;
      }
      if (!isSubscription) {
        this.errors.push(invalidSubscriptionFilterLocationError(fieldPath));
        return;
      }
    }
  }

  extractEventDirectivesToConfiguration(
    node: FieldDefinitionNode,
    argumentDataByArgumentName: Map<string, InputValueData>,
  ) {
    // Validation is handled elsewhere
    if (!node.directives) {
      return;
    }
    const fieldPath = `${this.renamedParentTypeName || this.originalParentTypeName}.${this.childName}`;
    for (const directive of node.directives) {
      const errorMessages: string[] = [];
      let eventConfiguration: EventConfiguration | undefined;
      switch (directive.name.value) {
        case EDFS_KAFKA_PUBLISH:
          eventConfiguration = this.getKafkaPublishConfiguration(directive, argumentDataByArgumentName, errorMessages);
          break;
        case EDFS_KAFKA_SUBSCRIBE:
          eventConfiguration = this.getKafkaSubscribeConfiguration(
            directive,
            argumentDataByArgumentName,
            errorMessages,
          );
          break;
        case EDFS_NATS_PUBLISH: {
          eventConfiguration = this.getNatsPublishAndRequestConfiguration(
            PUBLISH,
            directive,
            argumentDataByArgumentName,
            errorMessages,
          );
          break;
        }
        case EDFS_NATS_REQUEST: {
          eventConfiguration = this.getNatsPublishAndRequestConfiguration(
            REQUEST,
            directive,
            argumentDataByArgumentName,
            errorMessages,
          );
          break;
        }
        case EDFS_NATS_SUBSCRIBE: {
          eventConfiguration = this.getNatsSubscribeConfiguration(directive, argumentDataByArgumentName, errorMessages);
          break;
        }
        default:
          continue;
      }

      if (errorMessages.length > 0) {
        this.errors.push(invalidEventDirectiveError(directive.name.value, fieldPath, errorMessages));
        continue;
      }

      // should never happen
      if (!eventConfiguration) {
        continue;
      }

      getValueOrDefault(
        this.eventsConfigurations,
        this.renamedParentTypeName || this.originalParentTypeName,
        () => [],
      ).push(eventConfiguration);
    }
  }

  getValidEventsDirectiveNamesForOperationTypeNode(operationTypeNode: OperationTypeNode): Set<string> {
    switch (operationTypeNode) {
      case OperationTypeNode.MUTATION:
        return new Set<string>([EDFS_KAFKA_PUBLISH, EDFS_NATS_PUBLISH, EDFS_NATS_REQUEST]);
      case OperationTypeNode.QUERY:
        return new Set<string>([EDFS_NATS_REQUEST]);
      case OperationTypeNode.SUBSCRIPTION:
        return new Set<string>([EDFS_KAFKA_SUBSCRIBE, EDFS_NATS_SUBSCRIBE]);
    }
  }

  getOperationTypeNodeForRootTypeName(parentTypeName: string): OperationTypeNode | undefined {
    const operationTypeNode = this.operationTypeNodeByTypeName.get(parentTypeName);
    if (operationTypeNode) {
      return operationTypeNode;
    }
    switch (parentTypeName) {
      case MUTATION:
        return OperationTypeNode.MUTATION;
      case QUERY:
        return OperationTypeNode.QUERY;
      case SUBSCRIPTION:
        return OperationTypeNode.SUBSCRIPTION;
      default:
        return;
    }
  }

  validateEventDrivenRootType(
    data: ObjectDefinitionData,
    invalidEventsDirectiveDataByRootFieldPath: Map<string, InvalidRootTypeFieldEventsDirectiveData>,
    invalidResponseTypeStringByRootFieldPath: Map<string, string>,
    invalidResponseTypeNameByMutationPath: Map<string, string>,
  ) {
    const operationTypeNode = this.getOperationTypeNodeForRootTypeName(data.name);
    if (!operationTypeNode) {
      // should never happen
      this.errors.push(invalidRootTypeError(data.name));
      return;
    }
    const validEventDirectiveNames = this.getValidEventsDirectiveNamesForOperationTypeNode(operationTypeNode);
    for (const [fieldName, fieldData] of data.fieldDataByFieldName) {
      const fieldPath = `${fieldData.originalParentTypeName}.${fieldName}`;
      const definedEventsDirectiveNames = new Set<string>();
      for (const eventsDirectiveName of EVENT_DIRECTIVE_NAMES) {
        if (fieldData.directivesByDirectiveName.has(eventsDirectiveName)) {
          definedEventsDirectiveNames.add(eventsDirectiveName);
        }
      }
      const invalidEventsDirectiveNames = new Set<string>();
      for (const definedEventsDirectiveName of definedEventsDirectiveNames) {
        if (!validEventDirectiveNames.has(definedEventsDirectiveName)) {
          invalidEventsDirectiveNames.add(definedEventsDirectiveName);
        }
      }
      if (definedEventsDirectiveNames.size < 1 || invalidEventsDirectiveNames.size > 0) {
        invalidEventsDirectiveDataByRootFieldPath.set(fieldPath, {
          definesDirectives: definedEventsDirectiveNames.size > 0,
          invalidDirectiveNames: [...invalidEventsDirectiveNames],
        });
      }
      if (operationTypeNode === OperationTypeNode.MUTATION) {
        const typeString = printTypeNode(fieldData.type);
        if (typeString !== NON_NULLABLE_EDFS_PUBLISH_EVENT_RESULT) {
          invalidResponseTypeNameByMutationPath.set(fieldPath, typeString);
        }
        continue;
      }
      const fieldTypeString = printTypeNode(fieldData.type);
      const expectedTypeString = fieldData.namedTypeName + '!';
      let isValid = false;
      const concreteTypeNames =
        this.concreteTypeNamesByAbstractTypeName.get(fieldData.namedTypeName) ||
        new Set<string>([fieldData.namedTypeName]);
      for (const concreteTypeName of concreteTypeNames) {
        isValid ||= this.entityDataByTypeName.has(concreteTypeName);
        if (isValid) {
          break;
        }
      }
      if (!isValid || fieldTypeString !== expectedTypeString) {
        invalidResponseTypeStringByRootFieldPath.set(fieldPath, fieldTypeString);
      }
    }
  }

  validateEventDrivenKeyDefinition(typeName: string, invalidKeyFieldSetsByEntityTypeName: Map<string, string[]>) {
    const keyFieldSetData = this.keyFieldSetDataByTypeName.get(typeName);
    if (!keyFieldSetData) {
      return;
    }
    for (const [keyFieldSet, isUnresolvable] of keyFieldSetData.isUnresolvableByKeyFieldSet) {
      if (isUnresolvable) {
        continue;
      }
      getValueOrDefault(invalidKeyFieldSetsByEntityTypeName, typeName, () => []).push(keyFieldSet);
    }
  }

  validateEventDrivenObjectFields(
    fieldDataByFieldName: Map<string, FieldData>,
    keyFieldNames: Set<string>,
    nonExternalKeyFieldNameByFieldPath: Map<string, string>,
    nonKeyFieldNameByFieldPath: Map<string, string>,
  ) {
    for (const [fieldName, fieldData] of fieldDataByFieldName) {
      const fieldPath = `${fieldData.originalParentTypeName}.${fieldName}`;
      if (keyFieldNames.has(fieldName)) {
        if (!fieldData.isExternalBySubgraphName.get(this.subgraphName)) {
          nonExternalKeyFieldNameByFieldPath.set(fieldPath, fieldName);
        }
        continue;
      }
      nonKeyFieldNameByFieldPath.set(fieldPath, fieldName);
    }
  }

  isEdfsPublishResultValid(): boolean {
    const data = this.parentDefinitionDataByTypeName.get(EDFS_PUBLISH_RESULT);
    if (!data) {
      return true;
    }
    if (data.kind !== Kind.OBJECT_TYPE_DEFINITION) {
      return false;
    }
    if (data.fieldDataByFieldName.size != 1) {
      return false;
    }
    for (const [fieldName, fieldData] of data.fieldDataByFieldName) {
      if (fieldData.argumentDataByArgumentName.size > 0) {
        return false;
      }
      if (fieldName !== SUCCESS) {
        return false;
      }
      if (printTypeNode(fieldData.type) !== NON_NULLABLE_BOOLEAN) {
        return false;
      }
    }
    return true;
  }

  isNatsStreamConfigurationInputObjectValid(streamConfigurationInputData: ParentDefinitionData): boolean {
    if (streamConfigurationInputData.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION) {
      return false;
    }
    if (streamConfigurationInputData.inputValueDataByValueName.size != 3) {
      return false;
    }
    for (const [inputValueName, inputValueData] of streamConfigurationInputData.inputValueDataByValueName) {
      switch (inputValueName) {
        case CONSUMER_INACTIVE_THRESHOLD: {
          if (printTypeNode(inputValueData.type) !== NON_NULLABLE_INT) {
            return false;
          }
          if (
            !inputValueData.defaultValue ||
            inputValueData.defaultValue.kind !== Kind.INT ||
            inputValueData.defaultValue.value !== `${DEFAULT_CONSUMER_INACTIVE_THRESHOLD}`
          ) {
            return false;
          }
          break;
        }
        case CONSUMER_NAME:
        // intentional fallthrough
        case STREAM_NAME: {
          if (printTypeNode(inputValueData.type) !== NON_NULLABLE_STRING) {
            return false;
          }
          break;
        }
        default: {
          return false;
        }
      }
    }
    return true;
  }

  validateEventDrivenSubgraph(definitions: Array<DefinitionNode>) {
    const errorMessages: string[] = [];
    const invalidEventsDirectiveDataByRootFieldPath = new Map<string, InvalidRootTypeFieldEventsDirectiveData>();
    const invalidResponseTypeStringByRootFieldPath = new Map<string, string>();
    const invalidResponseTypeNameByMutationPath = new Map<string, string>();
    const invalidKeyFieldSetsByEntityTypeName = new Map<string, string[]>();
    const nonExternalKeyFieldNameByFieldPath = new Map<string, string>();
    const nonKeyFieldNameByFieldPath = new Map<string, string>();
    const nonEntityExtensionTypeNames = new Set<string>();
    const invalidObjectTypeNames = new Set<string>();
    for (const [typeName, data] of this.parentDefinitionDataByTypeName) {
      // validate edfs__PublishResult and edfs__NatsStreamConfiguration separately
      if (typeName === EDFS_PUBLISH_RESULT || typeName === EDFS_NATS_STREAM_CONFIGURATION) {
        continue;
      }
      if (data.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        continue;
      }
      if (data.isRootType) {
        this.validateEventDrivenRootType(
          data,
          invalidEventsDirectiveDataByRootFieldPath,
          invalidResponseTypeStringByRootFieldPath,
          invalidResponseTypeNameByMutationPath,
        );
        continue;
      }
      const keyFieldNames = this.keyFieldNamesByParentTypeName.get(typeName);
      if (!keyFieldNames) {
        invalidObjectTypeNames.add(typeName);
        continue;
      }
      this.validateEventDrivenKeyDefinition(typeName, invalidKeyFieldSetsByEntityTypeName);
      this.validateEventDrivenObjectFields(
        data.fieldDataByFieldName,
        keyFieldNames,
        nonExternalKeyFieldNameByFieldPath,
        nonKeyFieldNameByFieldPath,
      );
    }
    if (!this.isEdfsPublishResultValid()) {
      errorMessages.push(invalidEdfsPublishResultObjectErrorMessage);
    }
    if (this.edfsDirectiveReferences.has(EDFS_NATS_SUBSCRIBE)) {
      const streamConfigurationInputData = this.parentDefinitionDataByTypeName.get(EDFS_NATS_STREAM_CONFIGURATION);
      if (
        streamConfigurationInputData &&
        this.usesEdfsNatsStreamConfiguration &&
        !this.isNatsStreamConfigurationInputObjectValid(streamConfigurationInputData)
      ) {
        errorMessages.push(invalidNatsStreamConfigurationDefinitionErrorMessage);
      }

      // always add the correct definition to the schema regardless
      this.parentDefinitionDataByTypeName.delete(EDFS_NATS_STREAM_CONFIGURATION);
      definitions.push(EDFS_NATS_STREAM_CONFIGURATION_DEFINITION);
    }

    if (this.referencedDirectiveNames.has(LINK)) {
      definitions.push(LINK_DEFINITION);
      definitions.push(LINK_IMPORT_DEFINITION);
      definitions.push(LINK_PURPOSE_DEFINITION);
    }

    if (invalidEventsDirectiveDataByRootFieldPath.size > 0) {
      errorMessages.push(invalidRootTypeFieldEventsDirectivesErrorMessage(invalidEventsDirectiveDataByRootFieldPath));
    }
    if (invalidResponseTypeNameByMutationPath.size > 0) {
      errorMessages.push(invalidEventDrivenMutationResponseTypeErrorMessage(invalidResponseTypeNameByMutationPath));
    }
    if (invalidResponseTypeStringByRootFieldPath.size > 0) {
      errorMessages.push(
        invalidRootTypeFieldResponseTypesEventDrivenErrorMessage(invalidResponseTypeStringByRootFieldPath),
      );
    }
    if (invalidKeyFieldSetsByEntityTypeName.size > 0) {
      errorMessages.push(invalidKeyFieldSetsEventDrivenErrorMessage(invalidKeyFieldSetsByEntityTypeName));
    }
    if (nonExternalKeyFieldNameByFieldPath.size > 0) {
      errorMessages.push(nonExternalKeyFieldNamesEventDrivenErrorMessage(nonExternalKeyFieldNameByFieldPath));
    }
    if (nonKeyFieldNameByFieldPath.size > 0) {
      errorMessages.push(nonKeyFieldNamesEventDrivenErrorMessage(nonKeyFieldNameByFieldPath));
    }
    if (nonEntityExtensionTypeNames.size > 0) {
      errorMessages.push(nonEntityObjectExtensionsEventDrivenErrorMessage([...nonEntityExtensionTypeNames]));
    }
    if (invalidObjectTypeNames.size > 0) {
      errorMessages.push(nonKeyComposingObjectTypeNamesEventDrivenErrorMessage([...invalidObjectTypeNames]));
    }
    if (errorMessages.length > 0) {
      this.errors.push(invalidEventDrivenGraphError(errorMessages));
    }
  }

  validateUnionMembers(data: UnionDefinitionData) {
    if (data.memberByMemberTypeName.size < 1) {
      this.errors.push(noDefinedUnionMembersError(data.name));
      return;
    }
    const invalidMembers: string[] = [];
    for (const memberName of data.memberByMemberTypeName.keys()) {
      const memberData = this.parentDefinitionDataByTypeName.get(memberName);
      // Invalid references are propagated as an error elsewhere
      if (!memberData) {
        continue;
      }
      if (memberData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        invalidMembers.push(`"${memberName}", which is type "${kindToTypeString(memberData.kind)}"`);
      }
    }
    if (invalidMembers.length > 0) {
      this.errors.push(invalidUnionMemberTypeError(data.name, invalidMembers));
    }
  }

  addConcreteTypeNamesForUnion(node: UnionTypeNode) {
    if (!node.types || node.types.length < 1) {
      return;
    }
    const unionTypeName = node.name.value;
    for (const member of node.types) {
      const memberTypeName = member.name.value;
      getValueOrDefault(this.concreteTypeNamesByAbstractTypeName, unionTypeName, () => new Set<string>()).add(
        memberTypeName,
      );
      this.internalGraph.addEdge(
        this.internalGraph.addOrUpdateNode(unionTypeName, { isAbstract: true }),
        this.internalGraph.addOrUpdateNode(memberTypeName),
        memberTypeName,
        true,
      );
    }
  }

  validateAndAddKeyToConfiguration(parentData: CompositeOutputData, keyFieldSetData: KeyFieldSetData) {
    const configurationData = getOrThrowError(
      this.configurationDataByParentTypeName,
      getParentTypeName(parentData),
      'configurationDataByParentTypeName',
    );
    const keys = validateKeyFieldSets(
      this,
      parentData,
      keyFieldSetData.isUnresolvableByKeyFieldSet,
      configurationData.fieldNames,
    );
    if (keys) {
      configurationData.keys = keys;
    }
  }

  validateAndAddKeysToConfiguration() {
    for (const [parentTypeName, keyFieldSetData] of this.keyFieldSetDataByTypeName) {
      const parentData = this.parentDefinitionDataByTypeName.get(parentTypeName);
      if (
        !parentData ||
        (parentData.kind !== Kind.OBJECT_TYPE_DEFINITION && parentData.kind !== Kind.INTERFACE_TYPE_DEFINITION)
      ) {
        this.errors.push(undefinedObjectLikeParentError(parentTypeName));
        continue;
      }
      this.validateAndAddKeyToConfiguration(parentData, keyFieldSetData);
    }
  }

  getValidFlattenedDirectiveArray(
    directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
    directiveCoords: string,
  ): ConstDirectiveNode[] {
    const flattenedArray: ConstDirectiveNode[] = [];
    for (const [directiveName, directiveNodes] of directivesByDirectiveName) {
      const directiveDefinition = this.directiveDefinitionDataByDirectiveName.get(directiveName);
      if (!directiveDefinition) {
        continue;
      }
      if (!directiveDefinition.isRepeatable && directiveNodes.length > 1) {
        const handledDirectiveNames = getValueOrDefault(
          this.invalidRepeatedDirectiveNameByCoords,
          directiveCoords,
          () => new Set<string>(),
        );
        if (!handledDirectiveNames.has(directiveName)) {
          handledDirectiveNames.add(directiveName);
          this.errors.push(
            invalidDirectiveError(directiveName, directiveCoords, '1st', [
              invalidRepeatedDirectiveErrorMessage(directiveName),
            ]),
          );
        }
        continue;
      }
      if (directiveName !== KEY) {
        flattenedArray.push(...directiveNodes);
        continue;
      }
      const normalizedDirectiveNodes: ConstDirectiveNode[] = [];
      const entityKeys = new Set<string>();
      for (let i = 0; i < directiveNodes.length; i++) {
        const keyDirectiveNode = directiveNodes[i];
        const directiveValue = keyDirectiveNode.arguments![0].value;
        if (directiveValue.kind !== Kind.STRING) {
          continue;
        }
        const entityKey = directiveValue.value;
        if (entityKeys.has(entityKey)) {
          continue;
        }
        entityKeys.add(entityKey);
        flattenedArray.push(keyDirectiveNode);
        normalizedDirectiveNodes.push(keyDirectiveNode);
      }
      directivesByDirectiveName.set(directiveName, normalizedDirectiveNodes);
    }
    return flattenedArray;
  }

  getEnumNodeByData(enumDefinitionData: EnumDefinitionData) {
    enumDefinitionData.node.description = enumDefinitionData.description;
    enumDefinitionData.node.directives = this.getValidFlattenedDirectiveArray(
      enumDefinitionData.directivesByDirectiveName,
      enumDefinitionData.name,
    );
    enumDefinitionData.node.values = childMapToValueArray(
      enumDefinitionData.enumValueDataByValueName,
      this.authorizationDataByParentTypeName,
    );
    return enumDefinitionData.node;
  }

  getInputObjectNodeByData(inputObjectDefinitionData: InputObjectDefinitionData) {
    inputObjectDefinitionData.node.description = inputObjectDefinitionData.description;
    inputObjectDefinitionData.node.directives = this.getValidFlattenedDirectiveArray(
      inputObjectDefinitionData.directivesByDirectiveName,
      inputObjectDefinitionData.name,
    );
    inputObjectDefinitionData.node.fields = childMapToValueArray(
      inputObjectDefinitionData.inputValueDataByValueName,
      this.authorizationDataByParentTypeName,
    );
    return inputObjectDefinitionData.node;
  }

  getCompositeOutputNodeByData(compositeOutputData: CompositeOutputData): ObjectTypeNode | InterfaceTypeDefinitionNode {
    compositeOutputData.node.description = compositeOutputData.description;
    compositeOutputData.node.directives = this.getValidFlattenedDirectiveArray(
      compositeOutputData.directivesByDirectiveName,
      compositeOutputData.name,
    );
    compositeOutputData.node.fields = childMapToValueArray(
      compositeOutputData.fieldDataByFieldName,
      this.authorizationDataByParentTypeName,
    );
    compositeOutputData.node.interfaces = setToNamedTypeNodeArray(compositeOutputData.implementedInterfaceTypeNames);
    return compositeOutputData.node;
  }

  getScalarNodeByData(scalarDefinitionData: ScalarDefinitionData) {
    scalarDefinitionData.node.description = scalarDefinitionData.description;
    scalarDefinitionData.node.directives = this.getValidFlattenedDirectiveArray(
      scalarDefinitionData.directivesByDirectiveName,
      scalarDefinitionData.name,
    );
    return scalarDefinitionData.node;
  }

  getSchemaNodeByData(schemaData: SchemaData): SchemaDefinitionNode {
    return {
      description: schemaData.description,
      directives: this.getValidFlattenedDirectiveArray(schemaData.directivesByDirectiveName, schemaData.name),
      kind: schemaData.kind,
      operationTypes: mapToArrayOfValues(schemaData.operationTypes),
    };
  }

  getUnionNodeByData(unionDefinitionData: UnionDefinitionData) {
    unionDefinitionData.node.description = unionDefinitionData.description;
    unionDefinitionData.node.directives = this.getValidFlattenedDirectiveArray(
      unionDefinitionData.directivesByDirectiveName,
      unionDefinitionData.name,
    );
    unionDefinitionData.node.types = mapToArrayOfValues(unionDefinitionData.memberByMemberTypeName);
    return unionDefinitionData.node;
  }

  normalize(document: DocumentNode): NormalizationResult {
    /* factory.allDirectiveDefinitions is initialized with v1 directive definitions, and v2 definitions are only added
    after the visitor has visited the entire schema and the subgraph is known to be a V2 graph. Consequently,
    allDirectiveDefinitions cannot be used to check for duplicate definitions, and another set (below) is required */

    // Collect any renamed root types
    upsertDirectiveSchemaAndEntityDefinitions(this, document);
    upsertParentsAndChildren(this, document);
    this.validateDirectives(this.schemaData, SCHEMA);
    for (const [parentTypeName, parentData] of this.parentDefinitionDataByTypeName) {
      this.validateDirectives(parentData, parentTypeName);
    }
    consolidateAuthorizationDirectives(this, document);
    for (const interfaceTypeName of this.interfaceTypeNamesWithAuthorizationDirectives) {
      const interfaceAuthorizationData = this.authorizationDataByParentTypeName.get(interfaceTypeName);
      if (!interfaceAuthorizationData) {
        continue;
      }
      const concreteTypeNames = this.concreteTypeNamesByAbstractTypeName.get(interfaceTypeName);
      for (const concreteTypeName of concreteTypeNames || []) {
        const concreteAuthorizationData = getValueOrDefault(
          this.authorizationDataByParentTypeName,
          concreteTypeName,
          () => newAuthorizationData(concreteTypeName),
        );
        for (const [
          fieldName,
          interfaceFieldAuthorizationData,
        ] of interfaceAuthorizationData.fieldAuthorizationDataByFieldName) {
          if (
            !upsertFieldAuthorizationData(
              concreteAuthorizationData.fieldAuthorizationDataByFieldName,
              interfaceFieldAuthorizationData,
            )
          ) {
            this.invalidOrScopesHostPaths.add(`${concreteTypeName}.${fieldName}`);
          }
        }
      }
    }
    // Apply inherited leaf authorization that was not applied to interface fields of that type earlier
    for (const [typeName, fieldAuthorizationDatas] of this.heirFieldAuthorizationDataByTypeName) {
      const authorizationData = this.authorizationDataByParentTypeName.get(typeName);
      if (!authorizationData) {
        continue;
      }
      for (const fieldAuthorizationData of fieldAuthorizationDatas) {
        if (!mergeAuthorizationDataByAND(authorizationData, fieldAuthorizationData)) {
          this.invalidOrScopesHostPaths.add(`${typeName}.${fieldAuthorizationData.fieldName}`);
        }
      }
    }
    if (this.invalidOrScopesHostPaths.size > 0) {
      this.errors.push(orScopesLimitError(maxOrScopes, [...this.invalidOrScopesHostPaths]));
    }
    const definitions: DefinitionNode[] = [];
    for (const directiveDefinition of BASE_DIRECTIVE_DEFINITIONS) {
      definitions.push(directiveDefinition);
    }
    definitions.push(FIELD_SET_SCALAR_DEFINITION);
    if (this.isSubgraphVersionTwo) {
      for (const directiveDefinition of VERSION_TWO_DIRECTIVE_DEFINITIONS) {
        definitions.push(directiveDefinition);
        this.directiveDefinitionByDirectiveName.set(directiveDefinition.name.value, directiveDefinition);
      }
      definitions.push(SCOPE_SCALAR_DEFINITION);
    }
    for (const directiveName of this.edfsDirectiveReferences) {
      const directiveDefinition = EVENT_DRIVEN_DIRECTIVE_DEFINITIONS_BY_DIRECTIVE_NAME.get(directiveName);
      if (!directiveDefinition) {
        // should never happen
        this.errors.push(invalidEdfsDirectiveName(directiveName));
        continue;
      }
      definitions.push(directiveDefinition);
    }
    // subscriptionFilter is temporarily valid only in an EDG
    if (this.edfsDirectiveReferences.size > 0 && this.referencedDirectiveNames.has(SUBSCRIPTION_FILTER)) {
      definitions.push(SUBSCRIPTION_FILTER_DEFINITION);
      definitions.push(SUBSCRIPTION_FILTER_CONDITION_DEFINITION);
      definitions.push(SUBSCRIPTION_FIELD_CONDITION_DEFINITION);
      definitions.push(SUBSCRIPTION_FILTER_VALUE_DEFINITION);
    }
    if (this.referencedDirectiveNames.has(CONFIGURE_DESCRIPTION)) {
      definitions.push(CONFIGURE_DESCRIPTION_DEFINITION);
    }
    if (this.referencedDirectiveNames.has(CONFIGURE_CHILD_DESCRIPTIONS)) {
      definitions.push(CONFIGURE_CHILD_DESCRIPTIONS_DEFINITION);
    }
    for (const directiveDefinition of this.customDirectiveDefinitions.values()) {
      definitions.push(directiveDefinition);
    }
    if (this.schemaData.operationTypes.size > 0) {
      definitions.push(this.getSchemaNodeByData(this.schemaData));
    }
    /*
     * Sometimes an @openfed__configureDescription directive is defined before a description is, e.g., on an extension.
     * If at this stage there is still no description, it is propagated as an error.
     * */
    for (const data of this.invalidConfigureDescriptionNodeDatas) {
      if (!data.description) {
        this.errors.push(configureDescriptionNoDescriptionError(kindToTypeString(data.kind), data.name));
      }
    }
    for (const [parentTypeName, parentDefinitionData] of this.parentDefinitionDataByTypeName) {
      switch (parentDefinitionData.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
          if (parentDefinitionData.enumValueDataByValueName.size < 1) {
            this.errors.push(noDefinedEnumValuesError(parentTypeName));
            break;
          }
          removeIgnoredDirectives(parentDefinitionData);
          definitions.push(this.getEnumNodeByData(parentDefinitionData));
          break;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          if (parentDefinitionData.inputValueDataByValueName.size < 1) {
            this.errors.push(noInputValueDefinitionsError(parentTypeName));
            break;
          }
          definitions.push(this.getInputObjectNodeByData(parentDefinitionData));
          break;
        case Kind.INTERFACE_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.OBJECT_TYPE_DEFINITION:
          const isEntity = this.entityDataByTypeName.has(parentTypeName);
          const operationTypeNode = this.operationTypeNodeByTypeName.get(parentTypeName);
          const isObject = parentDefinitionData.kind === Kind.OBJECT_TYPE_DEFINITION;
          if (operationTypeNode) {
            parentDefinitionData.fieldDataByFieldName.delete(SERVICE_FIELD);
            parentDefinitionData.fieldDataByFieldName.delete(ENTITIES_FIELD);
          }
          removeIgnoredDirectives(parentDefinitionData);
          removeInheritableDirectivesFromObjectParent(parentDefinitionData);
          if (this.parentsWithChildArguments.has(parentTypeName) || !isObject) {
            const externalInterfaceFieldNames: Array<string> = [];
            for (const [fieldName, fieldData] of parentDefinitionData.fieldDataByFieldName) {
              if (!isObject && fieldData.isExternalBySubgraphName.get(this.subgraphName)) {
                externalInterfaceFieldNames.push(fieldName);
              }
              // Arguments can only be fully validated once all parents types are known
              this.validateArguments(fieldData, `${parentTypeName}.${fieldName}`);
            }
            // @external interface fields fails composition in V2; only propagate as a warning for V1.
            if (externalInterfaceFieldNames.length > 0) {
              this.isSubgraphVersionTwo
                ? this.errors.push(externalInterfaceFieldsError(parentTypeName, externalInterfaceFieldNames))
                : this.warnings.push(
                    externalInterfaceFieldsWarning(this.subgraphName, parentTypeName, externalInterfaceFieldNames),
                  );
            }
          }
          const newParentTypeName =
            parentDefinitionData.kind === Kind.OBJECT_TYPE_DEFINITION
              ? parentDefinitionData.renamedTypeName || parentTypeName
              : parentTypeName;
          const configurationData: ConfigurationData = {
            fieldNames: new Set<string>(),
            isRootNode: isEntity,
            typeName: newParentTypeName,
          };
          const entityInterfaceData = this.entityInterfaceDataByTypeName.get(parentTypeName);
          if (entityInterfaceData) {
            entityInterfaceData.fieldDatas = fieldDatasToSimpleFieldDatas(
              parentDefinitionData.fieldDataByFieldName.values(),
            );
            entityInterfaceData.concreteTypeNames = getValueOrDefault(
              this.concreteTypeNamesByAbstractTypeName,
              parentTypeName,
              () => new Set<string>(),
            );
            configurationData.isInterfaceObject = entityInterfaceData.isInterfaceObject;
            configurationData.entityInterfaceConcreteTypeNames = entityInterfaceData.concreteTypeNames;
          }
          const events = this.eventsConfigurations.get(newParentTypeName);
          if (events) {
            configurationData.events = events;
          }
          this.configurationDataByParentTypeName.set(newParentTypeName, configurationData);
          addFieldNamesToConfigurationData(parentDefinitionData.fieldDataByFieldName, configurationData);
          this.validateInterfaceImplementations(parentDefinitionData);
          definitions.push(this.getCompositeOutputNodeByData(parentDefinitionData));
          // interfaces and objects must define at least one field
          if (parentDefinitionData.fieldDataByFieldName.size < 1 && !isNodeQuery(parentTypeName, operationTypeNode)) {
            this.errors.push(noFieldDefinitionsError(kindToTypeString(parentDefinitionData.kind), parentTypeName));
          }
          break;
        case Kind.SCALAR_TYPE_DEFINITION:
          if (parentDefinitionData.extensionType === ExtensionType.REAL) {
            this.errors.push(noBaseScalarDefinitionError(parentTypeName));
            break;
          }
          removeIgnoredDirectives(parentDefinitionData);
          definitions.push(this.getScalarNodeByData(parentDefinitionData));
          break;
        case Kind.UNION_TYPE_DEFINITION:
          definitions.push(this.getUnionNodeByData(parentDefinitionData));
          this.validateUnionMembers(parentDefinitionData);
          break;
        default:
          throw unexpectedKindFatalError(parentTypeName);
      }
    }
    // Check that explicitly defined operations types are valid objects and that their fields are also valid
    for (const operationType of Object.values(OperationTypeNode)) {
      const operationTypeNode = this.schemaData.operationTypes.get(operationType);
      const defaultTypeName = getOrThrowError(operationTypeNodeToDefaultType, operationType, OPERATION_TO_DEFAULT);
      // If an operation type name was not declared, use the default
      const operationTypeName = operationTypeNode ? getTypeNodeNamedTypeName(operationTypeNode.type) : defaultTypeName;
      // If a custom type is used, the default type should not be defined
      if (operationTypeName !== defaultTypeName && this.parentDefinitionDataByTypeName.has(defaultTypeName)) {
        this.errors.push(invalidRootTypeDefinitionError(operationType, operationTypeName, defaultTypeName));
        continue;
      }
      const objectData = this.parentDefinitionDataByTypeName.get(operationTypeName);
      // operationTypeNode is truthy if an operation type was explicitly declared
      if (operationTypeNode) {
        // If the type is not defined in the schema, it's always an error
        if (!objectData) {
          this.errors.push(undefinedTypeError(operationTypeName));
          continue;
        }
        // Add the explicitly defined type to the map for the federation-factory
        this.operationTypeNodeByTypeName.set(operationTypeName, operationType);
      }
      if (!objectData) {
        continue;
      }
      const rootNode = this.configurationDataByParentTypeName.get(defaultTypeName);
      if (rootNode) {
        rootNode.isRootNode = true;
        rootNode.typeName = defaultTypeName;
      }
      if (objectData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        this.errors.push(operationDefinitionError(operationTypeName, operationType, objectData.kind));
        continue;
      }
      for (const fieldData of objectData.fieldDataByFieldName.values()) {
        const fieldTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
        if (!BASE_SCALARS.has(fieldTypeName) && !this.parentDefinitionDataByTypeName.has(fieldTypeName)) {
          this.errors.push(undefinedTypeError(fieldTypeName));
        }
      }
    }
    for (const referencedTypeName of this.referencedTypeNames) {
      const parentData = this.parentDefinitionDataByTypeName.get(referencedTypeName);
      if (parentData) {
        if (parentData.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
          continue;
        }
        // There will be a run time error if a Field can return an interface without any Object implementations.
        const implementationTypeNames = this.concreteTypeNamesByAbstractTypeName.get(referencedTypeName);
        if (!implementationTypeNames || implementationTypeNames.size < 0) {
          // Temporarily propagate as a warning until @inaccessible, entity interfaces and other such considerations are handled
          this.warnings.push(unimplementedInterfaceOutputTypeWarning(this.subgraphName, referencedTypeName));
        }
        continue;
      }
      if (!this.entityDataByTypeName.has(referencedTypeName)) {
        this.errors.push(undefinedTypeError(referencedTypeName));
      }
    }
    this.validateAndAddKeysToConfiguration();
    for (const [parentTypeName, fieldSetData] of this.fieldSetDataByTypeName) {
      const parentData = this.parentDefinitionDataByTypeName.get(parentTypeName);
      if (
        !parentData ||
        (parentData.kind !== Kind.OBJECT_TYPE_DEFINITION && parentData.kind !== Kind.INTERFACE_TYPE_DEFINITION)
      ) {
        this.errors.push(undefinedObjectLikeParentError(parentTypeName));
        continue;
      }
      // this is where keys, provides, and requires are added to the ConfigurationData
      validateAndAddConditionalFieldSetsToConfiguration(this, parentData, fieldSetData);
    }
    const persistedDirectiveDefinitionDataByDirectiveName = new Map<string, PersistedDirectiveDefinitionData>();
    for (const directiveDefinitionNode of this.directiveDefinitionByDirectiveName.values()) {
      // TODO @composeDirective directives would also be handled here
      const executableLocations = extractExecutableDirectiveLocations(
        directiveDefinitionNode.locations,
        new Set<string>(),
      );
      if (executableLocations.size < 1) {
        continue;
      }
      this.addPersistedDirectiveDefinitionDataByNode(
        persistedDirectiveDefinitionDataByDirectiveName,
        directiveDefinitionNode,
        executableLocations,
      );
    }
    this.isSubgraphEventDrivenGraph = this.edfsDirectiveReferences.size > 0;
    if (this.isSubgraphEventDrivenGraph) {
      this.validateEventDrivenSubgraph(definitions);
    }
    for (const fieldCoords of this.unvalidatedExternalFieldCoords) {
      if (this.isSubgraphVersionTwo) {
        this.errors.push(invalidExternalDirectiveError(fieldCoords));
      } else {
        this.warnings.push(invalidExternalFieldWarning(fieldCoords, this.subgraphName));
      }
    }
    if (this.errors.length > 0) {
      return { success: false, errors: this.errors, warnings: this.warnings };
    }
    const newAST: DocumentNode = {
      kind: Kind.DOCUMENT,
      definitions,
    };
    return {
      authorizationDataByParentTypeName: this.authorizationDataByParentTypeName,
      // configurationDataMap is map of ConfigurationData per type name.
      // It is an Intermediate configuration object that will be converted to an engine configuration in the router
      concreteTypeNamesByAbstractTypeName: this.concreteTypeNamesByAbstractTypeName,
      conditionalFieldDataByCoordinates: this.conditionalFieldDataByCoordinates,
      configurationDataByTypeName: this.configurationDataByParentTypeName,
      entityDataByTypeName: this.entityDataByTypeName,
      entityInterfaces: this.entityInterfaceDataByTypeName,
      isEventDrivenGraph: this.isSubgraphEventDrivenGraph,
      isVersionTwo: this.isSubgraphVersionTwo,
      keyFieldNamesByParentTypeName: this.keyFieldNamesByParentTypeName,
      operationTypes: this.operationTypeNodeByTypeName,
      originalTypeNameByRenamedTypeName: this.originalTypeNameByRenamedTypeName,
      overridesByTargetSubgraphName: this.overridesByTargetSubgraphName,
      parentDefinitionDataByTypeName: this.parentDefinitionDataByTypeName,
      persistedDirectiveDefinitionDataByDirectiveName,
      subgraphAST: newAST,
      subgraphString: print(newAST),
      schema: buildASTSchema(newAST, { assumeValid: true, assumeValidSDL: true }),
      success: true,
      warnings: this.warnings,
    };
  }
}

export function batchNormalize(subgraphs: Subgraph[]): BatchNormalizationResult {
  const authorizationDataByParentTypeName = new Map<string, AuthorizationData>();
  const concreteTypeNamesByAbstractTypeName = new Map<string, Set<string>>();
  const entityDataByTypeName = new Map<string, EntityData>();
  const internalSubgraphBySubgraphName = new Map<string, InternalSubgraph>();
  const allOverridesByTargetSubgraphName = new Map<string, Map<string, Set<string>>>();
  const overrideSourceSubgraphNamesByFieldPath = new Map<string, string[]>();
  const duplicateOverriddenFieldPaths = new Set<string>();
  const parentDefinitionDataMapsBySubgraphName = new Map<string, Map<string, ParentDefinitionData>>();
  const subgraphNames = new Set<string>();
  const nonUniqueSubgraphNames = new Set<string>();
  const invalidNameErrorMessages: string[] = [];
  const invalidOrScopesHostPaths = new Set<string>();
  const warnings: Array<Warning> = [];
  const validationErrors: Array<Error> = [];
  // Record the subgraph names first, so that subgraph references can be validated
  for (const subgraph of subgraphs) {
    if (subgraph.name) {
      recordSubgraphName(subgraph.name, subgraphNames, nonUniqueSubgraphNames);
    }
  }
  const internalGraph = new Graph();
  for (let i = 0; i < subgraphs.length; i++) {
    const subgraph = subgraphs[i];
    const subgraphName = subgraph.name || `subgraph-${i}-${Date.now()}`;
    if (!subgraph.name) {
      invalidNameErrorMessages.push(invalidSubgraphNameErrorMessage(i, subgraphName));
    }
    const normalizationResult = normalizeSubgraph(subgraph.definitions, subgraph.name, internalGraph);
    if (normalizationResult.warnings.length > 0) {
      warnings.push(...normalizationResult.warnings);
    }
    if (!normalizationResult.success) {
      validationErrors.push(subgraphValidationError(subgraphName, normalizationResult.errors));
      continue;
    }
    if (!normalizationResult) {
      validationErrors.push(subgraphValidationError(subgraphName, [subgraphValidationFailureError]));
      continue;
    }

    parentDefinitionDataMapsBySubgraphName.set(subgraphName, normalizationResult.parentDefinitionDataByTypeName);

    for (const authorizationData of normalizationResult.authorizationDataByParentTypeName.values()) {
      upsertAuthorizationData(authorizationDataByParentTypeName, authorizationData, invalidOrScopesHostPaths);
    }
    for (const [
      abstractTypeName,
      incomingConcreteTypeNames,
    ] of normalizationResult.concreteTypeNamesByAbstractTypeName) {
      const existingConcreteTypeNames = concreteTypeNamesByAbstractTypeName.get(abstractTypeName);
      if (!existingConcreteTypeNames) {
        concreteTypeNamesByAbstractTypeName.set(abstractTypeName, new Set<string>(incomingConcreteTypeNames));
        continue;
      }
      addIterableValuesToSet(incomingConcreteTypeNames, existingConcreteTypeNames);
    }
    for (const entityData of normalizationResult.entityDataByTypeName.values()) {
      upsertEntityData(entityDataByTypeName, entityData);
    }
    if (subgraph.name) {
      internalSubgraphBySubgraphName.set(subgraphName, {
        conditionalFieldDataByCoordinates: normalizationResult.conditionalFieldDataByCoordinates,
        configurationDataByTypeName: normalizationResult.configurationDataByTypeName,
        definitions: normalizationResult.subgraphAST,
        entityInterfaces: normalizationResult.entityInterfaces,
        isVersionTwo: normalizationResult.isVersionTwo,
        keyFieldNamesByParentTypeName: normalizationResult.keyFieldNamesByParentTypeName,
        name: subgraphName,
        operationTypes: normalizationResult.operationTypes,
        overriddenFieldNamesByParentTypeName: new Map<string, Set<string>>(),
        parentDefinitionDataByTypeName: normalizationResult.parentDefinitionDataByTypeName,
        persistedDirectiveDefinitionDataByDirectiveName:
          normalizationResult.persistedDirectiveDefinitionDataByDirectiveName,
        schema: normalizationResult.schema,
        url: subgraph.url,
      });
    }
    if (normalizationResult.overridesByTargetSubgraphName.size < 1) {
      continue;
    }
    for (const [targetSubgraphName, overridesData] of normalizationResult.overridesByTargetSubgraphName) {
      const isTargetValid = subgraphNames.has(targetSubgraphName);
      for (const [parentTypeName, fieldNames] of overridesData) {
        /* It's possible for a renamed root type to have a field overridden, so make sure any errors at this stage are
           propagated with the original typename. */
        const originalParentTypeName =
          normalizationResult.originalTypeNameByRenamedTypeName.get(parentTypeName) || parentTypeName;
        if (!isTargetValid) {
          warnings.push(
            invalidOverrideTargetSubgraphNameWarning(
              targetSubgraphName,
              originalParentTypeName,
              [...fieldNames],
              subgraph.name,
            ),
          );
        } else {
          const overridesData = getValueOrDefault(
            allOverridesByTargetSubgraphName,
            targetSubgraphName,
            () => new Map<string, Set<string>>(),
          );
          const existingFieldNames = getValueOrDefault(
            overridesData,
            parentTypeName,
            () => new Set<string>(fieldNames),
          );
          addIterableValuesToSet(fieldNames, existingFieldNames);
        }
        for (const fieldName of fieldNames) {
          const fieldPath = `${originalParentTypeName}.${fieldName}`;
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
  }
  const allErrors: Array<Error> = [];
  if (invalidOrScopesHostPaths.size > 0) {
    allErrors.push(orScopesLimitError(maxOrScopes, [...invalidOrScopesHostPaths]));
  }
  if (invalidNameErrorMessages.length > 0 || nonUniqueSubgraphNames.size > 0) {
    allErrors.push(invalidSubgraphNamesError([...nonUniqueSubgraphNames], invalidNameErrorMessages));
  }
  if (duplicateOverriddenFieldPaths.size > 0) {
    const duplicateOverriddenFieldErrorMessages: string[] = [];
    for (const fieldPath of duplicateOverriddenFieldPaths) {
      const sourceSubgraphNames = getOrThrowError(
        overrideSourceSubgraphNamesByFieldPath,
        fieldPath,
        'overrideSourceSubgraphNamesByFieldPath',
      );
      duplicateOverriddenFieldErrorMessages.push(duplicateOverriddenFieldErrorMessage(fieldPath, sourceSubgraphNames));
    }
    allErrors.push(duplicateOverriddenFieldsError(duplicateOverriddenFieldErrorMessages));
  }
  allErrors.push(...validationErrors);
  if (allErrors.length > 0) {
    return {
      errors: allErrors,
      success: false,
      warnings,
    };
  }
  for (const [targetSubgraphName, overridesData] of allOverridesByTargetSubgraphName) {
    const internalSubgraph = getOrThrowError(
      internalSubgraphBySubgraphName,
      targetSubgraphName,
      'internalSubgraphBySubgraphName',
    );
    internalSubgraph.overriddenFieldNamesByParentTypeName = overridesData;
    for (const [parentTypeName, fieldNames] of overridesData) {
      const configurationData = internalSubgraph.configurationDataByTypeName.get(parentTypeName);
      if (!configurationData) {
        continue;
      }
      subtractSourceSetFromTargetSet(fieldNames, configurationData.fieldNames);
      if (configurationData.fieldNames.size < 1) {
        internalSubgraph.configurationDataByTypeName.delete(parentTypeName);
      }
    }
  }

  return {
    authorizationDataByParentTypeName,
    concreteTypeNamesByAbstractTypeName,
    entityDataByTypeName,
    internalSubgraphBySubgraphName: internalSubgraphBySubgraphName,
    internalGraph,
    success: true,
    warnings,
  };
}
