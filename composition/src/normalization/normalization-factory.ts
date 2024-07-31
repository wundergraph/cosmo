import {
  ConstDirectiveNode,
  DefinitionNode,
  DirectiveDefinitionNode,
  DirectiveNode,
  DocumentNode,
  FieldDefinitionNode,
  GraphQLSchema,
  InterfaceTypeDefinitionNode,
  InterfaceTypeExtensionNode,
  Kind,
  ListValueNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  OperationTypeDefinitionNode,
  OperationTypeNode,
  print,
  StringValueNode,
  TypeNode,
} from 'graphql';
import {
  areBaseAndExtensionKindsCompatible,
  EnumTypeNode,
  extractExecutableDirectiveLocations,
  extractInterfaces,
  InterfaceTypeNode,
  isNodeInterfaceObject,
  isObjectLikeNodeEntity,
  ObjectTypeNode,
  operationTypeNodeToDefaultType,
  safeParse,
  ScalarTypeNode,
} from '../ast/utils';
import {
  addFieldNamesToConfigurationData,
  FieldSetData,
  InputValidationContainer,
  isNodeQuery,
  validateAndAddFieldSetDirectivesToConfigurationData,
} from './utils';
import {
  BASE_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME,
  BASE_DIRECTIVE_DEFINITIONS,
  BASE_SCALARS,
  EVENT_DRIVEN_DIRECTIVE_DEFINITIONS_BY_DIRECTIVE_NAME,
  FIELD_SET_SCALAR_DEFINITION,
  SCOPE_SCALAR_DEFINITION,
  SUBSCRIPTION_FIELD_CONDITION_DEFINITION,
  SUBSCRIPTION_FILTER_CONDITION_DEFINITION,
  SUBSCRIPTION_FILTER_DEFINITION,
  SUBSCRIPTION_FILTER_VALUE_DEFINITION,
  VERSION_TWO_DIRECTIVE_DEFINITIONS,
} from '../utils/constants';
import {
  addIterableValuesToSet,
  AuthorizationData,
  EntityData,
  EntityInterfaceSubgraphData,
  FieldAuthorizationData,
  fieldDatasToSimpleFieldDatas,
  getAuthorizationDataToUpdate,
  getOrThrowError,
  getValueOrDefault,
  ImplementationErrors,
  InvalidArgument,
  InvalidFieldImplementation,
  isNodeKindInterface,
  kindToTypeString,
  maxOrScopes,
  mergeAuthorizationDataByAND,
  newAuthorizationData,
  resetAuthorizationData,
  setAndGetValue,
  subtractSourceSetFromTargetSet,
  upsertAuthorizationData,
  upsertEntityData,
  upsertFieldAuthorizationData,
} from '../utils/utils';
import {
  duplicateEnumValueDefinitionError,
  duplicateFieldDefinitionError,
  duplicateInterfaceExtensionError,
  duplicateOverriddenFieldErrorMessage,
  duplicateOverriddenFieldsError,
  equivalentSourceAndTargetOverrideErrorMessage,
  expectedEntityError,
  incompatibleExtensionError,
  incompatibleExtensionKindsError,
  invalidArgumentsError,
  invalidDirectiveArgumentTypeErrorMessage,
  invalidDirectiveError,
  invalidEdfsDirectiveName,
  invalidEdfsPublishResultObjectErrorMessage,
  invalidEventDirectiveError,
  invalidEventDrivenGraphError,
  invalidEventDrivenMutationResponseTypeErrorMessage,
  invalidEventProviderIdErrorMessage,
  invalidEventSubjectErrorMessage,
  invalidEventSubjectsErrorMessage,
  invalidEventSubjectsItemErrorMessage,
  invalidImplementedTypeError,
  invalidInterfaceImplementationError,
  invalidKeyDirectiveArgumentErrorMessage,
  invalidKeyDirectivesError,
  invalidKeyFieldSetsEventDrivenErrorMessage,
  invalidNatsStreamConfigurationDefinitionErrorMessage,
  invalidNatsStreamInputErrorMessage,
  invalidNatsStreamInputFieldsErrorMessage,
  invalidRootTypeDefinitionError,
  invalidRootTypeError,
  invalidRootTypeFieldEventsDirectivesErrorMessage,
  invalidRootTypeFieldResponseTypesEventDrivenErrorMessage,
  invalidSubgraphNameErrorMessage,
  invalidSubgraphNamesError,
  invalidSubscriptionFilterLocationError,
  invalidUnionMemberTypeError,
  noBaseTypeExtensionError,
  noFieldDefinitionsError,
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
  undefinedNatsStreamConfigurationInputErrorMessage,
  undefinedObjectLikeParentError,
  undefinedRequiredArgumentsErrorMessage,
  undefinedTypeError,
  unexpectedKindFatalError,
} from '../errors/errors';
import {
  AUTHENTICATED,
  CONSUMER_NAME,
  DEFAULT_EDFS_PROVIDER_ID,
  EDFS_KAFKA_PUBLISH,
  EDFS_KAFKA_SUBSCRIBE,
  EDFS_NATS_PUBLISH,
  EDFS_NATS_REQUEST,
  EDFS_NATS_STREAM_CONFIGURATION,
  EDFS_NATS_SUBSCRIBE,
  EDFS_PUBLISH_RESULT,
  ENTITIES_FIELD,
  EVENT_DIRECTIVE_NAMES,
  EXTENDS,
  EXTERNAL,
  FIELDS,
  FROM,
  INACCESSIBLE,
  KEY,
  MUTATION,
  N_A,
  NON_NULLABLE_BOOLEAN,
  NON_NULLABLE_EDFS_PUBLISH_EVENT_RESULT,
  NON_NULLABLE_STRING,
  OPERATION_TO_DEFAULT,
  OVERRIDE,
  PROVIDER_ID,
  PROVIDER_TYPE_KAFKA,
  PROVIDER_TYPE_NATS,
  PUBLISH,
  QUERY,
  REQUEST,
  REQUIRES_SCOPES,
  RESOLVABLE,
  SCHEMA,
  SCOPES,
  SERVICE_FIELD,
  STREAM_CONFIGURATION,
  STREAM_CONFIGURATION_FIELD_NAMES,
  STREAM_NAME,
  SUBJECT,
  SUBJECTS,
  SUBSCRIBE,
  SUBSCRIPTION,
  SUBSCRIPTION_FILTER,
  SUCCESS,
  TOPIC,
  TOPICS,
} from '../utils/string-constants';
import { buildASTSchema } from '../buildASTSchema/buildASTSchema';
import { ConfigurationData, EventConfiguration, NatsEventType } from '../router-configuration/router-configuration';
import { printTypeNode } from '@graphql-tools/merge';
import { InternalSubgraph, recordSubgraphName, Subgraph } from '../subgraph/subgraph';
import { invalidOverrideTargetSubgraphNameWarning } from '../warnings/warnings';
import {
  consolidateAuthorizationDirectives,
  upsertDirectiveSchemaAndEntityDefinitions,
  upsertParentsAndChildren,
} from './walkers';
import {
  FieldData,
  ParentDefinitionData,
  ParentWithFieldsData,
  PersistedDirectiveDefinitionData,
  SchemaData,
  UnionDefinitionData,
} from '../schema-building/type-definition-data';
import {
  EnumExtensionData,
  ExtensionWithFieldsData,
  InputObjectExtensionData,
  ObjectExtensionData,
  ParentExtensionData,
  ScalarExtensionData,
  UnionExtensionData,
} from '../schema-building/type-extension-data';
import {
  addExtensionWithFieldsDataByNode,
  addPersistedDirectiveDefinitionDataByNode,
  convertKindForExtension,
  extractDirectives,
  getDirectiveValidationErrors,
  getEnumNodeByData,
  getInputObjectNodeByData,
  getParentWithFieldsNodeByData,
  getScalarNodeByData,
  getSchemaNodeByData,
  getUnionNodeByData,
  isTypeValidImplementation,
  ObjectData,
} from '../schema-building/utils';
import { getTypeNodeNamedTypeName, ObjectLikeTypeNode } from '../schema-building/ast';
import { InvalidRootTypeFieldEventsDirectiveData } from '../errors/utils';
import { Graph } from '../resolvability-graph/graph';
import { UnionTypeDefinitionNode, UnionTypeExtensionNode } from 'graphql/index';

