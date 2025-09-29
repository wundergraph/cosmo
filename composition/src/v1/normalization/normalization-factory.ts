import {
  BREAK,
  ConstDirectiveNode,
  ConstValueNode,
  DefinitionNode,
  DirectiveDefinitionNode,
  DocumentNode,
  EnumValueDefinitionNode,
  FieldDefinitionNode,
  InputValueDefinitionNode,
  InterfaceTypeDefinitionNode,
  InterfaceTypeExtensionNode,
  IntValueNode,
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
  visit,
} from 'graphql';
import {
  EnumTypeNode,
  extractExecutableDirectiveLocations,
  formatDescription,
  InputObjectTypeNode,
  InterfaceTypeNode,
  isKindAbstract,
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
  getConditionalFieldSetDirectiveName,
  getInitialFieldCoordsPath,
  getNormalizedFieldSet,
  initializeDirectiveDefinitionDatas,
  isNodeQuery,
  validateArgumentTemplateReferences,
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
  MAX_OR_SCOPES,
  ONE_OF_DEFINITION,
  REQUIRE_FETCH_REASONS_DEFINITION,
  SCOPE_SCALAR_DEFINITION,
  SEMANTIC_NON_NULL_DEFINITION,
  SUBSCRIPTION_FIELD_CONDITION_DEFINITION,
  SUBSCRIPTION_FILTER_CONDITION_DEFINITION,
  SUBSCRIPTION_FILTER_DEFINITION,
  SUBSCRIPTION_FILTER_VALUE_DEFINITION,
  V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME,
  VERSION_TWO_DIRECTIVE_DEFINITIONS,
} from '../utils/constants';
import {
  addScopes,
  fieldDatasToSimpleFieldDatas,
  isNodeKindObject,
  kindToConvertedTypeString,
  mapToArrayOfValues,
  newAuthorizationData,
  newFieldAuthorizationData,
  subtractSet,
  upsertAuthorizationData,
  upsertEntityData,
} from '../utils/utils';
import {
  configureDescriptionNoDescriptionError,
  duplicateArgumentsError,
  duplicateDirectiveArgumentDefinitionsErrorMessage,
  duplicateDirectiveDefinitionArgumentErrorMessage,
  duplicateDirectiveDefinitionError,
  duplicateDirectiveDefinitionLocationErrorMessage,
  duplicateFieldInFieldSetErrorMessage,
  duplicateImplementedInterfaceError,
  duplicateOverriddenFieldErrorMessage,
  duplicateOverriddenFieldsError,
  duplicateTypeDefinitionError,
  duplicateUnionMemberDefinitionError,
  equivalentSourceAndTargetOverrideErrorMessage,
  expectedEntityError,
  externalInterfaceFieldsError,
  fieldAlreadyProvidedErrorMessage,
  incompatibleInputValueDefaultValueTypeError,
  incompatibleTypeWithProvidesErrorMessage,
  inlineFragmentWithoutTypeConditionErrorMessage,
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
  invalidInlineFragmentTypeConditionErrorMessage,
  invalidInlineFragmentTypeConditionTypeErrorMessage,
  invalidInlineFragmentTypeErrorMessage,
  invalidInterfaceImplementationError,
  invalidKeyFieldSetsEventDrivenErrorMessage,
  invalidNamedTypeError,
  invalidNatsStreamConfigurationDefinitionErrorMessage,
  invalidNatsStreamInputErrorMessage,
  invalidNatsStreamInputFieldsErrorMessage,
  invalidProvidesOrRequiresDirectivesError,
  invalidRepeatedDirectiveErrorMessage,
  invalidRootTypeDefinitionError,
  invalidRootTypeError,
  invalidRootTypeFieldEventsDirectivesErrorMessage,
  invalidRootTypeFieldResponseTypesEventDrivenErrorMessage,
  invalidSelectionOnUnionErrorMessage,
  invalidSelectionSetDefinitionErrorMessage,
  invalidSelectionSetErrorMessage,
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
  nonExternalConditionalFieldError,
  nonExternalKeyFieldNamesEventDrivenErrorMessage,
  nonKeyComposingObjectTypeNamesEventDrivenErrorMessage,
  nonKeyFieldNamesEventDrivenErrorMessage,
  oneOfRequiredFieldsError,
  operationDefinitionError,
  orScopesLimitError,
  selfImplementationError,
  semanticNonNullArgumentErrorMessage,
  semanticNonNullLevelsIndexOutOfBoundsErrorMessage,
  semanticNonNullLevelsNaNIndexErrorMessage,
  semanticNonNullLevelsNonNullErrorMessage,
  subgraphInvalidSyntaxError,
  subgraphValidationError,
  subgraphValidationFailureError,
  undefinedCompositeOutputTypeError,
  undefinedDirectiveError,
  undefinedFieldInFieldSetErrorMessage,
  undefinedRequiredArgumentsErrorMessage,
  undefinedTypeError,
  unexpectedDirectiveArgumentErrorMessage,
  unexpectedKindFatalError,
  unknownInlineFragmentTypeConditionErrorMessage,
  unknownNamedTypeErrorMessage,
  unknownTypeInFieldSetErrorMessage,
  unparsableFieldSetErrorMessage,
  unparsableFieldSetSelectionErrorMessage,
} from '../../errors/errors';
import {
  EVENT_DIRECTIVE_NAMES,
  STREAM_CONFIGURATION_FIELD_NAMES,
  TYPE_SYSTEM_DIRECTIVE_LOCATIONS,
} from '../utils/string-constants';
import { buildASTSchema } from '../../buildASTSchema/buildASTSchema';
import {
  ConfigurationData,
  EventConfiguration,
  NatsEventType,
  RequiredFieldConfiguration,
} from '../../router-configuration/types';
import { printTypeNode } from '@graphql-tools/merge';
import { recordSubgraphName } from '../subgraph/subgraph';
import {
  consumerInactiveThresholdInvalidValueWarning,
  externalEntityExtensionKeyFieldWarning,
  externalInterfaceFieldsWarning,
  fieldAlreadyProvidedWarning,
  invalidExternalFieldWarning,
  invalidOverrideTargetSubgraphNameWarning,
  nonExternalConditionalFieldWarning,
  singleSubgraphInputFieldOneOfWarning,
  unimplementedInterfaceOutputTypeWarning,
} from '../warnings/warnings';
import { upsertDirectiveSchemaAndEntityDefinitions, upsertParentsAndChildren } from './walkers';
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
  ExternalFieldData,
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
  isFieldData,
  isInputNodeKind,
  isNodeExternalOrShareable,
  isOutputNodeKind,
  isTypeRequired,
  isTypeValidImplementation,
  newConditionalFieldData,
  newExternalFieldData,
  newPersistedDirectivesData,
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
  MutableTypeNode,
} from '../../schema-building/ast';
import { InvalidRootTypeFieldEventsDirectiveData } from '../../errors/types';
import { Graph } from '../../resolvability-graph/graph';
import { DEFAULT_CONSUMER_INACTIVE_THRESHOLD } from '../utils/integer-constants';
import { InternalSubgraph, Subgraph } from '../../subgraph/types';
import { Warning } from '../../warnings/types';
import { BatchNormalizationResult, NormalizationResult } from '../../normalization/types';
import {
  ARGUMENT,
  AUTHENTICATED,
  BOOLEAN_SCALAR,
  CHANNEL,
  CHANNELS,
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
  EDFS_REDIS_PUBLISH,
  EDFS_REDIS_SUBSCRIBE,
  ENTITIES_FIELD,
  EXECUTABLE_DIRECTIVE_LOCATIONS,
  EXECUTION,
  EXTENDS,
  EXTERNAL,
  FIELD_SET_SCALAR,
  FIELDS,
  FLOAT_SCALAR,
  HYPHEN_JOIN,
  ID_SCALAR,
  INACCESSIBLE,
  INHERITABLE_DIRECTIVE_NAMES,
  INPUT_FIELD,
  INT_SCALAR,
  INTERFACE_OBJECT,
  KEY,
  LEVELS,
  LINK,
  LINK_IMPORT,
  LINK_PURPOSE,
  MUTATION,
  NON_NULLABLE_BOOLEAN,
  NON_NULLABLE_EDFS_PUBLISH_EVENT_RESULT,
  NON_NULLABLE_INT,
  NON_NULLABLE_STRING,
  NOT_APPLICABLE,
  ONE_OF,
  OPERATION_TO_DEFAULT,
  OVERRIDE,
  PROPAGATE,
  PROVIDER_ID,
  PROVIDER_TYPE_KAFKA,
  PROVIDER_TYPE_NATS,
  PROVIDER_TYPE_REDIS,
  PUBLISH,
  QUERY,
  REQUEST,
  REQUIRE_FETCH_REASONS,
  REQUIRES_SCOPES,
  RESOLVABLE,
  ROOT_TYPE_NAMES,
  SCHEMA,
  SCOPE_SCALAR,
  SCOPES,
  SECURITY,
  SEMANTIC_NON_NULL,
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
import {
  addIterableValuesToSet,
  generateSimpleDirective,
  getEntriesNotInHashSet,
  getFirstEntry,
  getOrThrowError,
  getValueOrDefault,
  kindToNodeType,
  numberToOrdinal,
} from '../../utils/utils';
import {
  AddInputValueDataByNodeParams,
  ConditionalFieldSetValidationResult,
  ExtractArgumentDataResult,
  FieldSetData,
  FieldSetParentResult,
  HandleOverrideDirectiveParams,
  HandleRequiresScopesDirectiveParams,
  HandleSemanticNonNullDirectiveParams,
  KeyFieldSetData,
  ValidateDirectiveParams,
} from './types';
import { newConfigurationData, newFieldSetConditionData } from '../../router-configuration/utils';
import { ImplementationErrors, InvalidFieldImplementation } from '../../utils/types';
import { FieldName, SubgraphName } from '../../types/types';
import { ValidateOneOfDirectiveParams } from './params';

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
  concreteTypeNamesByAbstractTypeName = new Map<string, Set<string>>();
  conditionalFieldDataByCoords = new Map<string, ConditionalFieldData>();
  configurationDataByTypeName = new Map<string, ConfigurationData>();
  customDirectiveDefinitions = new Map<string, DirectiveDefinitionNode>();
  definedDirectiveNames = new Set<string>();
  directiveDefinitionByDirectiveName = new Map<string, DirectiveDefinitionNode>();
  directiveDefinitionDataByDirectiveName = initializeDirectiveDefinitionDatas();
  doesParentObjectRequireFetchReasons = false;
  edfsDirectiveReferences = new Set<string>();
  errors: Error[] = [];
  entityDataByTypeName = new Map<string, EntityData>();
  entityInterfaceDataByTypeName = new Map<string, EntityInterfaceSubgraphData>();
  eventsConfigurations = new Map<string, EventConfiguration[]>();
  fieldSetDataByTypeName = new Map<string, FieldSetData>();
  internalGraph: Graph;
  invalidConfigureDescriptionNodeDatas: Array<NodeData> = [];
  invalidORScopesCoords = new Set<string>();
  invalidRepeatedDirectiveNameByCoords = new Map<string, Set<string>>();
  isCurrentParentExtension = false;
  isParentObjectExternal = false;
  isParentObjectShareable = false;
  isSubgraphEventDrivenGraph = false;
  isSubgraphVersionTwo = false;
  keyFieldSetDatasByTypeName = new Map<string, Map<string, KeyFieldSetData>>();
  lastParentNodeKind: Kind = Kind.NULL;
  lastChildNodeKind: Kind = Kind.NULL;
  parentTypeNamesWithAuthDirectives = new Set<string>();
  keyFieldSetDataByTypeName = new Map<string, KeyFieldSetData>();
  keyFieldSetsByEntityTypeNameByFieldCoords = new Map<string, Map<string, Set<string>>>();
  keyFieldNamesByParentTypeName = new Map<string, Set<string>>();
  fieldCoordsByNamedTypeName = new Map<string, Set<string>>();
  operationTypeNodeByTypeName = new Map<string, OperationTypeNode>();
  originalParentTypeName = '';
  originalTypeNameByRenamedTypeName = new Map<string, string>();
  overridesByTargetSubgraphName = new Map<string, Map<string, Set<string>>>();
  parentDefinitionDataByTypeName = new Map<string, ParentDefinitionData>();
  schemaData: SchemaData;
  referencedDirectiveNames = new Set<string>();
  referencedTypeNames = new Set<string>();
  renamedParentTypeName = '';
  subgraphName: string;
  unvalidatedExternalFieldCoords = new Set<string>();
  usesEdfsNatsStreamConfiguration: boolean = false;
  warnings: Array<Warning> = [];

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

  validateArguments(fieldData: FieldData, parentKind: Kind) {
    for (const argumentData of fieldData.argumentDataByName.values()) {
      const namedTypeName = getTypeNodeNamedTypeName(argumentData.type);
      if (BASE_SCALARS.has(namedTypeName)) {
        argumentData.namedTypeKind = Kind.SCALAR_TYPE_DEFINITION;
        continue;
      }
      const namedTypeData = this.parentDefinitionDataByTypeName.get(namedTypeName);
      if (!namedTypeData) {
        // undefined types are handled elsewhere
        continue;
      }
      if (isInputNodeKind(namedTypeData.kind)) {
        argumentData.namedTypeKind = namedTypeData.kind;
        continue;
      }
      this.errors.push(
        invalidNamedTypeError({
          data: argumentData,
          namedTypeData,
          nodeType: `${kindToNodeType(parentKind)} field argument`,
        }),
      );
    }
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

  addInheritedDirectivesToFieldData(
    fieldDirectivesByDirectiveName: Map<string, Array<ConstDirectiveNode>>,
    inheritedDirectiveNames: Set<string>,
  ) {
    if (this.isParentObjectExternal && !fieldDirectivesByDirectiveName.has(EXTERNAL)) {
      fieldDirectivesByDirectiveName.set(EXTERNAL, [generateSimpleDirective(EXTERNAL)]);
      inheritedDirectiveNames.add(EXTERNAL);
    }
    if (this.doesParentObjectRequireFetchReasons && !fieldDirectivesByDirectiveName.has(REQUIRE_FETCH_REASONS)) {
      fieldDirectivesByDirectiveName.set(REQUIRE_FETCH_REASONS, [generateSimpleDirective(REQUIRE_FETCH_REASONS)]);
      inheritedDirectiveNames.add(REQUIRE_FETCH_REASONS);
    }
    if (this.isParentObjectShareable && !fieldDirectivesByDirectiveName.has(SHAREABLE)) {
      fieldDirectivesByDirectiveName.set(SHAREABLE, [generateSimpleDirective(SHAREABLE)]);
      inheritedDirectiveNames.add(SHAREABLE);
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
      this.doesParentObjectRequireFetchReasons ||= directiveName === REQUIRE_FETCH_REASONS;
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
    const isField = isFieldData(data);
    const isOverride = directiveName === OVERRIDE;
    const isRequiresScopes = directiveName === REQUIRES_SCOPES;
    const isSemanticNonNull = directiveName === SEMANTIC_NON_NULL;
    if (!directiveNode.arguments || directiveNode.arguments.length < 1) {
      if (definitionData.requiredArgumentNames.size > 0) {
        errorMessages.push(undefinedRequiredArgumentsErrorMessage(directiveName, requiredArgumentNames, []));
      }
      if (isAuthenticated) {
        this.handleAuthenticatedDirective(data, parentTypeName);
      }
      if (isSemanticNonNull && isField) {
        // The default argument for levels is [0], so a non-null wrapper is invalid.
        if (isTypeRequired(data.type)) {
          errorMessages.push(
            semanticNonNullLevelsNonNullErrorMessage({
              typeString: printTypeNode(data.type),
              value: '0',
            }),
          );
        } else {
          data.nullLevelsBySubgraphName.set(this.subgraphName, new Set<number>([0]));
        }
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
      /* Individual directives are handled in the loop because they validate a single argument, and duplicate
       * arguments would short-circuit.
       * The directive location validation means the node kind check should be unnecessary
       * */
      if (isOverride && isField) {
        this.handleOverrideDirective({
          data,
          directiveCoords,
          errorMessages,
          targetSubgraphName: (argumentNode.value as StringValueNode).value,
        });
        continue;
      }
      if (isSemanticNonNull && isField) {
        this.handleSemanticNonNullDirective({
          data,
          directiveNode,
          errorMessages,
        });
        continue;
      }
      if (!isRequiresScopes || argumentName !== SCOPES) {
        continue;
      }
      this.extractRequiredScopes({
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
    const parentAuthorizationData = getValueOrDefault(this.authorizationDataByParentTypeName, parentTypeName, () =>
      newAuthorizationData(parentTypeName),
    );
    if (data.kind !== Kind.FIELD_DEFINITION) {
      this.parentTypeNamesWithAuthDirectives.add(parentTypeName);
      parentAuthorizationData.requiredScopes.push(...requiredScopes);
    } else {
      const fieldAuthData = getValueOrDefault(parentAuthorizationData.fieldAuthDataByFieldName, data.name, () =>
        newFieldAuthorizationData(data.name),
      );
      fieldAuthData.inheritedData.requiredScopes.push(...requiredScopes);
      fieldAuthData.originalData.requiredScopes.push(...requiredScopes);
    }
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
        for (const [argumentName, argumentData] of data.argumentDataByName) {
          this.validateDirectives(argumentData, `${data.originalParentTypeName}.${data.name}(${argumentName}: ...)`);
        }
        return;
      }
      case Kind.INPUT_OBJECT_TYPE_DEFINITION: {
        for (const [inputValueName, inputValueData] of data.inputValueDataByName) {
          this.validateDirectives(inputValueData, `${data.name}.${inputValueName}`);
        }
        return;
      }
      case Kind.INTERFACE_TYPE_DEFINITION:
      // intentional fallthrough
      case Kind.OBJECT_TYPE_DEFINITION: {
        for (const [fieldName, fieldData] of data.fieldDataByName) {
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
     * 2. It's a V2 subgraph (but extends is temporarily propagated to handle @external key fields)
     * 3. And (of course) if @extends isn't defined at all
     */
    if (isRootType || !directivesByDirectiveName.has(EXTENDS)) {
      return ExtensionType.NONE;
    }
    // If a V1 non-root Object defines @extends, it is considered an extension across subgraphs.
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
        this.errors.push(duplicateTypeDefinitionError(kindToNodeType(parentData.kind), parentData.name));
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
    argumentDataByName: Map<string, InputValueData>,
    node: FieldDefinitionNode,
  ): Map<string, InputValueData> {
    if (!node.arguments?.length) {
      return argumentDataByName;
    }
    const fieldName = node.name.value;
    const originalFieldPath = `${this.originalParentTypeName}.${fieldName}`;
    const duplicatedArguments = new Set<string>();
    for (const argumentNode of node.arguments) {
      const argumentName = argumentNode.name.value;
      if (argumentDataByName.has(argumentName)) {
        duplicatedArguments.add(argumentName);
        continue;
      }
      this.addInputValueDataByNode({
        fieldName,
        inputValueDataByName: argumentDataByName,
        isArgument: true,
        node: argumentNode,
        originalParentTypeName: this.originalParentTypeName,
        renamedParentTypeName: this.renamedParentTypeName,
      });
    }
    if (duplicatedArguments.size > 0) {
      this.errors.push(duplicateArgumentsError(originalFieldPath, [...duplicatedArguments]));
    }
    return argumentDataByName;
  }

  addPersistedDirectiveDefinitionDataByNode(
    persistedDirectiveDefinitionDataByDirectiveName: Map<string, PersistedDirectiveDefinitionData>,
    node: DirectiveDefinitionNode,
    executableLocations: Set<string>,
  ) {
    const name = node.name.value;
    const directiveName = `@${name}`;
    const argumentDataByName = new Map<string, InputValueData>();
    for (const argumentNode of node.arguments || []) {
      this.addInputValueDataByNode({
        inputValueDataByName: argumentDataByName,
        isArgument: true,
        node: argumentNode,
        originalParentTypeName: directiveName,
      });
    }
    persistedDirectiveDefinitionDataByDirectiveName.set(name, {
      argumentDataByArgumentName: argumentDataByName,
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
    inheritedDirectiveNames: Set<string> = new Set<string>(),
  ): FieldData {
    const name = node.name.value;
    const parentTypeName = this.renamedParentTypeName || this.originalParentTypeName;
    const fieldCoords = `${this.originalParentTypeName}.${name}`;
    const { isExternal, isShareable } = isNodeExternalOrShareable(
      node,
      !this.isSubgraphVersionTwo,
      directivesByDirectiveName,
    );
    const namedTypeName = getTypeNodeNamedTypeName(node.type);
    const fieldData: FieldData = {
      argumentDataByName: argumentDataByArgumentName,
      configureDescriptionDataBySubgraphName: new Map<string, ConfigureDescriptionData>(),
      externalFieldDataBySubgraphName: new Map<string, ExternalFieldData>([
        [this.subgraphName, newExternalFieldData(isExternal)],
      ]),
      federatedCoords: `${parentTypeName}.${name}`,
      inheritedDirectiveNames,
      isInaccessible: directivesByDirectiveName.has(INACCESSIBLE),
      isShareableBySubgraphName: new Map<string, boolean>([[this.subgraphName, isShareable]]),
      kind: Kind.FIELD_DEFINITION,
      name,
      namedTypeKind: BASE_SCALARS.has(namedTypeName) ? Kind.SCALAR_TYPE_DEFINITION : Kind.NULL,
      namedTypeName,
      node: getMutableFieldNode(node, fieldCoords, this.errors),
      nullLevelsBySubgraphName: new Map<SubgraphName, Set<number>>(),
      originalParentTypeName: this.originalParentTypeName,
      persistedDirectivesData: newPersistedDirectivesData(),
      renamedParentTypeName: parentTypeName,
      subgraphNames: new Set<string>([this.subgraphName]),
      type: getMutableTypeNode(node.type, fieldCoords, this.errors),
      directivesByDirectiveName,
      description: formatDescription(node.description),
    };
    if (!BASE_SCALARS.has(fieldData.namedTypeName)) {
      this.referencedTypeNames.add(fieldData.namedTypeName);
    }
    this.extractConfigureDescriptionsData(fieldData);
    fieldDataByFieldName.set(name, fieldData);
    return fieldData;
  }

  addInputValueDataByNode({
    fieldName,
    inputValueDataByName,
    isArgument,
    node,
    originalParentTypeName,
    renamedParentTypeName,
  }: AddInputValueDataByNodeParams) {
    const federatedParentTypeName = renamedParentTypeName || originalParentTypeName;
    const name = node.name.value;
    // directives do not have field names
    const originalCoords = isArgument
      ? `${originalParentTypeName}${fieldName ? `.${fieldName}` : ''}(${name}: ...)`
      : `${originalParentTypeName}.${name}`;
    if (node.defaultValue && !areDefaultValuesCompatible(node.type, node.defaultValue)) {
      this.errors.push(
        incompatibleInputValueDefaultValueTypeError(
          (isArgument ? ARGUMENT : INPUT_FIELD) + ` "${name}"`,
          originalCoords,
          printTypeNode(node.type),
          print(node.defaultValue),
        ),
      );
    }
    const federatedCoords = isArgument
      ? `${federatedParentTypeName}${fieldName ? `.${fieldName}` : ''}(${name}: ...)`
      : `${federatedParentTypeName}.${name}`;
    const namedTypeName = getTypeNodeNamedTypeName(node.type);
    const inputValueData: InputValueData = {
      configureDescriptionDataBySubgraphName: new Map<string, ConfigureDescriptionData>(),
      directivesByDirectiveName: this.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
      federatedCoords,
      fieldName,
      includeDefaultValue: !!node.defaultValue,
      isArgument,
      kind: isArgument ? Kind.ARGUMENT : Kind.INPUT_VALUE_DEFINITION,
      name,
      namedTypeKind: BASE_SCALARS.has(namedTypeName) ? Kind.SCALAR_TYPE_DEFINITION : Kind.NULL,
      namedTypeName,
      node: getMutableInputValueNode(node, originalParentTypeName, this.errors),
      originalCoords,
      originalParentTypeName: originalParentTypeName,
      persistedDirectivesData: newPersistedDirectivesData(),
      renamedParentTypeName: federatedParentTypeName,
      requiredSubgraphNames: new Set<string>(isTypeRequired(node.type) ? [this.subgraphName] : []),
      subgraphNames: new Set<string>([this.subgraphName]),
      type: getMutableTypeNode(node.type, originalParentTypeName, this.errors),
      defaultValue: node.defaultValue, // TODO validate
      description: formatDescription(node.description),
    };
    this.extractConfigureDescriptionsData(inputValueData);
    inputValueDataByName.set(name, inputValueData);
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
            kindToNodeType(parentData.kind),
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
      fieldDataByName: new Map<string, FieldData>(),
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
      parentData?.directivesByDirectiveName ?? new Map<string, ConstDirectiveNode[]>(),
    );
    const isRootType = this.isTypeNameRootType(typeName);
    const extensionType = this.getNodeExtensionType(isRealExtension, directivesByDirectiveName, isRootType);
    this.addInterfaceObjectFieldsByNode(node);
    if (parentData) {
      if (parentData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        this.errors.push(
          multipleNamedTypeDefinitionError(
            typeName,
            kindToNodeType(parentData.kind),
            kindToConvertedTypeString(node.kind),
          ),
        );
        return;
      }
      this.updateCompositeOutputDataByNode(node, parentData, extensionType);
      if (!directivesByDirectiveName.has(INTERFACE_OBJECT)) {
        this.addConcreteTypeNamesForImplementedInterfaces(parentData.implementedInterfaceTypeNames, typeName);
      }
      return;
    }
    const implementedInterfaceTypeNames = this.extractImplementedInterfaceTypeNames(node, new Set<string>());
    if (!directivesByDirectiveName.has(INTERFACE_OBJECT)) {
      this.addConcreteTypeNamesForImplementedInterfaces(implementedInterfaceTypeNames, typeName);
    }
    const newParentData: ObjectDefinitionData = {
      configureDescriptionDataBySubgraphName: new Map<string, ConfigureDescriptionData>(),
      directivesByDirectiveName,
      extensionType,
      fieldDataByName: new Map<string, FieldData>(),
      implementedInterfaceTypeNames,
      isEntity: directivesByDirectiveName.has(KEY),
      isInaccessible: directivesByDirectiveName.has(INACCESSIBLE),
      isRootType,
      kind: Kind.OBJECT_TYPE_DEFINITION,
      name: typeName,
      node: getMutableObjectNode(node.name),
      persistedDirectivesData: newPersistedDirectivesData(),
      requireFetchReasonsFieldNames: new Set<FieldName>(),
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
            kindToNodeType(parentData.kind),
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
    const newParentData: EnumDefinitionData = {
      appearances: 1,
      configureDescriptionDataBySubgraphName: new Map<string, ConfigureDescriptionData>(),
      directivesByDirectiveName,
      extensionType,
      enumValueDataByValueName: new Map<string, EnumValueData>(),
      isInaccessible: directivesByDirectiveName.has(INACCESSIBLE),
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
            kindToNodeType(parentData.kind),
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
      inputValueDataByName: new Map<string, InputValueData>(),
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
            kindToNodeType(parentData.kind),
            kindToConvertedTypeString(node.kind),
          ),
        );
        return;
      }
      this.setParentDataExtensionType(parentData, extensionType);
      parentData.description ||= formatDescription('description' in node ? node.description : undefined);
      parentData.subgraphNames.add(this.subgraphName);
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
      subgraphNames: new Set([this.subgraphName]),
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
            kindToNodeType(parentData.kind),
            kindToConvertedTypeString(node.kind),
          ),
        );
        return;
      }
      this.setParentDataExtensionType(parentData, extensionType);
      this.extractUnionMembers(node, parentData.memberByMemberTypeName);
      parentData.description ||= formatDescription('description' in node ? node.description : undefined);
      parentData.subgraphNames.add(this.subgraphName);
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
      subgraphNames: new Set([this.subgraphName]),
      description: formatDescription('description' in node ? node.description : undefined),
    };
    this.extractConfigureDescriptionsData(newParentData);
    this.parentDefinitionDataByTypeName.set(typeName, newParentData);
  }

  extractKeyFieldSets(node: CompositeOutputNode, keyFieldSetDataByFieldSet: Map<string, KeyFieldSetData>) {
    const parentTypeName = node.name.value;
    if (!node.directives?.length) {
      // This should never happen
      this.errors.push(expectedEntityError(parentTypeName));
      return;
    }
    // full validation happens elsewhere
    let keyNumber = 0;
    for (const directive of node.directives) {
      if (directive.name.value !== KEY) {
        continue;
      }
      keyNumber += 1;
      if (!directive.arguments || directive.arguments.length < 1) {
        continue;
      }
      let rawFieldSet;
      let isUnresolvable = false;
      for (const arg of directive.arguments) {
        if (arg.name.value === RESOLVABLE) {
          if (arg.value.kind === Kind.BOOLEAN && !arg.value.value) {
            isUnresolvable = true;
          }
          continue;
        }
        if (arg.name.value !== FIELDS) {
          rawFieldSet = undefined;
          break;
        }
        if (arg.value.kind !== Kind.STRING) {
          rawFieldSet = undefined;
          break;
        }
        rawFieldSet = arg.value.value;
      }
      if (rawFieldSet === undefined) {
        continue;
      }
      const { error, documentNode } = safeParse('{' + rawFieldSet + '}');
      if (error || !documentNode) {
        this.errors.push(
          invalidDirectiveError(KEY, parentTypeName, numberToOrdinal(keyNumber), [
            unparsableFieldSetErrorMessage(rawFieldSet, error),
          ]),
        );
        continue;
      }
      const normalizedFieldSet = getNormalizedFieldSet(documentNode);
      const keyFieldSetData = keyFieldSetDataByFieldSet.get(normalizedFieldSet);
      if (keyFieldSetData) {
        // Duplicate keys should potentially be a warning. For now, simply propagate if it's resolvable.
        keyFieldSetData.isUnresolvable ||= isUnresolvable;
      } else {
        keyFieldSetDataByFieldSet.set(normalizedFieldSet, {
          documentNode,
          isUnresolvable,
          normalizedFieldSet,
          rawFieldSet,
        });
      }
    }
  }

  getFieldSetParent(
    isProvides: boolean,
    parentData: CompositeOutputData,
    fieldName: string,
    parentTypeName: string,
  ): FieldSetParentResult {
    if (!isProvides) {
      return { fieldSetParentData: parentData };
    }
    const fieldData = getOrThrowError(parentData.fieldDataByName, fieldName, `${parentTypeName}.fieldDataByFieldName`);
    const fieldNamedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);

    const namedTypeData = this.parentDefinitionDataByTypeName.get(fieldNamedTypeName);
    // This error should never happen
    if (!namedTypeData) {
      return {
        errorString: unknownNamedTypeErrorMessage(`${parentTypeName}.${fieldName}`, fieldNamedTypeName),
      };
    }
    if (namedTypeData.kind !== Kind.INTERFACE_TYPE_DEFINITION && namedTypeData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
      return {
        errorString: incompatibleTypeWithProvidesErrorMessage(`${parentTypeName}.${fieldName}`, fieldNamedTypeName),
      };
    }
    return { fieldSetParentData: namedTypeData };
  }

  validateConditionalFieldSet(
    selectionSetParentData: CompositeOutputData,
    fieldSet: string,
    directiveFieldName: string,
    isProvides: boolean,
    directiveParentTypeName: string,
  ): ConditionalFieldSetValidationResult {
    // Create a new selection set so that the value can be parsed as a new DocumentNode
    const { error, documentNode } = safeParse('{' + fieldSet + '}');
    if (error || !documentNode) {
      return { errorMessages: [unparsableFieldSetErrorMessage(fieldSet, error)] };
    }
    const nf = this;
    const parentDatas: Array<CompositeOutputData | UnionDefinitionData> = [selectionSetParentData];
    const directiveName = getConditionalFieldSetDirectiveName(isProvides);
    const definedFields: Array<Set<string>> = [];
    const directiveCoords = `${directiveParentTypeName}.${directiveFieldName}`;
    const fieldCoordsPath = getInitialFieldCoordsPath(isProvides, directiveCoords);
    const fieldPath = [directiveFieldName];
    const externalAncestors = new Set<string>();
    const errorMessages: Array<string> = [];
    let currentDepth = -1;
    let shouldDefineSelectionSet = true;
    let lastFieldName = directiveFieldName;
    let hasConditionalField = false;
    visit(documentNode, {
      Argument: {
        enter() {
          return false;
        },
      },
      Field: {
        enter(node) {
          const parentData = parentDatas[currentDepth];
          const parentTypeName = parentData.name;
          if (parentData.kind === Kind.UNION_TYPE_DEFINITION) {
            errorMessages.push(invalidSelectionOnUnionErrorMessage(fieldSet, fieldCoordsPath, parentTypeName));
            return BREAK;
          }
          const fieldName = node.name.value;
          const currentFieldCoords = `${parentTypeName}.${fieldName}`;
          nf.unvalidatedExternalFieldCoords.delete(currentFieldCoords);
          // If an object-like was just visited, a selection set should have been entered
          if (shouldDefineSelectionSet) {
            errorMessages.push(
              invalidSelectionSetErrorMessage(
                fieldSet,
                fieldCoordsPath,
                parentTypeName,
                kindToNodeType(parentData.kind),
              ),
            );
            return BREAK;
          }
          fieldCoordsPath.push(currentFieldCoords);
          fieldPath.push(fieldName);
          lastFieldName = fieldName;
          const fieldData = parentData.fieldDataByName.get(fieldName);
          // undefined if the field does not exist on the parent
          if (!fieldData) {
            errorMessages.push(undefinedFieldInFieldSetErrorMessage(fieldSet, parentTypeName, fieldName));
            return BREAK;
          }
          if (definedFields[currentDepth].has(fieldName)) {
            errorMessages.push(duplicateFieldInFieldSetErrorMessage(fieldSet, currentFieldCoords));
            return BREAK;
          }
          definedFields[currentDepth].add(fieldName);
          const { isDefinedExternal, isUnconditionallyProvided } = getOrThrowError(
            fieldData.externalFieldDataBySubgraphName,
            nf.subgraphName,
            `${currentFieldCoords}.externalFieldDataBySubgraphName`,
          );
          const isFieldConditional = isDefinedExternal && !isUnconditionallyProvided;
          if (!isUnconditionallyProvided) {
            hasConditionalField = true;
          }
          const namedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
          // The child could itself be a parent
          const namedTypeData = nf.parentDefinitionDataByTypeName.get(namedTypeName);
          // The base scalars are not in the parents map
          if (
            BASE_SCALARS.has(namedTypeName) ||
            namedTypeData?.kind === Kind.SCALAR_TYPE_DEFINITION ||
            namedTypeData?.kind === Kind.ENUM_TYPE_DEFINITION
          ) {
            if (externalAncestors.size < 1 && !isDefinedExternal) {
              if (nf.isSubgraphVersionTwo) {
                nf.errors.push(
                  nonExternalConditionalFieldError(
                    directiveCoords,
                    nf.subgraphName,
                    currentFieldCoords,
                    fieldSet,
                    directiveName,
                  ),
                );
                return;
              }
              /* In V1, @requires and @provides do not need to declare any part of the field set @external.
               * It would appear that any such non-external fields are treated as if they are non-conditionally provided.
               * */
              nf.warnings.push(
                nonExternalConditionalFieldWarning(
                  directiveCoords,
                  nf.subgraphName,
                  currentFieldCoords,
                  fieldSet,
                  directiveName,
                ),
              );
              return;
            }
            if (externalAncestors.size < 1 && isUnconditionallyProvided) {
              // V2 subgraphs return an error when an external key field on an entity extension is provided.
              if (nf.isSubgraphVersionTwo) {
                errorMessages.push(
                  fieldAlreadyProvidedErrorMessage(currentFieldCoords, nf.subgraphName, directiveName),
                );
              } else {
                nf.warnings.push(
                  fieldAlreadyProvidedWarning(currentFieldCoords, directiveName, directiveCoords, nf.subgraphName),
                );
              }
              return;
            }
            // @TODO re-assess in v2 because this would be breaking for @provides in v1
            if (!isFieldConditional && !isProvides) {
              // Do not add unnecessary @requires configurations
              return;
            }
            const conditionalFieldData = getValueOrDefault(
              nf.conditionalFieldDataByCoords,
              currentFieldCoords,
              newConditionalFieldData,
            );
            const fieldSetCondition = newFieldSetConditionData({
              fieldCoordinatesPath: [...fieldCoordsPath],
              fieldPath: [...fieldPath],
            });
            isProvides
              ? conditionalFieldData.providedBy.push(fieldSetCondition)
              : conditionalFieldData.requiredBy.push(fieldSetCondition);
            return;
          }
          if (!namedTypeData) {
            // Should not be possible to receive this error
            errorMessages.push(unknownTypeInFieldSetErrorMessage(fieldSet, currentFieldCoords, namedTypeName));
            return BREAK;
          }
          // TODO isFieldConditional
          if (isDefinedExternal) {
            if (isProvides) {
              getValueOrDefault(
                nf.conditionalFieldDataByCoords,
                currentFieldCoords,
                newConditionalFieldData,
              ).providedBy.push(
                newFieldSetConditionData({
                  fieldCoordinatesPath: [...fieldCoordsPath],
                  fieldPath: [...fieldPath],
                }),
              );
            }
            externalAncestors.add(currentFieldCoords);
          }
          if (
            namedTypeData.kind === Kind.OBJECT_TYPE_DEFINITION ||
            namedTypeData.kind === Kind.INTERFACE_TYPE_DEFINITION ||
            namedTypeData.kind === Kind.UNION_TYPE_DEFINITION
          ) {
            shouldDefineSelectionSet = true;
            parentDatas.push(namedTypeData);
            return;
          }
        },
        leave() {
          externalAncestors.delete(fieldCoordsPath.pop() || '');
          fieldPath.pop();
        },
      },
      InlineFragment: {
        enter(node) {
          const parentData = parentDatas[currentDepth];
          const parentTypeName = parentData.name;
          const fieldCoordinates =
            fieldCoordsPath.length < 1 ? selectionSetParentData.name : fieldCoordsPath[fieldCoordsPath.length - 1];
          if (!node.typeCondition) {
            errorMessages.push(inlineFragmentWithoutTypeConditionErrorMessage(fieldSet, fieldCoordinates));
            return BREAK;
          }
          const typeConditionName = node.typeCondition.name.value;
          // It's possible to infinitely define fragments
          if (typeConditionName === parentTypeName) {
            parentDatas.push(parentData);
            shouldDefineSelectionSet = true;
            return;
          }
          if (!isKindAbstract(parentData.kind)) {
            errorMessages.push(
              invalidInlineFragmentTypeErrorMessage(fieldSet, fieldCoordsPath, typeConditionName, parentTypeName),
            );
            return BREAK;
          }
          const fragmentNamedTypeData = nf.parentDefinitionDataByTypeName.get(typeConditionName);
          if (!fragmentNamedTypeData) {
            errorMessages.push(
              unknownInlineFragmentTypeConditionErrorMessage(
                fieldSet,
                fieldCoordsPath,
                parentTypeName,
                typeConditionName,
              ),
            );
            return BREAK;
          }
          shouldDefineSelectionSet = true;
          switch (fragmentNamedTypeData.kind) {
            case Kind.INTERFACE_TYPE_DEFINITION: {
              if (!fragmentNamedTypeData.implementedInterfaceTypeNames.has(parentTypeName)) {
                break;
              }
              parentDatas.push(fragmentNamedTypeData);
              return;
            }
            case Kind.OBJECT_TYPE_DEFINITION: {
              const concreteTypeNames = nf.concreteTypeNamesByAbstractTypeName.get(parentTypeName);
              if (!concreteTypeNames || !concreteTypeNames.has(typeConditionName)) {
                break;
              }
              parentDatas.push(fragmentNamedTypeData);
              return;
            }
            case Kind.UNION_TYPE_DEFINITION: {
              parentDatas.push(fragmentNamedTypeData);
              return;
            }
            default: {
              errorMessages.push(
                invalidInlineFragmentTypeConditionTypeErrorMessage(
                  fieldSet,
                  fieldCoordsPath,
                  parentTypeName,
                  typeConditionName,
                  kindToNodeType(fragmentNamedTypeData.kind),
                ),
              );
              return BREAK;
            }
          }
          errorMessages.push(
            invalidInlineFragmentTypeConditionErrorMessage(
              fieldSet,
              fieldCoordsPath,
              typeConditionName,
              kindToNodeType(parentData.kind),
              parentTypeName,
            ),
          );
          return BREAK;
        },
      },
      SelectionSet: {
        enter() {
          if (!shouldDefineSelectionSet) {
            const parentData = parentDatas[currentDepth];
            if (parentData.kind === Kind.UNION_TYPE_DEFINITION) {
              // Should never happen
              errorMessages.push(unparsableFieldSetSelectionErrorMessage(fieldSet, lastFieldName));
              return BREAK;
            }
            const fieldData = parentData.fieldDataByName.get(lastFieldName);
            if (!fieldData) {
              errorMessages.push(undefinedFieldInFieldSetErrorMessage(fieldSet, parentData.name, lastFieldName));
              return BREAK;
            }
            const fieldNamedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
            // If the child is not found, it's a base scalar. Undefined types would have already been handled.
            const namedTypeData = nf.parentDefinitionDataByTypeName.get(fieldNamedTypeName);
            const childKind = namedTypeData ? namedTypeData.kind : Kind.SCALAR_TYPE_DEFINITION;
            errorMessages.push(
              invalidSelectionSetDefinitionErrorMessage(
                fieldSet,
                fieldCoordsPath,
                fieldNamedTypeName,
                kindToNodeType(childKind),
              ),
            );
            return BREAK;
          }
          currentDepth += 1;
          shouldDefineSelectionSet = false;
          if (currentDepth < 0 || currentDepth >= parentDatas.length) {
            errorMessages.push(unparsableFieldSetSelectionErrorMessage(fieldSet, lastFieldName));
            return BREAK;
          }
          definedFields.push(new Set<string>());
        },
        leave() {
          if (shouldDefineSelectionSet) {
            const parentData = parentDatas[currentDepth + 1];
            errorMessages.push(
              invalidSelectionSetErrorMessage(
                fieldSet,
                fieldCoordsPath,
                parentData.name,
                kindToNodeType(parentData.kind),
              ),
            );
            shouldDefineSelectionSet = false;
          }
          // Empty selection sets would be a parse error, so it is unnecessary to handle them
          currentDepth -= 1;
          parentDatas.pop();
          definedFields.pop();
        },
      },
    });
    if (errorMessages.length > 0 || !hasConditionalField) {
      return { errorMessages };
    }
    return {
      configuration: { fieldName: directiveFieldName, selectionSet: getNormalizedFieldSet(documentNode) },
      errorMessages,
    };
  }

  validateProvidesOrRequires(
    parentData: CompositeOutputData,
    fieldSetByFieldName: Map<string, string>,
    isProvides: boolean,
  ): RequiredFieldConfiguration[] | undefined {
    const allErrorMessages: string[] = [];
    const configurations: RequiredFieldConfiguration[] = [];
    const parentTypeName = getParentTypeName(parentData);
    for (const [fieldName, fieldSet] of fieldSetByFieldName) {
      /* It is possible to encounter a field before encountering the type definition.
       Consequently, at that time, it is unknown whether the named type is an entity.
       If it isn't, the @provides directive does not make sense and can be ignored.
      */
      const { fieldSetParentData, errorString } = this.getFieldSetParent(
        isProvides,
        parentData,
        fieldName,
        parentTypeName,
      );
      const fieldCoords = `${parentTypeName}.${fieldName}`;
      if (errorString) {
        allErrorMessages.push(errorString);
        continue;
      }
      if (!fieldSetParentData) {
        continue;
      }
      const { errorMessages, configuration } = this.validateConditionalFieldSet(
        fieldSetParentData,
        fieldSet,
        fieldName,
        isProvides,
        parentTypeName,
      );
      /*
       * It is possible to return no error messages nor configuration if the @provides or @requires directive is
       * considered completely redundant, i.e.,:
       * 1. All fields to which the directive refers are declared @external but are also key fields on an entity extension.
       * 2. The subgraph is V1 and all fields to which the directive refers are not declared @external.
       * In these cases, the fields are considered unconditionally provided.
       * If all the fields to which the directive refers are unconditionally provided, the directive is redundant.
       * For V2 subgraphs, this will propagate as an error; for V1 subgraphs, this will propagate as a warning.
       * */
      if (errorMessages.length > 0) {
        allErrorMessages.push(` On field "${fieldCoords}":\n -` + errorMessages.join(HYPHEN_JOIN));
        continue;
      }

      if (configuration) {
        configurations.push(configuration);
      }
    }
    if (allErrorMessages.length > 0) {
      this.errors.push(
        invalidProvidesOrRequiresDirectivesError(getConditionalFieldSetDirectiveName(isProvides), allErrorMessages),
      );
      return;
    }

    if (configurations.length > 0) {
      return configurations;
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
    for (const interfaceTypeName of data.implementedInterfaceTypeNames) {
      const interfaceData = this.parentDefinitionDataByTypeName.get(interfaceTypeName);
      // This check is so undefined type errors are not improperly propagated
      if (BASE_SCALARS.has(interfaceTypeName)) {
        this.referencedTypeNames.add(interfaceTypeName);
      }
      if (!interfaceData) {
        continue;
      }
      if (interfaceData.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        invalidImplementationTypeStringByTypeName.set(interfaceData.name, kindToNodeType(interfaceData.kind));
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
      for (const [fieldName, interfaceField] of interfaceData.fieldDataByName) {
        this.unvalidatedExternalFieldCoords.delete(`${data.name}.${fieldName}`);
        let hasNestedErrors = false;
        const fieldData = data.fieldDataByName.get(fieldName);
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
        for (const [argumentName, interfaceArgument] of interfaceField.argumentDataByName) {
          handledArguments.add(argumentName);
          const containerArgument = fieldData.argumentDataByName.get(argumentName);
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
        for (const [argumentName, argumentData] of fieldData.argumentDataByName) {
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
        implementationErrorsMap.set(interfaceTypeName, implementationErrors);
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
        invalidInterfaceImplementationError(data.name, kindToNodeType(data.kind), implementationErrorsMap),
      );
    }
  }

  handleAuthenticatedDirective(data: NodeData | SchemaData, parentTypeName: string) {
    const parentAuthData = getValueOrDefault(this.authorizationDataByParentTypeName, parentTypeName, () =>
      newAuthorizationData(parentTypeName),
    );
    if (data.kind === Kind.FIELD_DEFINITION) {
      const fieldAuthData = getValueOrDefault(parentAuthData.fieldAuthDataByFieldName, data.name, () =>
        newFieldAuthorizationData(data.name),
      );
      fieldAuthData.inheritedData.requiresAuthentication = true;
      fieldAuthData.originalData.requiresAuthentication = true;
    } else {
      parentAuthData.requiresAuthentication = true;
      this.parentTypeNamesWithAuthDirectives.add(parentTypeName);
    }
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
    getValueOrDefault(overrideDataForSubgraph, data.renamedParentTypeName, () => new Set<string>()).add(data.name);
  }

  handleSemanticNonNullDirective({ data, directiveNode, errorMessages }: HandleSemanticNonNullDirectiveParams) {
    const nonNullIndices = new Set<number>();
    let currentType: MutableTypeNode | null = data.node.type;
    let index = 0;
    while (currentType) {
      switch (currentType.kind) {
        case Kind.LIST_TYPE: {
          index += 1;
          currentType = currentType.type;
          break;
        }
        case Kind.NON_NULL_TYPE: {
          nonNullIndices.add(index);
          currentType = currentType.type;
          break;
        }
        default: {
          currentType = null;
          break;
        }
      }
    }
    const levelsArg = directiveNode.arguments?.find((arg) => arg.name.value === LEVELS);
    if (!levelsArg || levelsArg.value.kind !== Kind.LIST) {
      // Should never happen because the argument will have just been validated.
      errorMessages.push(semanticNonNullArgumentErrorMessage);
      return;
    }
    const values = levelsArg.value.values as ReadonlyArray<IntValueNode>;
    const typeString = printTypeNode(data.type);
    const levels = new Set<number>();
    for (const { value } of values) {
      const int = parseInt(value, 10);
      if (Number.isNaN(int)) {
        errorMessages.push(semanticNonNullLevelsNaNIndexErrorMessage(value));
        continue;
      }
      if (int < 0 || int > index) {
        errorMessages.push(
          semanticNonNullLevelsIndexOutOfBoundsErrorMessage({
            maxIndex: index,
            typeString,
            value,
          }),
        );
        continue;
      }
      if (!nonNullIndices.has(int)) {
        levels.add(int);
        continue;
      }
      errorMessages.push(
        semanticNonNullLevelsNonNullErrorMessage({
          typeString,
          value,
        }),
      );
    }
    data.nullLevelsBySubgraphName.set(this.subgraphName, levels);
  }

  extractRequiredScopes({ directiveCoords, orScopes, requiredScopes }: HandleRequiresScopesDirectiveParams) {
    if (orScopes.length > MAX_OR_SCOPES) {
      this.invalidORScopesCoords.add(directiveCoords);
      return;
    }
    for (const scopes of orScopes) {
      const newANDScopes = new Set<string>();
      for (const scope of (scopes as ListValueNode).values) {
        newANDScopes.add((scope as StringValueNode).value);
      }
      if (newANDScopes.size < 1) {
        continue;
      }
      addScopes(requiredScopes, newANDScopes);
    }
  }

  getKafkaPublishConfiguration(
    directive: ConstDirectiveNode,
    argumentDataByArgumentName: Map<string, InputValueData>,
    fieldName: string,
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
    return { fieldName, providerId, providerType: PROVIDER_TYPE_KAFKA, topics, type: PUBLISH };
  }

  getKafkaSubscribeConfiguration(
    directive: ConstDirectiveNode,
    argumentDataByArgumentName: Map<string, InputValueData>,
    fieldName: string,
    errorMessages: string[],
  ): EventConfiguration | undefined {
    const topics: string[] = [];
    let providerId = DEFAULT_EDFS_PROVIDER_ID;
    for (const argumentNode of directive.arguments || []) {
      switch (argumentNode.name.value) {
        case TOPICS: {
          //@TODO list coercion
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
      fieldName,
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
    fieldName: string,
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
    return { fieldName, providerId, providerType: PROVIDER_TYPE_NATS, subjects, type: eventType };
  }

  getNatsSubscribeConfiguration(
    directive: ConstDirectiveNode,
    argumentDataByArgumentName: Map<string, InputValueData>,
    fieldName: string,
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
          // @TODO list coercion
          if (argumentNode.value.kind !== Kind.LIST) {
            errorMessages.push(invalidEventSubjectsErrorMessage(SUBJECTS));
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
      fieldName,
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

  getRedisPublishConfiguration(
    directive: ConstDirectiveNode,
    argumentDataByArgumentName: Map<string, InputValueData>,
    fieldName: string,
    errorMessages: string[],
  ): EventConfiguration | undefined {
    const channels: string[] = [];
    let providerId = DEFAULT_EDFS_PROVIDER_ID;
    for (const argumentNode of directive.arguments || []) {
      switch (argumentNode.name.value) {
        case CHANNEL: {
          if (argumentNode.value.kind !== Kind.STRING || argumentNode.value.value.length < 1) {
            errorMessages.push(invalidEventSubjectErrorMessage(CHANNEL));
            continue;
          }
          validateArgumentTemplateReferences(argumentNode.value.value, argumentDataByArgumentName, errorMessages);
          channels.push(argumentNode.value.value);
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
    return { fieldName, providerId, providerType: PROVIDER_TYPE_REDIS, channels, type: PUBLISH };
  }

  getRedisSubscribeConfiguration(
    directive: ConstDirectiveNode,
    argumentDataByArgumentName: Map<string, InputValueData>,
    fieldName: string,
    errorMessages: string[],
  ): EventConfiguration | undefined {
    const channels: string[] = [];
    let providerId = DEFAULT_EDFS_PROVIDER_ID;
    for (const argumentNode of directive.arguments || []) {
      switch (argumentNode.name.value) {
        case CHANNELS: {
          //@TODO list coercion
          if (argumentNode.value.kind !== Kind.LIST) {
            errorMessages.push(invalidEventSubjectsErrorMessage(CHANNELS));
            continue;
          }
          for (const value of argumentNode.value.values) {
            if (value.kind !== Kind.STRING || value.value.length < 1) {
              errorMessages.push(invalidEventSubjectsItemErrorMessage(CHANNELS));
              break;
            }
            validateArgumentTemplateReferences(value.value, argumentDataByArgumentName, errorMessages);
            channels.push(value.value);
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
      fieldName,
      providerId,
      providerType: PROVIDER_TYPE_REDIS,
      channels,
      type: SUBSCRIBE,
    };
  }

  validateSubscriptionFilterDirectiveLocation(node: FieldDefinitionNode) {
    if (!node.directives) {
      return;
    }
    const parentTypeName = this.renamedParentTypeName || this.originalParentTypeName;
    const fieldCoords = `${parentTypeName}.${node.name.value}`;
    const isSubscription = this.getOperationTypeNodeForRootTypeName(parentTypeName) === OperationTypeNode.SUBSCRIPTION;
    for (const directiveNode of node.directives) {
      if (directiveNode.name.value !== SUBSCRIPTION_FILTER) {
        continue;
      }
      if (!isSubscription) {
        this.errors.push(invalidSubscriptionFilterLocationError(fieldCoords));
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
    const fieldName = node.name.value;
    const fieldCoords = `${this.renamedParentTypeName || this.originalParentTypeName}.${fieldName}`;
    for (const directive of node.directives) {
      const errorMessages: string[] = [];
      let eventConfiguration: EventConfiguration | undefined;
      switch (directive.name.value) {
        case EDFS_KAFKA_PUBLISH:
          eventConfiguration = this.getKafkaPublishConfiguration(
            directive,
            argumentDataByArgumentName,
            fieldName,
            errorMessages,
          );
          break;
        case EDFS_KAFKA_SUBSCRIBE:
          eventConfiguration = this.getKafkaSubscribeConfiguration(
            directive,
            argumentDataByArgumentName,
            fieldName,
            errorMessages,
          );
          break;
        case EDFS_NATS_PUBLISH: {
          eventConfiguration = this.getNatsPublishAndRequestConfiguration(
            PUBLISH,
            directive,
            argumentDataByArgumentName,
            fieldName,
            errorMessages,
          );
          break;
        }
        case EDFS_NATS_REQUEST: {
          eventConfiguration = this.getNatsPublishAndRequestConfiguration(
            REQUEST,
            directive,
            argumentDataByArgumentName,
            fieldName,
            errorMessages,
          );
          break;
        }
        case EDFS_NATS_SUBSCRIBE: {
          eventConfiguration = this.getNatsSubscribeConfiguration(
            directive,
            argumentDataByArgumentName,
            fieldName,
            errorMessages,
          );
          break;
        }
        case EDFS_REDIS_PUBLISH: {
          eventConfiguration = this.getRedisPublishConfiguration(
            directive,
            argumentDataByArgumentName,
            fieldName,
            errorMessages,
          );
          break;
        }
        case EDFS_REDIS_SUBSCRIBE: {
          eventConfiguration = this.getRedisSubscribeConfiguration(
            directive,
            argumentDataByArgumentName,
            fieldName,
            errorMessages,
          );
          break;
        }
        default:
          continue;
      }

      if (errorMessages.length > 0) {
        this.errors.push(invalidEventDirectiveError(directive.name.value, fieldCoords, errorMessages));
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
        return new Set<string>([EDFS_KAFKA_PUBLISH, EDFS_NATS_PUBLISH, EDFS_NATS_REQUEST, EDFS_REDIS_PUBLISH]);
      case OperationTypeNode.QUERY:
        return new Set<string>([EDFS_NATS_REQUEST]);
      case OperationTypeNode.SUBSCRIPTION:
        return new Set<string>([EDFS_KAFKA_SUBSCRIBE, EDFS_NATS_SUBSCRIBE, EDFS_REDIS_SUBSCRIBE]);
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
    for (const [fieldName, fieldData] of data.fieldDataByName) {
      const fieldCoords = `${fieldData.originalParentTypeName}.${fieldName}`;
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
        invalidEventsDirectiveDataByRootFieldPath.set(fieldCoords, {
          definesDirectives: definedEventsDirectiveNames.size > 0,
          invalidDirectiveNames: [...invalidEventsDirectiveNames],
        });
      }
      if (operationTypeNode === OperationTypeNode.MUTATION) {
        const typeString = printTypeNode(fieldData.type);
        if (typeString !== NON_NULLABLE_EDFS_PUBLISH_EVENT_RESULT) {
          invalidResponseTypeNameByMutationPath.set(fieldCoords, typeString);
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
        invalidResponseTypeStringByRootFieldPath.set(fieldCoords, fieldTypeString);
      }
    }
  }

  validateEventDrivenKeyDefinition(typeName: string, invalidKeyFieldSetsByEntityTypeName: Map<string, Array<string>>) {
    const keyFieldSetDataByFieldSet = this.keyFieldSetDatasByTypeName.get(typeName);
    if (!keyFieldSetDataByFieldSet) {
      return;
    }
    for (const [keyFieldSet, { isUnresolvable }] of keyFieldSetDataByFieldSet) {
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
      const fieldCoords = `${fieldData.originalParentTypeName}.${fieldName}`;
      if (keyFieldNames.has(fieldName)) {
        if (!fieldData.externalFieldDataBySubgraphName.get(this.subgraphName)?.isDefinedExternal) {
          nonExternalKeyFieldNameByFieldPath.set(fieldCoords, fieldName);
        }
        continue;
      }
      nonKeyFieldNameByFieldPath.set(fieldCoords, fieldName);
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
    if (data.fieldDataByName.size != 1) {
      return false;
    }
    for (const [fieldName, fieldData] of data.fieldDataByName) {
      if (fieldData.argumentDataByName.size > 0) {
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
    if (streamConfigurationInputData.inputValueDataByName.size != 3) {
      return false;
    }
    for (const [inputValueName, inputValueData] of streamConfigurationInputData.inputValueDataByName) {
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
        data.fieldDataByName,
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
        invalidMembers.push(`"${memberName}", which is type "${kindToNodeType(memberData.kind)}"`);
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

  addValidKeyFieldSetConfigurations() {
    for (const [entityTypeName, keyFieldSetDataByFieldSet] of this.keyFieldSetDatasByTypeName) {
      const parentData = this.parentDefinitionDataByTypeName.get(entityTypeName);
      if (
        !parentData ||
        (parentData.kind !== Kind.OBJECT_TYPE_DEFINITION && parentData.kind !== Kind.INTERFACE_TYPE_DEFINITION)
      ) {
        this.errors.push(undefinedCompositeOutputTypeError(entityTypeName));
        continue;
      }
      const typeName = getParentTypeName(parentData);
      const configurationData = getValueOrDefault(this.configurationDataByTypeName, typeName, () =>
        newConfigurationData(true, typeName),
      );
      const keys = validateKeyFieldSets(this, parentData, keyFieldSetDataByFieldSet);
      if (keys) {
        configurationData.keys = keys;
      }
    }
  }

  getValidFlattenedDirectiveArray(
    directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
    directiveCoords: string,
    removeInheritedDirectives = false,
  ): ConstDirectiveNode[] {
    const flattenedArray: ConstDirectiveNode[] = [];
    for (const [directiveName, directiveNodes] of directivesByDirectiveName) {
      if (removeInheritedDirectives && INHERITABLE_DIRECTIVE_NAMES.has(directiveName)) {
        continue;
      }
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
    enumDefinitionData.node.values = childMapToValueArray(enumDefinitionData.enumValueDataByValueName);
    return enumDefinitionData.node;
  }

  getInputObjectNodeByData(inputObjectDefinitionData: InputObjectDefinitionData) {
    inputObjectDefinitionData.node.description = inputObjectDefinitionData.description;
    inputObjectDefinitionData.node.directives = this.getValidFlattenedDirectiveArray(
      inputObjectDefinitionData.directivesByDirectiveName,
      inputObjectDefinitionData.name,
    );
    inputObjectDefinitionData.node.fields = childMapToValueArray(inputObjectDefinitionData.inputValueDataByName);
    return inputObjectDefinitionData.node;
  }

  getCompositeOutputNodeByData(compositeOutputData: CompositeOutputData): ObjectTypeNode | InterfaceTypeDefinitionNode {
    compositeOutputData.node.description = compositeOutputData.description;
    compositeOutputData.node.directives = this.getValidFlattenedDirectiveArray(
      compositeOutputData.directivesByDirectiveName,
      compositeOutputData.name,
      true,
    );
    compositeOutputData.node.fields = childMapToValueArray(compositeOutputData.fieldDataByName);
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

  evaluateExternalKeyFields() {
    const invalidTypeNames: Array<string> = [];
    for (const [entityTypeName, keyFieldSetDataByFieldSet] of this.keyFieldSetDatasByTypeName) {
      const entityParentData = this.parentDefinitionDataByTypeName.get(entityTypeName);
      // The parent data should always exist.
      if (
        !entityParentData ||
        (entityParentData.kind !== Kind.OBJECT_TYPE_DEFINITION &&
          entityParentData.kind !== Kind.INTERFACE_TYPE_DEFINITION)
      ) {
        // If somehow the parent data does not exist, prevent the same error occurring by removing that type from the map.
        invalidTypeNames.push(entityTypeName);
        this.errors.push(undefinedCompositeOutputTypeError(entityTypeName));
        continue;
      }
      const nf = this;
      for (const keyFieldSetData of keyFieldSetDataByFieldSet.values()) {
        const parentDatas: CompositeOutputData[] = [entityParentData];
        // Entity extension fields are effectively never @external, so propagate a warning.
        const externalExtensionFieldCoordsByRawFieldSet = new Map<string, Set<string>>();
        let currentDepth = -1;
        let shouldDefineSelectionSet = true;
        visit(keyFieldSetData.documentNode, {
          Argument: {
            enter() {
              return BREAK;
            },
          },
          Field: {
            enter(node) {
              const parentData = parentDatas[currentDepth];
              const parentTypeName = parentData.name;
              // If a composite type was just visited, a selection set should have been entered
              if (shouldDefineSelectionSet) {
                return BREAK;
              }
              const fieldName = node.name.value;
              const fieldCoords = `${parentTypeName}.${fieldName}`;
              // If a field declared @external is a key field, it is valid use of @external.
              nf.unvalidatedExternalFieldCoords.delete(fieldCoords);
              const fieldData = parentData.fieldDataByName.get(fieldName);
              // undefined if the field does not exist on the parent
              if (!fieldData || fieldData.argumentDataByName.size) {
                return BREAK;
              }
              // Fields that form part of an entity key are intrinsically shareable
              fieldData.isShareableBySubgraphName.set(nf.subgraphName, true);
              /* !!! IMPORTANT NOTE REGARDING INCONSISTENT APOLLO BEHAVIOUR !!!
               * V1 entities with "@extends" may define unique nested key fields as @external without restriction.
               * However, V1 entity extensions (with the "extend" keyword) cannot do this.
               * Instead, an error is returned stating that there must be a non-external definition of the field.
               * This inconsistency in behaviour appears to be a bug.
               * It doesn't make much sense to enforce "origin fields" only sometimes (or ever, honestly).
               * Consequently, a decision was made not ever to enforce meaningless origin fields for extensions.
               *
               * In the event the nested key field is not unique, the error may propagate as a field resolvability
               * error, e.g., unable to use the nested @external key field to satisfy a field set in another subgraph.
               *
               * In addition, the nested key field of a V2 entity extension (either "@extends" or "extend" keyword)
               * are considered unconditionally provided regardless of the presence of "@external".
               *
               * However, if the subgraph is an EDG, the @external state should be kept regardless of extension.
               * */
              const externalFieldData = fieldData.externalFieldDataBySubgraphName.get(nf.subgraphName);
              if (
                nf.edfsDirectiveReferences.size < 1 &&
                externalFieldData &&
                externalFieldData.isDefinedExternal &&
                !externalFieldData.isUnconditionallyProvided
              ) {
                /*
                 * The key field is unconditionally provided if all the following are true:
                 * 1. The root entity is an extension type.
                 * 2. The field is also a key field for the parent entity.
                 */
                if (entityParentData.extensionType !== ExtensionType.NONE) {
                  externalFieldData.isUnconditionallyProvided = true;
                  getValueOrDefault(
                    externalExtensionFieldCoordsByRawFieldSet,
                    keyFieldSetData.rawFieldSet,
                    () => new Set<string>(),
                  ).add(fieldCoords);
                }
              }
              getValueOrDefault(nf.keyFieldNamesByParentTypeName, parentTypeName, () => new Set<string>()).add(
                fieldName,
              );
              const namedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
              // The base scalars are not in the parents map
              if (BASE_SCALARS.has(namedTypeName)) {
                return;
              }
              // The child could itself be a parent
              const namedTypeData = nf.parentDefinitionDataByTypeName.get(namedTypeName);
              if (!namedTypeData) {
                return BREAK;
              }
              if (namedTypeData.kind === Kind.OBJECT_TYPE_DEFINITION) {
                shouldDefineSelectionSet = true;
                parentDatas.push(namedTypeData);
                return;
              }
              // interfaces and unions are invalid in a key directive
              if (isKindAbstract(namedTypeData.kind)) {
                return BREAK;
              }
            },
          },
          InlineFragment: {
            enter() {
              return BREAK;
            },
          },
          SelectionSet: {
            enter() {
              if (!shouldDefineSelectionSet) {
                return BREAK;
              }
              currentDepth += 1;
              shouldDefineSelectionSet = false;
              if (currentDepth < 0 || currentDepth >= parentDatas.length) {
                return BREAK;
              }
            },
            leave() {
              if (shouldDefineSelectionSet) {
                shouldDefineSelectionSet = false;
              }
              // Empty selection sets would be a parse error, so it is unnecessary to handle them
              currentDepth -= 1;
              parentDatas.pop();
            },
          },
        });
        if (externalExtensionFieldCoordsByRawFieldSet.size < 1) {
          continue;
        }
        for (const [rawFieldSet, fieldCoords] of externalExtensionFieldCoordsByRawFieldSet) {
          this.warnings.push(
            externalEntityExtensionKeyFieldWarning(
              entityParentData.name,
              rawFieldSet,
              [...fieldCoords],
              this.subgraphName,
            ),
          );
        }
      }
    }
    for (const invalidTypeName of invalidTypeNames) {
      this.keyFieldSetDatasByTypeName.delete(invalidTypeName);
    }
  }

  addValidConditionalFieldSetConfigurations() {
    for (const [typeName, fieldSetData] of this.fieldSetDataByTypeName) {
      const parentData = this.parentDefinitionDataByTypeName.get(typeName);
      if (
        !parentData ||
        (parentData.kind !== Kind.OBJECT_TYPE_DEFINITION && parentData.kind !== Kind.INTERFACE_TYPE_DEFINITION)
      ) {
        this.errors.push(undefinedCompositeOutputTypeError(typeName));
        continue;
      }
      const parentTypeName = getParentTypeName(parentData);
      const configurationData = getValueOrDefault(this.configurationDataByTypeName, parentTypeName, () =>
        newConfigurationData(false, parentTypeName),
      );
      const provides = this.validateProvidesOrRequires(parentData, fieldSetData.provides, true);
      if (provides) {
        configurationData.provides = provides;
      }
      const requires = this.validateProvidesOrRequires(parentData, fieldSetData.requires, false);
      if (requires) {
        configurationData.requires = requires;
      }
    }
  }

  addFieldNamesToConfigurationData(fieldDataByFieldName: Map<string, FieldData>, configurationData: ConfigurationData) {
    const externalFieldNames = new Set<string>();
    for (const [fieldName, fieldData] of fieldDataByFieldName) {
      const externalFieldData = fieldData.externalFieldDataBySubgraphName.get(this.subgraphName);
      if (!externalFieldData || externalFieldData.isUnconditionallyProvided) {
        configurationData.fieldNames.add(fieldName);
        continue;
      }
      externalFieldNames.add(fieldName);
      if (this.edfsDirectiveReferences.size > 0) {
        configurationData.fieldNames.add(fieldName);
      }
    }
    if (externalFieldNames.size > 0) {
      configurationData.externalFieldNames = externalFieldNames;
    }
  }

  validateOneOfDirective({ data, requiredFieldNames }: ValidateOneOfDirectiveParams): boolean {
    if (!data.directivesByDirectiveName.has(ONE_OF)) {
      return true;
    }
    if (requiredFieldNames.size > 0) {
      this.errors.push(
        oneOfRequiredFieldsError({
          requiredFieldNames: Array.from(requiredFieldNames),
          typeName: data.name,
        }),
      );
      return false;
    }
    if (data.inputValueDataByName.size === 1) {
      this.warnings.push(
        singleSubgraphInputFieldOneOfWarning({
          fieldName: getFirstEntry(data.inputValueDataByName)?.name ?? 'unknown',
          subgraphName: this.subgraphName,
          typeName: data.name,
        }),
      );
    }
    return true;
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
    if (this.invalidORScopesCoords.size > 0) {
      this.errors.push(orScopesLimitError(MAX_OR_SCOPES, [...this.invalidORScopesCoords]));
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
    if (this.referencedDirectiveNames.has(LINK)) {
      definitions.push(LINK_DEFINITION);
      definitions.push(LINK_IMPORT_DEFINITION);
      definitions.push(LINK_PURPOSE_DEFINITION);
    }
    // @oneOf is part of the new base schema, so this definition is/will be unnecessary, but add it as a precaution.
    if (this.referencedDirectiveNames.has(ONE_OF)) {
      definitions.push(ONE_OF_DEFINITION);
    }
    if (this.referencedDirectiveNames.has(REQUIRE_FETCH_REASONS)) {
      definitions.push(REQUIRE_FETCH_REASONS_DEFINITION);
    }
    if (this.referencedDirectiveNames.has(SEMANTIC_NON_NULL)) {
      definitions.push(SEMANTIC_NON_NULL_DEFINITION);
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
        this.errors.push(configureDescriptionNoDescriptionError(kindToNodeType(data.kind), data.name));
      }
    }
    // Check all key field sets for @external fields to assess whether they are conditional
    this.evaluateExternalKeyFields();
    for (const [parentTypeName, parentData] of this.parentDefinitionDataByTypeName) {
      switch (parentData.kind) {
        case Kind.ENUM_TYPE_DEFINITION: {
          if (parentData.enumValueDataByValueName.size < 1) {
            this.errors.push(noDefinedEnumValuesError(parentTypeName));
            break;
          }
          definitions.push(this.getEnumNodeByData(parentData));
          break;
        }
        case Kind.INPUT_OBJECT_TYPE_DEFINITION: {
          if (parentData.inputValueDataByName.size < 1) {
            this.errors.push(noInputValueDefinitionsError(parentTypeName));
            break;
          }
          const requiredFieldNames = new Set<FieldName>();
          for (const valueData of parentData.inputValueDataByName.values()) {
            if (isTypeRequired(valueData.type)) {
              requiredFieldNames.add(valueData.name);
            }
            // Base Scalars have already been set
            if (valueData.namedTypeKind !== Kind.NULL) {
              continue;
            }
            const namedTypeData = this.parentDefinitionDataByTypeName.get(valueData.namedTypeName);
            if (!namedTypeData) {
              // undefined types are handled elsewhere
              continue;
            }
            if (!isInputNodeKind(namedTypeData.kind)) {
              this.errors.push(
                invalidNamedTypeError({
                  data: valueData,
                  namedTypeData,
                  nodeType: `${kindToNodeType(parentData.kind)} field`,
                }),
              );
              continue;
            }
            valueData.namedTypeKind = namedTypeData.kind;
          }
          if (!this.validateOneOfDirective({ data: parentData, requiredFieldNames })) {
            break;
          }
          definitions.push(this.getInputObjectNodeByData(parentData));
          break;
        }
        case Kind.INTERFACE_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.OBJECT_TYPE_DEFINITION: {
          const isEntity = this.entityDataByTypeName.has(parentTypeName);
          const operationTypeNode = this.operationTypeNodeByTypeName.get(parentTypeName);
          const isObject = parentData.kind === Kind.OBJECT_TYPE_DEFINITION;
          if (this.isSubgraphVersionTwo && parentData.extensionType === ExtensionType.EXTENDS) {
            // @extends is essentially ignored in V2. It was only propagated to handle @external key fields.
            parentData.extensionType = ExtensionType.NONE;
          }
          if (operationTypeNode) {
            parentData.fieldDataByName.delete(SERVICE_FIELD);
            parentData.fieldDataByName.delete(ENTITIES_FIELD);
          }
          const externalInterfaceFieldNames: Array<string> = [];
          for (const [fieldName, fieldData] of parentData.fieldDataByName) {
            if (!isObject && fieldData.externalFieldDataBySubgraphName.get(this.subgraphName)?.isDefinedExternal) {
              externalInterfaceFieldNames.push(fieldName);
            }
            // Arguments can only be fully validated once all parents types are known
            this.validateArguments(fieldData, parentData.kind);
            // Base Scalars have already been set
            if (fieldData.namedTypeKind !== Kind.NULL) {
              continue;
            }
            const namedTypeData = this.parentDefinitionDataByTypeName.get(fieldData.namedTypeName);
            if (!namedTypeData) {
              // undefined types are handled elsewhere
              continue;
            }
            if (!isOutputNodeKind(namedTypeData.kind)) {
              this.errors.push(
                invalidNamedTypeError({
                  data: fieldData,
                  namedTypeData,
                  nodeType: `${kindToNodeType(parentData.kind)} field`,
                }),
              );
              continue;
            }
            fieldData.namedTypeKind = this.entityInterfaceDataByTypeName.get(namedTypeData.name)
              ? Kind.INTERFACE_TYPE_DEFINITION
              : namedTypeData.kind;
          }
          // @external interface fields fails composition in V2; only propagate as a warning for V1.
          if (externalInterfaceFieldNames.length > 0) {
            this.isSubgraphVersionTwo
              ? this.errors.push(externalInterfaceFieldsError(parentTypeName, externalInterfaceFieldNames))
              : this.warnings.push(
                  externalInterfaceFieldsWarning(this.subgraphName, parentTypeName, externalInterfaceFieldNames),
                );
          }
          const newParentTypeName = getParentTypeName(parentData);
          const configurationData = getValueOrDefault(this.configurationDataByTypeName, newParentTypeName, () =>
            newConfigurationData(isEntity, parentTypeName),
          );
          const entityInterfaceData = this.entityInterfaceDataByTypeName.get(parentTypeName);
          if (entityInterfaceData) {
            entityInterfaceData.fieldDatas = fieldDatasToSimpleFieldDatas(parentData.fieldDataByName.values());
            const concreteTypeNames = this.concreteTypeNamesByAbstractTypeName.get(parentTypeName);
            if (concreteTypeNames) {
              addIterableValuesToSet(concreteTypeNames, entityInterfaceData.concreteTypeNames);
            }
            configurationData.isInterfaceObject = entityInterfaceData.isInterfaceObject;
            configurationData.entityInterfaceConcreteTypeNames = entityInterfaceData.concreteTypeNames;
          }
          const events = this.eventsConfigurations.get(newParentTypeName);
          if (events) {
            configurationData.events = events;
          }
          this.addFieldNamesToConfigurationData(parentData.fieldDataByName, configurationData);
          this.validateInterfaceImplementations(parentData);
          definitions.push(this.getCompositeOutputNodeByData(parentData));
          // interfaces and objects must define at least one field
          if (parentData.fieldDataByName.size < 1 && !isNodeQuery(parentTypeName, operationTypeNode)) {
            this.errors.push(noFieldDefinitionsError(kindToNodeType(parentData.kind), parentTypeName));
          }
          if (isObject && parentData.requireFetchReasonsFieldNames.size > 0) {
            configurationData.requireFetchReasonsFieldNames = [...parentData.requireFetchReasonsFieldNames];
          }
          break;
        }
        case Kind.SCALAR_TYPE_DEFINITION: {
          if (parentData.extensionType === ExtensionType.REAL) {
            this.errors.push(noBaseScalarDefinitionError(parentTypeName));
            break;
          }
          definitions.push(this.getScalarNodeByData(parentData));
          break;
        }
        case Kind.UNION_TYPE_DEFINITION: {
          definitions.push(this.getUnionNodeByData(parentData));
          this.validateUnionMembers(parentData);
          break;
        }
        default: {
          throw unexpectedKindFatalError(parentTypeName);
        }
      }
    }
    // this is where @provides and @requires configurations are added to the ConfigurationData
    this.addValidConditionalFieldSetConfigurations();
    // this is where @key configurations are added to the ConfigurationData
    this.addValidKeyFieldSetConfigurations();
    // Check that explicitly defined operations types are valid objects and that their fields are also valid
    for (const operationType of Object.values(OperationTypeNode)) {
      const operationTypeNode = this.schemaData.operationTypes.get(operationType);
      const defaultTypeName = getOrThrowError(operationTypeNodeToDefaultType, operationType, OPERATION_TO_DEFAULT);
      // If an operation type name was not declared, use the default
      const operationTypeName = operationTypeNode ? getTypeNodeNamedTypeName(operationTypeNode.type) : defaultTypeName;
      // This check is so undefined type errors are not improperly propagated
      if (BASE_SCALARS.has(operationTypeName)) {
        this.referencedTypeNames.add(operationTypeName);
      }
      // If a custom type is used, the default type should not be defined
      if (operationTypeName !== defaultTypeName && this.parentDefinitionDataByTypeName.has(defaultTypeName)) {
        this.errors.push(invalidRootTypeDefinitionError(operationType, operationTypeName, defaultTypeName));
        continue;
      }
      const objectData = this.parentDefinitionDataByTypeName.get(operationTypeName);
      // operationTypeNode is truthy if an operation type was explicitly declared
      if (operationTypeNode) {
        // If the type is not defined in the schema, it will be handled when checking references
        if (!objectData) {
          continue;
        }
        // Add the explicitly defined type to the map for the federation-factory
        this.operationTypeNodeByTypeName.set(operationTypeName, operationType);
      }
      if (!objectData) {
        continue;
      }
      const rootNode = this.configurationDataByTypeName.get(defaultTypeName);
      if (rootNode) {
        rootNode.isRootNode = true;
        rootNode.typeName = defaultTypeName;
      }
      if (objectData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        this.errors.push(operationDefinitionError(operationTypeName, operationType, objectData.kind));
      }
    }
    for (const referencedTypeName of this.referencedTypeNames) {
      const parentData = this.parentDefinitionDataByTypeName.get(referencedTypeName);
      if (!parentData) {
        this.errors.push(undefinedTypeError(referencedTypeName));
        continue;
      }
      if (parentData.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        continue;
      }
      // There will be a run time error if a field can return an Interface without any Object implementations.
      const implementationTypeNames = this.concreteTypeNamesByAbstractTypeName.get(referencedTypeName);
      if (!implementationTypeNames || implementationTypeNames.size < 0) {
        // Temporarily propagate as a warning until @inaccessible, entity interfaces and other such considerations are handled
        this.warnings.push(unimplementedInterfaceOutputTypeWarning(this.subgraphName, referencedTypeName));
      }
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
      conditionalFieldDataByCoordinates: this.conditionalFieldDataByCoords,
      configurationDataByTypeName: this.configurationDataByTypeName,
      entityDataByTypeName: this.entityDataByTypeName,
      entityInterfaces: this.entityInterfaceDataByTypeName,
      fieldCoordsByNamedTypeName: this.fieldCoordsByNamedTypeName,
      isEventDrivenGraph: this.isSubgraphEventDrivenGraph,
      isVersionTwo: this.isSubgraphVersionTwo,
      keyFieldNamesByParentTypeName: this.keyFieldNamesByParentTypeName,
      keyFieldSetsByEntityTypeNameByKeyFieldCoords: this.keyFieldSetsByEntityTypeNameByFieldCoords,
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
  const invalidORScopesCoords = new Set<string>();
  const fieldCoordsByNamedTypeName = new Map<string, Set<string>>();
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
      upsertAuthorizationData(authorizationDataByParentTypeName, authorizationData, invalidORScopesCoords);
    }
    for (const [namedTypeName, fieldCoords] of normalizationResult.fieldCoordsByNamedTypeName) {
      addIterableValuesToSet(
        fieldCoords,
        getValueOrDefault(fieldCoordsByNamedTypeName, namedTypeName, () => new Set<string>()),
      );
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
    for (const [typeName, entityData] of normalizationResult.entityDataByTypeName) {
      const keyFieldSetDataByFieldSet = entityData.keyFieldSetDatasBySubgraphName.get(subgraphName);
      if (!keyFieldSetDataByFieldSet) {
        continue;
      }
      upsertEntityData({
        entityDataByTypeName,
        keyFieldSetDataByFieldSet,
        typeName,
        subgraphName,
      });
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
          const fieldCoords = `${originalParentTypeName}.${fieldName}`;
          const sourceSubgraphs = overrideSourceSubgraphNamesByFieldPath.get(fieldCoords);
          if (!sourceSubgraphs) {
            overrideSourceSubgraphNamesByFieldPath.set(fieldCoords, [subgraphName]);
            continue;
          }
          sourceSubgraphs.push(subgraphName);
          duplicateOverriddenFieldPaths.add(fieldCoords);
        }
      }
    }
  }
  const allErrors: Array<Error> = [];
  if (invalidORScopesCoords.size > 0) {
    allErrors.push(orScopesLimitError(MAX_OR_SCOPES, [...invalidORScopesCoords]));
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
      subtractSet(fieldNames, configurationData.fieldNames);
      if (configurationData.fieldNames.size < 1) {
        internalSubgraph.configurationDataByTypeName.delete(parentTypeName);
      }
    }
  }

  return {
    authorizationDataByParentTypeName,
    concreteTypeNamesByAbstractTypeName,
    entityDataByTypeName,
    fieldCoordsByNamedTypeName,
    internalSubgraphBySubgraphName: internalSubgraphBySubgraphName,
    internalGraph,
    success: true,
    warnings,
  };
}