export type NormalizationResult = {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  configurationDataByParentTypeName: Map<string, ConfigurationData>;
  entityInterfaces: Map<string, EntityInterfaceSubgraphData>;
  entityDataByTypeName: Map<string, EntityData>;
  originalTypeNameByRenamedTypeName: Map<string, string>;
  isEventDrivenGraph: boolean;
  isVersionTwo: boolean;
  keyFieldNamesByParentTypeName: Map<string, Set<string>>;
  operationTypes: Map<string, OperationTypeNode>;
  overridesByTargetSubgraphName: Map<string, Map<string, Set<string>>>;
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>;
  parentExtensionDataByTypeName: Map<string, ObjectExtensionData>;
  persistedDirectiveDefinitionDataByDirectiveName: Map<string, PersistedDirectiveDefinitionData>;
  schema: GraphQLSchema;
  subgraphAST: DocumentNode;
  subgraphString: string;
};

export type NormalizationResultContainer = {
  errors?: Error[];
  normalizationResult?: NormalizationResult;
};

export type BatchNormalizationContainer = {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  entityDataByTypeName: Map<string, EntityData>;
  internalSubgraphBySubgraphName: Map<string, InternalSubgraph>;
  internalGraph: Graph;
  errors?: Error[];
  warnings?: string[];
};

export function normalizeSubgraphFromString(subgraphSDL: string): NormalizationResultContainer {
  const { error, documentNode } = safeParse(subgraphSDL);
  if (error || !documentNode) {
    return { errors: [subgraphInvalidSyntaxError(error)] };
  }
  const normalizationFactory = new NormalizationFactory(new Graph());
  return normalizationFactory.normalize(documentNode);
}

export function normalizeSubgraph(
  document: DocumentNode,
  subgraphName?: string,
  internalGraph?: Graph,
): NormalizationResultContainer {
  const normalizationFactory = new NormalizationFactory(internalGraph || new Graph(), subgraphName);
  return normalizationFactory.normalize(document);
}

export class NormalizationFactory {
  argumentName = '';
  authorizationDataByParentTypeName = new Map<string, AuthorizationData>();
  childName = '';
  concreteTypeNamesByAbstractTypeName = new Map<string, Set<string>>();
  configurationDataByParentTypeName = new Map<string, ConfigurationData>();
  customDirectiveDefinitions = new Map<string, DirectiveDefinitionNode>();
  directiveDefinitionByDirectiveName = new Map<string, DirectiveDefinitionNode>();
  edfsDirectiveReferences = new Set<string>();
  errors: Error[] = [];
  entityDataByTypeName = new Map<string, EntityData>();
  entityInterfaceDataByTypeName = new Map<string, EntityInterfaceSubgraphData>();
  eventsConfigurations = new Map<string, EventConfiguration[]>();
  interfaceTypeNamesWithAuthorizationDirectives = new Set<string>();
  internalGraph: Graph;
  isCurrentParentExtension = false;
  isSubgraphEventDrivenGraph = false;
  isSubgraphVersionTwo = false;
  fieldSetDataByTypeName = new Map<string, FieldSetData>();
  heirFieldAuthorizationDataByTypeName = new Map<string, FieldAuthorizationData[]>();
  handledRepeatedDirectivesByHostPath = new Map<string, Set<string>>();
  lastParentNodeKind: Kind = Kind.NULL;
  lastChildNodeKind: Kind = Kind.NULL;
  leafTypeNamesWithAuthorizationDirectives = new Set<string>();
  keyFieldNamesByParentTypeName = new Map<string, Set<string>>();
  operationTypeNodeByTypeName = new Map<string, OperationTypeNode>();
  originalTypeNameByRenamedTypeName = new Map<string, string>();
  parentDefinitionDataByTypeName = new Map<string, ParentDefinitionData>();
  parentExtensionDataByTypeName = new Map<string, ParentExtensionData>();
  originalParentTypeName = '';
  parentsWithChildArguments = new Set<string>();
  overridesByTargetSubgraphName = new Map<string, Map<string, Set<string>>>();
  invalidOrScopesHostPaths = new Set<string>();
  schemaDefinition: SchemaData;
  referencedDirectiveNames = new Set<string>();
  referencedTypeNames = new Set<string>();
  renamedParentTypeName = '';
  subgraphName: string;
  warnings: string[] = [];

  constructor(internalGraph: Graph, subgraphName?: string) {
    for (const [baseDirectiveName, baseDirectiveDefinition] of BASE_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME) {
      this.directiveDefinitionByDirectiveName.set(baseDirectiveName, baseDirectiveDefinition);
    }
    this.subgraphName = subgraphName || N_A;
    this.internalGraph = internalGraph;
    this.internalGraph.setSubgraphName(this.subgraphName);
    this.schemaDefinition = {
      directivesByDirectiveName: new Map<string, ConstDirectiveNode[]>(),
      kind: Kind.SCHEMA_DEFINITION,
      typeName: SCHEMA,
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

  extractDirectivesAndAuthorization(
    node: EnumTypeNode | FieldDefinitionNode | ScalarTypeNode,
    directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
  ): Map<string, ConstDirectiveNode[]> {
    if (!node.directives) {
      return directivesByDirectiveName;
    }
    const hostPath = this.childName ? `${this.originalParentTypeName}.${this.childName}` : this.originalParentTypeName;
    const authorizationDirectives: ConstDirectiveNode[] = [];
    for (const directiveNode of node.directives) {
      const errorMessages = getDirectiveValidationErrors(
        directiveNode,
        node.kind,
        directivesByDirectiveName,
        this.directiveDefinitionByDirectiveName,
        this.handledRepeatedDirectivesByHostPath,
        hostPath,
      );
      const directiveName = directiveNode.name.value;
      if (errorMessages.length > 0) {
        this.errors.push(invalidDirectiveError(directiveName, hostPath, errorMessages));
        continue;
      }
      if (directiveName === EXTENDS) {
        continue;
      }
      if (directiveName === OVERRIDE) {
        this.handleOverrideDeclaration(directiveNode, hostPath, errorMessages);
        if (errorMessages.length > 0) {
          this.errors.push(invalidDirectiveError(directiveName, hostPath, errorMessages));
        }
        continue;
      }
      if (directiveName === AUTHENTICATED || directiveName === REQUIRES_SCOPES) {
        authorizationDirectives.push(directiveNode);
        continue;
      }
      const existingDirectives = directivesByDirectiveName.get(directiveName);
      if (existingDirectives) {
        existingDirectives.push(directiveNode);
        continue;
      }
      directivesByDirectiveName.set(directiveName, [directiveNode]);
    }
    if (authorizationDirectives.length < 1) {
      return directivesByDirectiveName;
    }
    const parentTypeName = this.renamedParentTypeName || this.originalParentTypeName;
    if (node.kind !== Kind.FIELD_DEFINITION) {
      this.leafTypeNamesWithAuthorizationDirectives.add(parentTypeName);
    }
    const parentAuthorizationData = getValueOrDefault(this.authorizationDataByParentTypeName, parentTypeName, () =>
      newAuthorizationData(parentTypeName),
    );
    const authorizationData = getAuthorizationDataToUpdate(parentAuthorizationData, node, this.childName);
    for (const directiveNode of authorizationDirectives) {
      const directiveName = directiveNode.name.value;
      if (directiveName === AUTHENTICATED) {
        authorizationData.requiresAuthentication = true;
        continue;
      }
      const orScopes = (directiveNode.arguments![0].value as ListValueNode).values;
      if (orScopes.length > maxOrScopes) {
        this.invalidOrScopesHostPaths.add(hostPath);
        continue;
      }
      for (const scopes of orScopes) {
        const andScopes = new Set<string>();
        for (const scope of (scopes as ListValueNode).values) {
          andScopes.add((scope as StringValueNode).value);
        }
        if (andScopes.size) {
          authorizationData.requiredScopes.push(andScopes);
        }
      }
    }
    return directivesByDirectiveName;
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

  handleInterfaceObject(node: ObjectTypeDefinitionNode) {
    if (!isNodeInterfaceObject(node)) {
      return;
    }
    const typeName = node.name.value;
    if (this.entityInterfaceDataByTypeName.has(typeName)) {
      // TODO error
      return;
    }
    this.entityInterfaceDataByTypeName.set(typeName, {
      fieldDatas: [],
      interfaceObjectFieldNames: new Set<string>(node.fields?.map((field) => field.name.value)),
      interfaceFieldNames: new Set<string>(),
      isInterfaceObject: true,
      typeName,
    });
  }

  handleExtensionWithFields(
    node: InterfaceTypeDefinitionNode | InterfaceTypeExtensionNode | ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
    isRootType = false,
  ): false | void {
    this.isCurrentParentExtension = true;
    const parentExtensionData = this.parentExtensionDataByTypeName.get(this.originalParentTypeName);
    const convertedKind = convertKindForExtension(node);
    if (parentExtensionData) {
      if (parentExtensionData.kind !== convertedKind) {
        this.errors.push(incompatibleExtensionKindsError(node, parentExtensionData.kind));
        return false;
      }
      extractDirectives(
        node,
        parentExtensionData.directivesByDirectiveName,
        this.errors,
        this.directiveDefinitionByDirectiveName,
        this.handledRepeatedDirectivesByHostPath,
        this.originalParentTypeName,
      );
      extractInterfaces(node, parentExtensionData.implementedInterfaceTypeNames, this.errors);
      return;
    }
    const isEntity = isObjectLikeNodeEntity(node);
    addExtensionWithFieldsDataByNode(
      this.parentExtensionDataByTypeName,
      node,
      this.errors,
      this.directiveDefinitionByDirectiveName,
      this.handledRepeatedDirectivesByHostPath,
      isEntity,
      isRootType,
      this.subgraphName,
      this.renamedParentTypeName,
    );
    const entityInterfaceData = this.entityInterfaceDataByTypeName.get(this.renamedParentTypeName);
    if (!entityInterfaceData) {
      return;
    }
    for (const fieldNode of node.fields || []) {
      entityInterfaceData.interfaceFieldNames.add(fieldNode.name.value);
    }
  }

  extractKeyFieldSets(node: ObjectLikeTypeNode, fieldSetData: FieldSetData) {
    const isUnresolvableByRawKeyFieldSet = fieldSetData.isUnresolvableByKeyFieldSet;
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
          errorMessages.push(invalidKeyDirectiveArgumentErrorMessage(arg.value.kind));
          break;
        }
        keyFieldSet = arg.value.value;
      }
      if (keyFieldSet !== undefined) {
        isUnresolvableByRawKeyFieldSet.set(keyFieldSet, isUnresolvable);
      }
    }
    if (errorMessages.length) {
      this.errors.push(invalidKeyDirectivesError(parentTypeName, errorMessages));
    }
  }

  validateInterfaceImplementations(data: ParentWithFieldsData) {
    if (data.implementedInterfaceTypeNames.size < 1) {
      return;
    }
    const isParentInaccessible = data.directivesByDirectiveName.has(INACCESSIBLE);
    const implementationErrorsMap = new Map<string, ImplementationErrors>();
    const invalidImplementationTypeStringByTypeName = new Map<string, string>();
    let doesInterfaceImplementItself = false;
    for (const interfaceName of data.implementedInterfaceTypeNames) {
      const implementationData = this.parentDefinitionDataByTypeName.get(interfaceName);
      if (!implementationData) {
        this.errors.push(undefinedTypeError(interfaceName));
        continue;
      }
      if (implementationData.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        invalidImplementationTypeStringByTypeName.set(
          implementationData.name,
          kindToTypeString(implementationData.kind),
        );
        continue;
      }
      if (data.name === implementationData.name) {
        doesInterfaceImplementItself = true;
        continue;
      }
      const implementationErrors: ImplementationErrors = {
        invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
        unimplementedFields: [],
      };
      let hasErrors = false;
      for (const [fieldName, interfaceField] of implementationData.fieldDataByFieldName) {
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

  handleOverrideDeclaration(node: DirectiveNode, hostPath: string, errorMessages: string[]) {
    const argumentNode = node.arguments![0];
    if (argumentNode.value.kind !== Kind.STRING) {
      errorMessages.push(invalidDirectiveArgumentTypeErrorMessage(true, FROM, Kind.STRING, argumentNode.value.kind));
      return;
    }
    const targetSubgraphName = argumentNode.value.value;
    if (targetSubgraphName === this.subgraphName) {
      errorMessages.push(equivalentSourceAndTargetOverrideErrorMessage(targetSubgraphName, hostPath));
      return;
    }
    const overrideDataForSubgraph = getValueOrDefault(
      this.overridesByTargetSubgraphName,
      targetSubgraphName,
      () => new Map<string, Set<string>>(),
    );
    const overriddenFieldNamesForParent = getValueOrDefault(
      overrideDataForSubgraph,
      this.renamedParentTypeName || this.originalParentTypeName,
      () => new Set<string>(),
    );
    overriddenFieldNamesForParent.add(this.childName);
  }

  getKafkaPublishConfiguration(directive: ConstDirectiveNode, errorMessages: string[]): EventConfiguration | undefined {
    const topics: string[] = [];
    let providerId = DEFAULT_EDFS_PROVIDER_ID;
    for (const argumentNode of directive.arguments || []) {
      switch (argumentNode.name.value) {
        case TOPIC: {
          if (argumentNode.value.kind !== Kind.STRING || argumentNode.value.value.length < 1) {
            errorMessages.push(invalidEventSubjectErrorMessage(TOPIC));
            continue;
          }
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
    errorMessages: string[],
  ): EventConfiguration | undefined {
    const subjects: string[] = [];
    let providerId = DEFAULT_EDFS_PROVIDER_ID;
    let consumerName = '';
    let streamName = '';
    for (const argumentNode of directive.arguments || []) {
      switch (argumentNode.name.value) {
        case SUBJECTS: {
          if (argumentNode.value.kind !== Kind.LIST) {
            errorMessages.push(invalidEventSubjectsErrorMessage(SUBJECTS));
            continue;
          }
          for (const value of argumentNode.value.values) {
            if (value.kind !== Kind.STRING || value.value.length < 1) {
              errorMessages.push(invalidEventSubjectsItemErrorMessage(SUBJECTS));
              break;
            }
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
          if (argumentNode.value.kind !== Kind.OBJECT || argumentNode.value.fields.length < 1) {
            errorMessages.push(invalidNatsStreamInputErrorMessage);
            continue;
          }
          let isValid = true;
          const invalidFieldNames = new Set<string>();
          const missingRequiredFieldNames = new Set<string>([CONSUMER_NAME, STREAM_NAME]);
          const duplicateRequiredFieldNames = new Set<string>();
          const invalidRequiredFieldNames = new Set<string>();
          for (const field of argumentNode.value.fields) {
            const fieldName = field.name.value;
            if (!STREAM_CONFIGURATION_FIELD_NAMES.has(fieldName)) {
              invalidFieldNames.add(fieldName);
              isValid = false;
              continue;
            }
            if (missingRequiredFieldNames.has(fieldName)) {
              missingRequiredFieldNames.delete(fieldName);
            } else {
              duplicateRequiredFieldNames.add(fieldName);
              isValid = false;
              continue;
            }
            if (field.value.kind !== Kind.STRING || field.value.value.length < 1) {
              invalidRequiredFieldNames.add(fieldName);
              isValid = false;
              continue;
            }
            switch (fieldName) {
              case CONSUMER_NAME:
                consumerName = field.value.value;
                break;
              case STREAM_NAME:
                streamName = field.value.value;
                break;
            }
          }
          if (!isValid || missingRequiredFieldNames.size > 0) {
            errorMessages.push(
              invalidNatsStreamInputFieldsErrorMessage(
                [...missingRequiredFieldNames],
                [...duplicateRequiredFieldNames],
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
    return {
      fieldName: this.childName,
      providerId,
      providerType: PROVIDER_TYPE_NATS,
      subjects,
      type: SUBSCRIBE,
      ...(consumerName && streamName ? { streamConfiguration: { consumerName: consumerName, streamName } } : {}),
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

  extractEventDirectivesToConfiguration(node: FieldDefinitionNode) {
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
          eventConfiguration = this.getKafkaPublishConfiguration(directive, errorMessages);
          break;
        case EDFS_KAFKA_SUBSCRIBE:
          eventConfiguration = this.getKafkaSubscribeConfiguration(directive, errorMessages);
          break;
        case EDFS_NATS_PUBLISH: {
          eventConfiguration = this.getNatsPublishAndRequestConfiguration(PUBLISH, directive, errorMessages);
          break;
        }
        case EDFS_NATS_REQUEST: {
          eventConfiguration = this.getNatsPublishAndRequestConfiguration(REQUEST, directive, errorMessages);
          break;
        }
        case EDFS_NATS_SUBSCRIBE: {
          eventConfiguration = this.getNatsSubscribeConfiguration(directive, errorMessages);
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
    data: ObjectData,
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
    const fieldSetData = this.fieldSetDataByTypeName.get(typeName);
    if (!fieldSetData) {
      return;
    }
    for (const [keyFieldSet, isUnresolvable] of fieldSetData.isUnresolvableByKeyFieldSet) {
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
    if (streamConfigurationInputData.inputValueDataByValueName.size != 2) {
      return false;
    }
    const requiredInputValueNames = new Set<string>([CONSUMER_NAME, STREAM_NAME]);
    for (const [inputValueName, inputValueData] of streamConfigurationInputData.inputValueDataByValueName) {
      if (!requiredInputValueNames.has(inputValueName)) {
        return false;
      }
      requiredInputValueNames.delete(inputValueName);
      if (printTypeNode(inputValueData.type) !== NON_NULLABLE_STRING) {
        return false;
      }
    }
    return requiredInputValueNames.size < 1;
  }

  validateEventDrivenSubgraph() {
    const errorMessages: string[] = [];
    const invalidEventsDirectiveDataByRootFieldPath = new Map<string, InvalidRootTypeFieldEventsDirectiveData>();
    const invalidResponseTypeStringByRootFieldPath = new Map<string, string>();
    const invalidResponseTypeNameByMutationPath = new Map<string, string>();
    const invalidKeyFieldSetsByEntityTypeName = new Map<string, string[]>();
    const nonExternalKeyFieldNameByFieldPath = new Map<string, string>();
    const nonKeyFieldNameByFieldPath = new Map<string, string>();
    const nonEntityExtensionTypeNames = new Set<string>();
    const invalidObjectTypeNames = new Set<string>();
    for (const [typeName, data] of this.parentExtensionDataByTypeName) {
      if (data.kind !== Kind.OBJECT_TYPE_EXTENSION) {
        continue;
      }
      // If a required events directive is returned, the parent type is a root type
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
      if (!keyFieldNames || !data.isEntity) {
        nonEntityExtensionTypeNames.add(typeName);
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
      if (!streamConfigurationInputData) {
        errorMessages.push(undefinedNatsStreamConfigurationInputErrorMessage);
      } else if (!this.isNatsStreamConfigurationInputObjectValid(streamConfigurationInputData)) {
        errorMessages.push(invalidNatsStreamConfigurationDefinitionErrorMessage);
      }
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
    const invalidMembers: string[] = [];
    for (const memberName of data.memberByMemberTypeName.keys()) {
      const memberData =
        this.parentDefinitionDataByTypeName.get(memberName) || this.parentExtensionDataByTypeName.get(memberName);
      // Invalid references are propagated as an error elsewhere
      if (!memberData) {
        continue;
      }
      if (memberData.kind !== Kind.OBJECT_TYPE_DEFINITION && memberData.kind !== Kind.OBJECT_TYPE_EXTENSION) {
        invalidMembers.push(`"${memberName}", which is type "${kindToTypeString(memberData.kind)}"`);
      }
    }
    if (invalidMembers.length > 0) {
      this.errors.push(invalidUnionMemberTypeError(data.name, invalidMembers));
    }
  }

  addConcreteTypesForImplementedInterfaces(node: ObjectTypeDefinitionNode | ObjectTypeExtensionNode) {
    if (!node.interfaces || node.interfaces.length < 1) {
      return;
    }
    const concreteTypeName = node.name.value;
    for (const iFace of node.interfaces) {
      const interfaceName = iFace.name.value;
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

  addConcreteTypesForUnion(node: UnionTypeDefinitionNode | UnionTypeExtensionNode) {
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

  normalize(document: DocumentNode): NormalizationResultContainer {
    /* factory.allDirectiveDefinitions is initialized with v1 directive definitions, and v2 definitions are only added
    after the visitor has visited the entire schema and the subgraph is known to be a V2 graph. Consequently,
    allDirectiveDefinitions cannot be used to check for duplicate definitions, and another set (below) is required */

    // Collect any renamed root types
    upsertDirectiveSchemaAndEntityDefinitions(this, document);
    upsertParentsAndChildren(this, document);
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
      this.directiveDefinitionByDirectiveName.set(SUBSCRIPTION_FILTER, SUBSCRIPTION_FILTER_DEFINITION);
      definitions.push(SUBSCRIPTION_FILTER_DEFINITION);
      definitions.push(SUBSCRIPTION_FILTER_CONDITION_DEFINITION);
      definitions.push(SUBSCRIPTION_FIELD_CONDITION_DEFINITION);
      definitions.push(SUBSCRIPTION_FILTER_VALUE_DEFINITION);
    }
    for (const directiveDefinition of this.customDirectiveDefinitions.values()) {
      definitions.push(directiveDefinition);
    }
    if (this.schemaDefinition.operationTypes.size > 0) {
      definitions.push(
        getSchemaNodeByData(this.schemaDefinition, this.errors, this.directiveDefinitionByDirectiveName),
      );
    }

    const validParentExtensionOrphansByTypeName = new Map<string, ObjectExtensionData>();
    const handledParentTypeNames = new Set<string>();
    for (const [extensionTypeName, parentExtensionData] of this.parentExtensionDataByTypeName) {
      const isEntity = this.entityDataByTypeName.has(extensionTypeName);
      const newParentTypeName =
        parentExtensionData.kind === Kind.OBJECT_TYPE_EXTENSION
          ? parentExtensionData.renamedTypeName || extensionTypeName
          : extensionTypeName;
      const configurationData: ConfigurationData = {
        fieldNames: new Set<string>(),
        isRootNode: isEntity,
        typeName: newParentTypeName,
      };
      this.configurationDataByParentTypeName.set(newParentTypeName, configurationData);
      if (parentExtensionData.kind === Kind.OBJECT_TYPE_EXTENSION) {
        if (this.operationTypeNodeByTypeName.has(extensionTypeName)) {
          configurationData.isRootNode = true;
          parentExtensionData.fieldDataByFieldName.delete(SERVICE_FIELD);
          parentExtensionData.fieldDataByFieldName.delete(ENTITIES_FIELD);
        }
        addFieldNamesToConfigurationData(parentExtensionData.fieldDataByFieldName, configurationData);
      }
      const parentDefinitionData = this.parentDefinitionDataByTypeName.get(extensionTypeName);
      if (!parentDefinitionData) {
        if (parentExtensionData.kind !== Kind.OBJECT_TYPE_EXTENSION) {
          this.errors.push(noBaseTypeExtensionError(extensionTypeName));
        } else {
          this.validateInterfaceImplementations(parentExtensionData);
          validParentExtensionOrphansByTypeName.set(extensionTypeName, parentExtensionData);
          definitions.push(
            getParentWithFieldsNodeByData(
              parentExtensionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              this.authorizationDataByParentTypeName,
            ),
          );
        }
        continue;
      }
      if (!areBaseAndExtensionKindsCompatible(parentDefinitionData.kind, parentExtensionData.kind, extensionTypeName)) {
        this.errors.push(
          incompatibleExtensionError(extensionTypeName, parentDefinitionData.kind, parentExtensionData.kind),
        );
        continue;
      }
      switch (parentDefinitionData.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
          const enumExtensionData = parentExtensionData as EnumExtensionData;
          for (const [valueName, enumValueDefinitionNode] of enumExtensionData.enumValueDataByValueName) {
            if (!parentDefinitionData.enumValueDataByValueName.has(valueName)) {
              parentDefinitionData.enumValueDataByValueName.set(valueName, enumValueDefinitionNode);
              continue;
            }
            this.errors.push(duplicateEnumValueDefinitionError(valueName, extensionTypeName));
          }
          definitions.push(
            getEnumNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              this.authorizationDataByParentTypeName,
              enumExtensionData,
            ),
          );
          break;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          const inputObjectExtensionData = parentExtensionData as InputObjectExtensionData;
          for (const [fieldName, inputValueDefinitionNode] of inputObjectExtensionData.inputValueDataByValueName) {
            if (!parentDefinitionData.inputValueDataByValueName.has(fieldName)) {
              parentDefinitionData.inputValueDataByValueName.set(fieldName, inputValueDefinitionNode);
              continue;
            }
            this.errors.push(duplicateFieldDefinitionError(fieldName, extensionTypeName));
          }
          definitions.push(
            getInputObjectNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              this.authorizationDataByParentTypeName,
              inputObjectExtensionData,
            ),
          );
          break;
        case Kind.INTERFACE_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.OBJECT_TYPE_DEFINITION:
          const extensionWithFieldsData = parentExtensionData as ExtensionWithFieldsData;
          const operationTypeNode = this.operationTypeNodeByTypeName.get(extensionTypeName);
          if (operationTypeNode) {
            configurationData.isRootNode = true;
            extensionWithFieldsData.fieldDataByFieldName.delete(SERVICE_FIELD);
            extensionWithFieldsData.fieldDataByFieldName.delete(ENTITIES_FIELD);
          }
          for (const [fieldName, fieldData] of extensionWithFieldsData.fieldDataByFieldName) {
            if (fieldData.argumentDataByArgumentName.size > 0) {
              // Arguments can only be fully validated once all parents types are known
              this.validateArguments(fieldData, `${extensionTypeName}.${fieldName}`);
            }
            if (parentDefinitionData.fieldDataByFieldName.has(fieldName)) {
              this.errors.push(duplicateFieldDefinitionError(fieldName, extensionTypeName));
              continue;
            }
            parentDefinitionData.fieldDataByFieldName.set(fieldName, fieldData);
            if (!fieldData.argumentDataByArgumentName.has(EXTERNAL)) {
              configurationData.fieldNames.add(fieldName);
            }
          }
          this.mergeUniqueInterfaces(
            extensionWithFieldsData.implementedInterfaceTypeNames,
            parentDefinitionData.implementedInterfaceTypeNames,
            extensionTypeName,
          );
          this.validateInterfaceImplementations(parentDefinitionData);
          definitions.push(
            getParentWithFieldsNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              this.authorizationDataByParentTypeName,
              extensionWithFieldsData,
            ),
          );
          // Interfaces and objects must define at least one field
          if (
            parentDefinitionData.fieldDataByFieldName.size < 1 &&
            !isNodeQuery(extensionTypeName, operationTypeNode)
          ) {
            this.errors.push(noFieldDefinitionsError(kindToTypeString(parentDefinitionData.kind), extensionTypeName));
          }
          // Add the base type field names to the configuration data
          addFieldNamesToConfigurationData(parentDefinitionData.fieldDataByFieldName, configurationData);
          break;
        case Kind.SCALAR_TYPE_DEFINITION:
          definitions.push(
            getScalarNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              parentExtensionData as ScalarExtensionData,
            ),
          );
          break;
        case Kind.UNION_TYPE_DEFINITION:
          definitions.push(
            getUnionNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              parentExtensionData as UnionExtensionData,
            ),
          );
          this.validateUnionMembers(parentDefinitionData);
          break;
        default:
          throw unexpectedKindFatalError(extensionTypeName);
      }
      // At this point, the base type has been dealt with, so it doesn't need to be dealt with again
      handledParentTypeNames.add(extensionTypeName);
    }
    for (const [parentTypeName, parentDefinitionData] of this.parentDefinitionDataByTypeName) {
      if (handledParentTypeNames.has(parentTypeName)) {
        continue;
      }
      switch (parentDefinitionData.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
          definitions.push(
            getEnumNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              this.authorizationDataByParentTypeName,
            ),
          );
          break;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          definitions.push(
            getInputObjectNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              this.authorizationDataByParentTypeName,
            ),
          );
          break;
        case Kind.INTERFACE_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.OBJECT_TYPE_DEFINITION:
          const isEntity = this.entityDataByTypeName.has(parentTypeName);
          const operationTypeNode = this.operationTypeNodeByTypeName.get(parentTypeName);
          if (operationTypeNode) {
            parentDefinitionData.fieldDataByFieldName.delete(SERVICE_FIELD);
            parentDefinitionData.fieldDataByFieldName.delete(ENTITIES_FIELD);
          }
          if (this.parentsWithChildArguments.has(parentTypeName)) {
            if (
              parentDefinitionData.kind !== Kind.OBJECT_TYPE_DEFINITION &&
              parentDefinitionData.kind !== Kind.INTERFACE_TYPE_DEFINITION
            ) {
              continue;
            }
            for (const [fieldName, fieldData] of parentDefinitionData.fieldDataByFieldName) {
              // Arguments can only be fully validated once all parents types are known
              this.validateArguments(fieldData, `${parentTypeName}.${fieldName}`);
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
          definitions.push(
            getParentWithFieldsNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              this.authorizationDataByParentTypeName,
            ),
          );
          // interfaces and objects must define at least one field
          if (parentDefinitionData.fieldDataByFieldName.size < 1 && !isNodeQuery(parentTypeName, operationTypeNode)) {
            this.errors.push(noFieldDefinitionsError(kindToTypeString(parentDefinitionData.kind), parentTypeName));
          }
          break;
        case Kind.SCALAR_TYPE_DEFINITION:
          definitions.push(
            getScalarNodeByData(parentDefinitionData, this.errors, this.directiveDefinitionByDirectiveName),
          );
          break;
        case Kind.UNION_TYPE_DEFINITION:
          definitions.push(
            getUnionNodeByData(parentDefinitionData, this.errors, this.directiveDefinitionByDirectiveName),
          );
          this.validateUnionMembers(parentDefinitionData);
          break;
        default:
          throw unexpectedKindFatalError(parentTypeName);
      }
    }
    // Check that explicitly defined operations types are valid objects and that their fields are also valid
    for (const operationType of Object.values(OperationTypeNode)) {
      const operationTypeNode = this.schemaDefinition.operationTypes.get(operationType);
      const defaultTypeName = getOrThrowError(operationTypeNodeToDefaultType, operationType, OPERATION_TO_DEFAULT);
      // If an operation type name was not declared, use the default
      const operationTypeName = operationTypeNode ? getTypeNodeNamedTypeName(operationTypeNode.type) : defaultTypeName;
      // If a custom type is used, the default type should not be defined
      if (
        operationTypeName !== defaultTypeName &&
        (this.parentDefinitionDataByTypeName.has(defaultTypeName) ||
          this.parentExtensionDataByTypeName.has(defaultTypeName))
      ) {
        this.errors.push(invalidRootTypeDefinitionError(operationType, operationTypeName, defaultTypeName));
        continue;
      }
      const objectData = this.parentDefinitionDataByTypeName.get(operationTypeName);
      const extensionData = this.parentExtensionDataByTypeName.get(operationTypeName);
      // operationTypeNode is truthy if an operation type was explicitly declared
      if (operationTypeNode) {
        // If the type is not defined in the schema, it's always an error
        if (!objectData && !extensionData) {
          this.errors.push(undefinedTypeError(operationTypeName));
          continue;
        }
        // Add the explicitly defined type to the map for the federation-factory
        this.operationTypeNodeByTypeName.set(operationTypeName, operationType);
      }
      if (!objectData && !extensionData) {
        continue;
      }
      const rootNode = this.configurationDataByParentTypeName.get(defaultTypeName);
      if (rootNode) {
        rootNode.isRootNode = true;
        rootNode.typeName = defaultTypeName;
      }
      const parentDatas = [objectData, extensionData];
      for (const parentData of parentDatas) {
        if (!parentData) {
          continue;
        }
        if (parentData.kind !== Kind.OBJECT_TYPE_DEFINITION && parentData.kind !== Kind.OBJECT_TYPE_EXTENSION) {
          this.errors.push(operationDefinitionError(operationTypeName, operationType, parentData.kind));
          continue;
        }
        // Root types fields whose response type is an extension orphan could be valid through a federated graph
        // However, the field would have to be shareable to ever be valid TODO
        for (const fieldData of parentData.fieldDataByFieldName.values()) {
          const fieldTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
          if (
            !BASE_SCALARS.has(fieldTypeName) &&
            !this.parentDefinitionDataByTypeName.has(fieldTypeName) &&
            !validParentExtensionOrphansByTypeName.has(fieldTypeName)
          ) {
            this.errors.push(undefinedTypeError(fieldTypeName));
          }
        }
      }
    }
    for (const referencedTypeName of this.referencedTypeNames) {
      if (
        this.parentDefinitionDataByTypeName.has(referencedTypeName) ||
        this.entityDataByTypeName.has(referencedTypeName)
      ) {
        continue;
      }
      const extension = this.parentExtensionDataByTypeName.get(referencedTypeName);
      if (!extension || extension.kind !== Kind.OBJECT_TYPE_EXTENSION) {
        this.errors.push(undefinedTypeError(referencedTypeName));
      }
    }
    for (const [parentTypeName, fieldSetData] of this.fieldSetDataByTypeName) {
      const parentData =
        this.parentDefinitionDataByTypeName.get(parentTypeName) ||
        this.parentExtensionDataByTypeName.get(parentTypeName);
      if (
        !parentData ||
        (parentData.kind !== Kind.OBJECT_TYPE_DEFINITION &&
          parentData.kind != Kind.OBJECT_TYPE_EXTENSION &&
          parentData.kind !== Kind.INTERFACE_TYPE_DEFINITION &&
          parentData.kind !== Kind.INTERFACE_TYPE_EXTENSION)
      ) {
        this.errors.push(undefinedObjectLikeParentError(parentTypeName));
        continue;
      }
      // this is where keys, provides, and requires are added to the ConfigurationData
      validateAndAddFieldSetDirectivesToConfigurationData(this, parentData, fieldSetData);
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
      addPersistedDirectiveDefinitionDataByNode(
        persistedDirectiveDefinitionDataByDirectiveName,
        directiveDefinitionNode,
        this.errors,
        this.directiveDefinitionByDirectiveName,
        this.handledRepeatedDirectivesByHostPath,
        executableLocations,
        this.subgraphName,
      );
    }
    this.isSubgraphEventDrivenGraph = this.edfsDirectiveReferences.size > 0;
    if (this.isSubgraphEventDrivenGraph) {
      this.validateEventDrivenSubgraph();
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
        authorizationDataByParentTypeName: this.authorizationDataByParentTypeName,
        // configurationDataMap is map of ConfigurationData per type name.
        // It is an Intermediate configuration object that will be converted to an engine configuration in the router
        concreteTypeNamesByAbstractTypeName: this.concreteTypeNamesByAbstractTypeName,
        configurationDataByParentTypeName: this.configurationDataByParentTypeName,
        entityDataByTypeName: this.entityDataByTypeName,
        entityInterfaces: this.entityInterfaceDataByTypeName,
        isEventDrivenGraph: this.isSubgraphEventDrivenGraph,
        isVersionTwo: this.isSubgraphVersionTwo,
        keyFieldNamesByParentTypeName: this.keyFieldNamesByParentTypeName,
        operationTypes: this.operationTypeNodeByTypeName,
        originalTypeNameByRenamedTypeName: this.originalTypeNameByRenamedTypeName,
        overridesByTargetSubgraphName: this.overridesByTargetSubgraphName,
        parentDefinitionDataByTypeName: this.parentDefinitionDataByTypeName,
        parentExtensionDataByTypeName: validParentExtensionOrphansByTypeName,
        persistedDirectiveDefinitionDataByDirectiveName,
        subgraphAST: newAST,
        subgraphString: print(newAST),
        schema: buildASTSchema(newAST, { assumeValid: true, assumeValidSDL: true }),
      },
    };
  }
}

export function batchNormalize(subgraphs: Subgraph[]): BatchNormalizationContainer {
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
  const warnings: string[] = [];
  const validationErrors: Error[] = [];
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
    const { errors, normalizationResult } = normalizeSubgraph(subgraph.definitions, subgraph.name, internalGraph);
    if (errors) {
      validationErrors.push(subgraphValidationError(subgraphName, errors));
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
        configurationDataByParentTypeName: normalizationResult.configurationDataByParentTypeName,
        definitions: normalizationResult.subgraphAST,
        entityInterfaces: normalizationResult.entityInterfaces,
        isVersionTwo: normalizationResult.isVersionTwo,
        keyFieldNamesByParentTypeName: normalizationResult.keyFieldNamesByParentTypeName,
        name: subgraphName,
        operationTypes: normalizationResult.operationTypes,
        overriddenFieldNamesByParentTypeName: new Map<string, Set<string>>(),
        parentDefinitionDataByTypeName: normalizationResult.parentDefinitionDataByTypeName,
        parentExtensionDataByTypeName: normalizationResult.parentExtensionDataByTypeName,
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
            invalidOverrideTargetSubgraphNameWarning(targetSubgraphName, originalParentTypeName, [...fieldNames]),
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
  const allErrors: Error[] = [];
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
      authorizationDataByParentTypeName,
      concreteTypeNamesByAbstractTypeName,
      entityDataByTypeName,
      errors: allErrors,
      internalSubgraphBySubgraphName,
      internalGraph,
      ...(warnings.length > 0 ? { warnings } : {}),
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
      const configurationData = internalSubgraph.configurationDataByParentTypeName.get(parentTypeName);
      if (!configurationData) {
        continue;
      }
      subtractSourceSetFromTargetSet(fieldNames, configurationData.fieldNames);
      if (configurationData.fieldNames.size < 1) {
        internalSubgraph.configurationDataByParentTypeName.delete(parentTypeName);
      }
    }
  }

  return {
    authorizationDataByParentTypeName,
    concreteTypeNamesByAbstractTypeName,
    entityDataByTypeName,
    internalSubgraphBySubgraphName: internalSubgraphBySubgraphName,
    internalGraph,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
