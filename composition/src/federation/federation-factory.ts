import { buildASTSchema, DirectiveDefinitionNode, DocumentNode, GraphQLSchema, Kind, NamedTypeNode } from 'graphql';
import {
  getTypeNodeNamedTypeName,
  MutableEnumValueNode,
  MutableFieldNode,
  MutableInputValueNode,
  MutableTypeDefinitionNode,
} from '../schema-building/ast';
import { stringToNamedTypeNode, stringToNameNode } from '../ast/utils';
import {
  allChildDefinitionsAreInaccessibleError,
  federationFactoryInitializationFatalError,
  fieldTypeMergeFatalError,
  inaccessibleQueryRootTypeError,
  inaccessibleRequiredArgumentError,
  inaccessibleSubscriptionFieldConditionFieldPathFieldErrorMessage,
  incompatibleArgumentTypesError,
  incompatibleChildTypesError,
  incompatibleObjectExtensionOrphanBaseTypeError,
  incompatibleParentKindFatalError,
  incompatibleParentKindMergeError,
  incompatibleSharedEnumError,
  invalidFieldShareabilityError,
  invalidImplementedTypeError,
  invalidInputFieldTypeErrorMessage,
  invalidInterfaceImplementationError,
  invalidReferencesOfInaccessibleTypeError,
  invalidRequiredInputValueError,
  invalidSubscriptionFieldConditionFieldPathErrorMessage,
  invalidSubscriptionFieldConditionFieldPathFieldErrorMessage,
  invalidSubscriptionFieldConditionFieldPathParentErrorMessage,
  invalidSubscriptionFilterDirectiveError,
  minimumSubgraphRequirementError,
  noBaseTypeExtensionError,
  nonLeafSubscriptionFieldConditionFieldPathFinalFieldErrorMessage,
  noQueryRootTypeError,
  orScopesLimitError,
  subscriptionFieldConditionEmptyValuesArrayErrorMessage,
  subscriptionFieldConditionInvalidInputFieldErrorMessage,
  subscriptionFieldConditionInvalidValuesArrayErrorMessage,
  subscriptionFilterArrayConditionInvalidItemTypeErrorMessage,
  subscriptionFilterArrayConditionInvalidLengthErrorMessage,
  subscriptionFilterConditionDepthExceededErrorMessage,
  subscriptionFilterConditionInvalidInputFieldErrorMessage,
  subscriptionFilterConditionInvalidInputFieldNumberErrorMessage,
  subscriptionFilterConditionInvalidInputFieldTypeErrorMessage,
  undefinedEntityInterfaceImplementationsError,
  undefinedSubscriptionFieldConditionFieldPathFieldErrorMessage,
  unknownFieldSubgraphNameError,
} from '../errors/errors';
import {
  ChildTagData,
  FederationFactoryOptions,
  FederationResultContainer,
  FederationResultContainerWithContracts,
  InterfaceImplementationData,
  InterfaceObjectForInternalGraphOptions,
  newChildTagData,
  newParentTagData,
  ParentTagData,
  SubscriptionFilterData,
  validateImplicitFieldSets,
} from './utils';
import { InternalSubgraph, Subgraph, SubgraphConfig } from '../subgraph/subgraph';
import {
  AND_UPPER,
  AUTHENTICATED,
  CONDITION,
  DEPRECATED,
  FIELD,
  FIELD_PATH,
  IN_UPPER,
  INACCESSIBLE,
  INPUT_OBJECT,
  LIST,
  NOT_UPPER,
  OBJECT,
  OR_UPPER,
  PARENT_DEFINITION_DATA,
  PERIOD,
  QUERY,
  REQUIRES_SCOPES,
  STRING,
  SUBSCRIPTION_FILTER,
  SUBSCRIPTION_FILTER_INPUT_NAMES,
  SUBSCRIPTION_FILTER_LIST_INPUT_NAMES,
  TAG,
  UNION,
  VALUES,
} from '../utils/string-constants';
import {
  addIterableValuesToSet,
  addMapEntries,
  AuthorizationData,
  doSetsIntersect,
  EntityData,
  EntityInterfaceFederationData,
  generateSimpleDirective,
  getEntriesNotInHashSet,
  getOrThrowError,
  getSingleSetEntry,
  getValueOrDefault,
  GraphFieldData,
  ImplementationErrors,
  InvalidEntityInterface,
  InvalidFieldImplementation,
  InvalidRequiredInputValueData,
  isNodeLeaf,
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
  SubscriptionCondition,
  SubscriptionFieldCondition,
  SubscriptionFilterValue,
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
import { isNodeQuery } from '../normalization/utils';
import {
  ChildData,
  DefinitionWithFieldsData,
  EnumDefinitionData,
  EnumValueData,
  FieldData,
  InputObjectDefinitionData,
  InputValueData,
  InterfaceDefinitionData,
  NodeData,
  ObjectDefinitionData,
  ParentDefinitionData,
  PersistedDirectiveDefinitionData,
  ScalarDefinitionData,
  UnionDefinitionData,
} from '../schema-building/type-definition-data';
import {
  addValidPersistedDirectiveDefinitionNodeByData,
  compareAndValidateInputValueDefaultValues,
  extractPersistedDirectives,
  getClientPersistedDirectiveNodes,
  getClientSchemaFieldNodeByFieldData,
  getNodeForRouterSchemaByData,
  getNodeWithPersistedDirectivesByFieldData,
  getNodeWithPersistedDirectivesByInputValueData,
  getSubscriptionFilterValue,
  getValidFieldArgumentNodes,
  isLeafKind,
  isNodeDataInaccessible,
  isShareabilityOfAllFieldInstancesValid,
  isTypeRequired,
  isTypeValidImplementation,
  MergeMethod,
  pushAuthorizationDirectives,
  setLongestDescription,
  setMutualExecutableLocations,
  upsertPersistedDirectivesData,
} from '../schema-building/utils';
import { ObjectExtensionData } from '../schema-building/type-extension-data';

import { renameRootTypes } from './walkers';
import { cloneDeep } from 'lodash';
import { getLeastRestrictiveMergedTypeNode, getMostRestrictiveMergedTypeNode } from '../schema-building/type-merging';
import { ConstDirectiveNode, ConstObjectValueNode } from 'graphql/index';
import { MAX_SUBSCRIPTION_FILTER_DEPTH } from '../utils/integer-constants';
import { Graph } from '../resolvability-graph/graph';
import { GraphNode } from '../resolvability-graph/graph-nodes';

export class FederationFactory {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  clientDefinitions: MutableTypeDefinitionNode[] = [DEPRECATED_DEFINITION];
  currentSubgraphName = '';
  entityDataByTypeName: Map<string, EntityData>;
  entityInterfaceFederationDataByTypeName: Map<string, EntityInterfaceFederationData>;
  errors: Error[] = [];
  fieldConfigurationByFieldPath = new Map<string, FieldConfiguration>();
  graphEdges = new Set<string>();
  graphPaths = new Map<string, boolean>();
  inaccessiblePaths = new Set<string>();
  internalGraph: Graph;
  internalSubgraphBySubgraphName: Map<string, InternalSubgraph>;
  invalidOrScopesHostPaths = new Set<string>();
  isVersionTwo = false;
  namedInputValueTypeNames = new Set<string>();
  namedOutputTypeNames = new Set<string>();
  objectExtensionDataByTypeName = new Map<string, ObjectExtensionData>();
  parentDefinitionDataByTypeName = new Map<string, ParentDefinitionData>();
  parentTagDataByTypeName = new Map<string, ParentTagData>();
  pathsByNamedTypeName = new Map<string, Set<string>>();
  persistedDirectiveDefinitionByDirectiveName = new Map<string, DirectiveDefinitionNode>([
    [AUTHENTICATED, AUTHENTICATED_DEFINITION],
    [DEPRECATED, DEPRECATED_DEFINITION],
    [INACCESSIBLE, INACCESSIBLE_DEFINITION],
    [REQUIRES_SCOPES, REQUIRES_SCOPES_DEFINITION],
    [TAG, TAG_DEFINITION],
  ]);
  persistedDirectiveDefinitions = new Set<string>([AUTHENTICATED, DEPRECATED, INACCESSIBLE, TAG, REQUIRES_SCOPES]);
  potentialPersistedDirectiveDefinitionDataByDirectiveName = new Map<string, PersistedDirectiveDefinitionData>();
  routerDefinitions: MutableTypeDefinitionNode[] = [DEPRECATED_DEFINITION, TAG_DEFINITION];
  shareableErrorTypeNames = new Map<string, Set<string>>();
  subscriptionFilterDataByFieldPath = new Map<string, SubscriptionFilterData>();
  isMaxDepth = false;
  tagNamesByPath = new Map<string, Set<string>>();
  warnings: string[];

  constructor(options: FederationFactoryOptions) {
    this.authorizationDataByParentTypeName = options.authorizationDataByParentTypeName;
    this.concreteTypeNamesByAbstractTypeName = options.concreteTypeNamesByAbstractTypeName;
    this.entityDataByTypeName = options.entityDataByTypeName;
    this.entityInterfaceFederationDataByTypeName = options.entityInterfaceFederationDataByTypeName;
    this.internalSubgraphBySubgraphName = options.internalSubgraphBySubgraphName;
    this.internalGraph = options.internalGraph;
    this.warnings = options.warnings || [];
  }

  getValidImplementedInterfaces(data: DefinitionWithFieldsData): NamedTypeNode[] {
    const interfaces: NamedTypeNode[] = [];
    if (data.implementedInterfaceTypeNames.size < 1) {
      return interfaces;
    }
    const isParentInaccessible = isNodeDataInaccessible(data);
    const implementationErrorsMap = new Map<string, ImplementationErrors>();
    const invalidImplementationTypeStringByTypeName = new Map<string, string>();
    for (const interfaceName of data.implementedInterfaceTypeNames) {
      interfaces.push(stringToNamedTypeNode(interfaceName));
      const implementationData = getOrThrowError(
        this.parentDefinitionDataByTypeName,
        interfaceName,
        PARENT_DEFINITION_DATA,
      );
      if (implementationData.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        invalidImplementationTypeStringByTypeName.set(
          implementationData.name,
          kindToTypeString(implementationData.kind),
        );
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
    if (implementationErrorsMap.size) {
      this.errors.push(
        invalidInterfaceImplementationError(data.node.name.value, kindToTypeString(data.kind), implementationErrorsMap),
      );
    }
    return interfaces;
  }

  addValidPrimaryKeyTargetsToEntityData(entityData?: EntityData) {
    if (!entityData) {
      return;
    }
    const internalSubgraph = getOrThrowError(
      this.internalSubgraphBySubgraphName,
      this.currentSubgraphName,
      'internalSubgraphBySubgraphName',
    );
    const parentDefinitionDataByTypeName = internalSubgraph.parentDefinitionDataByTypeName;
    const parentExtensionDataByTypeName = internalSubgraph.parentExtensionDataByTypeName;
    const objectData =
      parentDefinitionDataByTypeName.get(entityData.typeName) || parentExtensionDataByTypeName.get(entityData.typeName);
    if (
      !objectData ||
      (objectData.kind !== Kind.OBJECT_TYPE_DEFINITION && objectData.kind !== Kind.OBJECT_TYPE_EXTENSION)
    ) {
      throw incompatibleParentKindFatalError(
        entityData.typeName,
        Kind.OBJECT_TYPE_DEFINITION,
        objectData?.kind || Kind.NULL,
      );
    }
    const configurationData = getOrThrowError(
      internalSubgraph.configurationDataByParentTypeName,
      entityData.typeName,
      'internalSubgraph.configurationDataByParentTypeName',
    );
    const implicitKeys: RequiredFieldConfiguration[] = [];
    const graphNode = this.internalGraph.nodeByNodeName.get(`${this.currentSubgraphName}.${entityData.typeName}`);
    // Any errors in the field sets would be caught when evaluating the explicit entities, so they are ignored here
    validateImplicitFieldSets({
      configurationData,
      fieldSets: entityData.keyFieldSets,
      implicitKeys,
      objectData,
      parentDefinitionDataByTypeName,
      parentExtensionDataByTypeName,
      graphNode,
    });
    for (const [typeName, entityInterfaceFederationData] of this.entityInterfaceFederationDataByTypeName) {
      if (!entityInterfaceFederationData.concreteTypeNames?.has(entityData.typeName)) {
        continue;
      }
      const interfaceObjectEntityData = this.entityDataByTypeName.get(typeName);
      if (!interfaceObjectEntityData) {
        continue;
      }
      validateImplicitFieldSets({
        configurationData,
        fieldSets: interfaceObjectEntityData.keyFieldSets,
        implicitKeys,
        objectData,
        parentDefinitionDataByTypeName,
        parentExtensionDataByTypeName,
        graphNode,
      });
    }
    if (implicitKeys.length < 1) {
      return;
    }
    if (!configurationData.keys || configurationData.keys.length < 1) {
      configurationData.isRootNode = true;
      configurationData.keys = implicitKeys;
      return;
    }
    const existingKeys = new Set<string>(configurationData.keys.map((key) => key.selectionSet));
    for (const implicitKey of implicitKeys) {
      if (existingKeys.has(implicitKey.selectionSet)) {
        continue;
      }
      configurationData.keys.push(implicitKey);
      existingKeys.add(implicitKey.selectionSet);
    }
  }

  addValidPrimaryKeyTargetsFromInterfaceObject(
    internalSubgraph: InternalSubgraph,
    interfaceObjectTypeName: string,
    entityData: EntityData,
    graphNode: GraphNode,
  ) {
    const parentDefinitionDataByTypeName = internalSubgraph.parentDefinitionDataByTypeName;
    const parentExtensionDataByTypeName = internalSubgraph.parentExtensionDataByTypeName;
    const interfaceObjectData = parentDefinitionDataByTypeName.get(interfaceObjectTypeName);
    if (!interfaceObjectData || interfaceObjectData.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
      throw incompatibleParentKindFatalError(
        interfaceObjectTypeName,
        Kind.INTERFACE_TYPE_DEFINITION,
        interfaceObjectData?.kind || Kind.NULL,
      );
    }
    const configurationData = getOrThrowError(
      internalSubgraph.configurationDataByParentTypeName,
      entityData.typeName,
      'internalSubgraph.configurationDataByParentTypeName',
    );
    const implicitKeys: RequiredFieldConfiguration[] = [];
    // Any errors in the field sets would be caught when evaluating the explicit entities, so they are ignored here
    validateImplicitFieldSets({
      configurationData,
      fieldSets: entityData.keyFieldSets,
      implicitKeys,
      objectData: interfaceObjectData,
      parentDefinitionDataByTypeName,
      parentExtensionDataByTypeName,
      graphNode,
    });
    if (implicitKeys.length < 1) {
      return;
    }
    if (!configurationData.keys || configurationData.keys.length < 1) {
      configurationData.isRootNode = true;
      configurationData.keys = implicitKeys;
      return;
    }
    const existingKeys = new Set<string>(configurationData.keys.map((key) => key.selectionSet));
    for (const implicitKey of implicitKeys) {
      if (existingKeys.has(implicitKey.selectionSet)) {
        continue;
      }
      configurationData.keys.push(implicitKey);
      existingKeys.add(implicitKey.selectionSet);
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

  generateTagData() {
    for (const [path, tagNames] of this.tagNamesByPath) {
      const paths = path.split('.');
      if (paths.length < 1) {
        continue;
      }
      const parentTagData = getValueOrDefault(this.parentTagDataByTypeName, paths[0], () => newParentTagData(paths[0]));
      switch (paths.length) {
        // parent type
        case 1:
          for (const tagName of tagNames) {
            parentTagData.tagNames.add(tagName);
          }
          break;
        // child type
        case 2:
          const childTagData = getValueOrDefault(parentTagData.childTagDataByChildName, paths[1], () =>
            newChildTagData(paths[1]),
          );
          for (const tagName of tagNames) {
            childTagData.tagNames.add(tagName);
          }
          break;
        // field argument
        case 3:
          const fieldTagData = getValueOrDefault(parentTagData.childTagDataByChildName, paths[1], () =>
            newChildTagData(paths[1]),
          );
          const argumentTagData = getValueOrDefault(
            fieldTagData.tagNamesByArgumentName,
            paths[2],
            () => new Set<string>(),
          );
          for (const tagName of tagNames) {
            argumentTagData.add(tagName);
          }
          break;
        default:
          break;
      }
    }
  }

  upsertEnumValueData(
    enumValueDataByValueName: Map<string, EnumValueData>,
    incomingData: EnumValueData,
    isParentInaccessible: boolean,
  ) {
    const existingData = enumValueDataByValueName.get(incomingData.name);
    const baseData = existingData || incomingData;
    const enumValuePath = `${incomingData.parentTypeName}.${incomingData.name}`;
    extractPersistedDirectives(
      baseData.persistedDirectivesData,
      incomingData.directivesByDirectiveName,
      this.persistedDirectiveDefinitionByDirectiveName,
    );
    const isFieldInaccessible = isNodeDataInaccessible(incomingData);
    if (isParentInaccessible || isFieldInaccessible) {
      this.inaccessiblePaths.add(enumValuePath);
    }
    this.recordTagNamesByPath(baseData, enumValuePath);
    if (!existingData) {
      incomingData.node = {
        directives: [],
        kind: incomingData.node.kind,
        name: stringToNameNode(incomingData.name),
      };
      enumValueDataByValueName.set(incomingData.name, incomingData);
      return;
    }
    existingData.appearances += 1;
    setLongestDescription(existingData, incomingData);
  }

  // To facilitate the splitting of tag paths, field arguments do not use the renamedPath property for tagNamesByPath
  upsertInputValueData(
    inputValueDataByValueName: Map<string, InputValueData>,
    incomingData: InputValueData,
    path?: string,
  ) {
    const existingData = inputValueDataByValueName.get(incomingData.name);
    const baseData = existingData || incomingData;
    extractPersistedDirectives(
      baseData.persistedDirectivesData,
      incomingData.directivesByDirectiveName,
      this.persistedDirectiveDefinitionByDirectiveName,
    );
    this.recordTagNamesByPath(baseData, path || baseData.renamedPath);
    if (!existingData) {
      incomingData.node = {
        directives: [],
        kind: incomingData.node.kind,
        name: stringToNameNode(incomingData.name),
        type: incomingData.type,
      };
      inputValueDataByValueName.set(incomingData.name, incomingData);
      return;
    }
    setLongestDescription(existingData, incomingData);
    addIterableValuesToSet(incomingData.requiredSubgraphNames, existingData.requiredSubgraphNames);
    addIterableValuesToSet(incomingData.subgraphNames, existingData.subgraphNames);
    // TODO refactor type merging
    const { typeErrors, typeNode } = getMostRestrictiveMergedTypeNode(
      existingData.type,
      incomingData.type,
      existingData.originalPath,
      this.errors,
    );
    if (typeNode) {
      existingData.type = typeNode;
    } else {
      if (!typeErrors || typeErrors.length < 2) {
        throw fieldTypeMergeFatalError(existingData.name);
      }
      existingData.isArgument
        ? this.errors.push(
            incompatibleArgumentTypesError(existingData.name, existingData.renamedPath, typeErrors[0], typeErrors[1]),
          )
        : this.errors.push(incompatibleChildTypesError(existingData.renamedPath, typeErrors[0], typeErrors[1]));
    }
    compareAndValidateInputValueDefaultValues(existingData, incomingData, this.errors);
  }

  handleArgumentInaccessibility(
    isParentInaccessible: boolean,
    inputValueData: InputValueData,
    argumentPath: string,
    fieldPath: string,
  ) {
    /* If either the parent or the field to which the field belongs are declared inaccessible, the nullability
     ** of the argument is not considered. However, if only the argument is declared inaccessible, it is an
     ** error. */
    if (isParentInaccessible) {
      this.inaccessiblePaths.add(argumentPath);
      return;
    }
    if (!isNodeDataInaccessible(inputValueData)) {
      return;
    }
    if (isTypeRequired(inputValueData.type)) {
      this.errors.push(inaccessibleRequiredArgumentError(inputValueData.name, argumentPath, fieldPath));
    } else {
      this.inaccessiblePaths.add(argumentPath);
    }
  }

  handleSubscriptionFilterDirective(incomingData: FieldData, fieldPath: string, baseData?: FieldData) {
    const subscriptionFilters = incomingData.directivesByDirectiveName.get(SUBSCRIPTION_FILTER);
    if (subscriptionFilters) {
      // There should only be a single entry in the set
      const subgraphName = getSingleSetEntry(incomingData.subgraphNames);
      if (subgraphName === undefined) {
        this.errors.push(unknownFieldSubgraphNameError(fieldPath));
        return;
      }
      // @openfed__subscriptionFilter is non-repeatable
      this.subscriptionFilterDataByFieldPath.set(fieldPath, {
        directive: subscriptionFilters[0],
        fieldData: baseData || incomingData,
        directiveSubgraphName: subgraphName,
      });
    }
  }

  upsertFieldData(
    fieldDataByFieldName: Map<string, FieldData>,
    incomingData: FieldData,
    isParentInaccessible: boolean,
  ) {
    const fieldPath = `${incomingData.renamedParentTypeName}.${incomingData.name}`;
    getValueOrDefault(this.pathsByNamedTypeName, incomingData.namedTypeName, () => new Set<string>()).add(fieldPath);
    this.namedOutputTypeNames.add(incomingData.namedTypeName);
    const existingData = fieldDataByFieldName.get(incomingData.name);
    const baseData = existingData || incomingData;
    this.handleSubscriptionFilterDirective(incomingData, fieldPath, baseData);
    extractPersistedDirectives(
      baseData.persistedDirectivesData,
      incomingData.directivesByDirectiveName,
      this.persistedDirectiveDefinitionByDirectiveName,
    );
    const isFieldInaccessible = isNodeDataInaccessible(incomingData);
    if (isParentInaccessible || isFieldInaccessible) {
      this.inaccessiblePaths.add(fieldPath);
    }
    this.recordTagNamesByPath(baseData, fieldPath);
    if (!existingData) {
      fieldDataByFieldName.set(incomingData.name, incomingData);
      incomingData.node = {
        arguments: [],
        directives: [],
        kind: incomingData.node.kind,
        name: stringToNameNode(incomingData.name),
        type: incomingData.type,
      };
      for (const [argumentName, inputValueData] of incomingData.argumentDataByArgumentName) {
        inputValueData.node = {
          directives: [],
          kind: inputValueData.node.kind,
          name: stringToNameNode(inputValueData.name),
          type: inputValueData.type,
        };
        const namedArgumentTypeName = getTypeNodeNamedTypeName(inputValueData.type);
        getValueOrDefault(this.pathsByNamedTypeName, namedArgumentTypeName, () => new Set<string>()).add(
          inputValueData.renamedPath,
        );
        this.namedInputValueTypeNames.add(namedArgumentTypeName);
        extractPersistedDirectives(
          inputValueData.persistedDirectivesData,
          inputValueData.directivesByDirectiveName,
          this.persistedDirectiveDefinitionByDirectiveName,
        );
        /* If either the parent or the field to which the field belongs are declared inaccessible, the nullability
         ** of the argument is not considered. However, if only the argument is declared inaccessible, it is an
         ** error. */
        this.handleArgumentInaccessibility(
          isParentInaccessible || isFieldInaccessible,
          inputValueData,
          inputValueData.renamedPath,
          fieldPath,
        );
        this.recordTagNamesByPath(inputValueData, `${fieldPath}.${argumentName}`);
      }
      return;
    }
    const { typeErrors, typeNode } = getLeastRestrictiveMergedTypeNode(
      existingData.type,
      incomingData.type,
      fieldPath,
      this.errors,
    );
    if (typeNode) {
      existingData.type = typeNode;
    } else {
      if (!typeErrors || typeErrors.length < 2) {
        throw fieldTypeMergeFatalError(existingData.name);
      }
      this.errors.push(incompatibleChildTypesError(fieldPath, typeErrors[0], typeErrors[1]));
    }
    for (const [argumentName, inputValueData] of incomingData.argumentDataByArgumentName) {
      const namedArgumentTypeName = getTypeNodeNamedTypeName(inputValueData.type);
      getValueOrDefault(this.pathsByNamedTypeName, namedArgumentTypeName, () => new Set<string>()).add(
        inputValueData.renamedPath,
      );
      this.namedInputValueTypeNames.add(namedArgumentTypeName);
      /* If either the parent or the field to which the field belongs are declared inaccessible, the nullability
       ** of the argument is not considered. However, if only the argument is declared inaccessible, it is an
       ** error. */
      this.handleArgumentInaccessibility(
        isParentInaccessible || isFieldInaccessible,
        inputValueData,
        inputValueData.renamedPath,
        fieldPath,
      );
      this.upsertInputValueData(
        existingData.argumentDataByArgumentName,
        inputValueData,
        `${fieldPath}.${argumentName}`,
      );
    }
    setLongestDescription(existingData, incomingData);
    existingData.isInaccessible ||= incomingData.isInaccessible;
    addMapEntries(incomingData.isExternalBySubgraphName, existingData.isExternalBySubgraphName);
    addMapEntries(incomingData.isShareableBySubgraphName, existingData.isShareableBySubgraphName);
    addIterableValuesToSet(incomingData.subgraphNames, existingData.subgraphNames);
  }

  getClientSchemaUnionMembers(unionData: UnionDefinitionData): NamedTypeNode[] {
    const members: NamedTypeNode[] = [];
    for (const [memberName, namedTypeNode] of unionData.memberByMemberTypeName) {
      if (!this.inaccessiblePaths.has(memberName)) {
        members.push(namedTypeNode);
      }
    }
    return members;
  }

  recordTagNamesByPath(data: NodeData | ObjectExtensionData, nodePath?: string) {
    const path = nodePath || data.name;
    if (data.persistedDirectivesData.tags.size > 0) {
      const tagNames = getValueOrDefault(this.tagNamesByPath, path, () => new Set<string>());
      for (const tagName of data.persistedDirectivesData.tags.keys()) {
        tagNames.add(tagName);
      }
    }
  }

  upsertParentDefinitionData(incomingData: ParentDefinitionData, subgraphName: string) {
    const entityInterfaceData = this.entityInterfaceFederationDataByTypeName.get(incomingData.name);
    const existingData = this.parentDefinitionDataByTypeName.get(incomingData.name);
    const baseData = existingData || incomingData;
    extractPersistedDirectives(
      baseData.persistedDirectivesData,
      incomingData.directivesByDirectiveName,
      this.persistedDirectiveDefinitionByDirectiveName,
    );
    this.recordTagNamesByPath(baseData);
    const isParentInaccessible = isNodeDataInaccessible(baseData);
    if (isParentInaccessible) {
      this.inaccessiblePaths.add(incomingData.name);
    }
    if (entityInterfaceData && entityInterfaceData.interfaceObjectSubgraphs.has(subgraphName)) {
      incomingData.kind = Kind.INTERFACE_TYPE_DEFINITION;
    }
    if (!existingData) {
      incomingData.node = {
        kind: incomingData.kind,
        name: stringToNameNode(incomingData.name),
      };
      this.parentDefinitionDataByTypeName.set(incomingData.name, incomingData);
      switch (incomingData.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
          for (const [enumValueName, enumValueData] of incomingData.enumValueDataByValueName) {
            const enumValuePath = `${incomingData.name}.${enumValueName}`;
            enumValueData.node = {
              directives: [],
              kind: enumValueData.node.kind,
              name: stringToNameNode(enumValueData.name),
            };
            extractPersistedDirectives(
              enumValueData.persistedDirectivesData,
              enumValueData.directivesByDirectiveName,
              this.persistedDirectiveDefinitionByDirectiveName,
            );
            this.recordTagNamesByPath(enumValueData, enumValuePath);
            if (isNodeDataInaccessible(enumValueData)) {
              this.inaccessiblePaths.add(enumValuePath);
            }
          }
          return;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          for (const [inputFieldName, inputValueData] of incomingData.inputValueDataByValueName) {
            inputValueData.node = {
              directives: [],
              kind: inputValueData.node.kind,
              name: stringToNameNode(inputValueData.name),
              type: inputValueData.type,
            };
            const namedInputFieldTypeName = getTypeNodeNamedTypeName(inputValueData.type);
            getValueOrDefault(this.pathsByNamedTypeName, namedInputFieldTypeName, () => new Set<string>()).add(
              inputValueData.renamedPath,
            );
            this.namedInputValueTypeNames.add(namedInputFieldTypeName);
            extractPersistedDirectives(
              inputValueData.persistedDirectivesData,
              inputValueData.directivesByDirectiveName,
              this.persistedDirectiveDefinitionByDirectiveName,
            );
            this.recordTagNamesByPath(inputValueData, `${incomingData.name}.${inputFieldName}`);
            if (isParentInaccessible || isNodeDataInaccessible(inputValueData)) {
              this.inaccessiblePaths.add(inputValueData.renamedPath);
            }
          }
          return;
        case Kind.INTERFACE_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.OBJECT_TYPE_DEFINITION:
          for (const fieldData of incomingData.fieldDataByFieldName.values()) {
            fieldData.node = {
              arguments: [],
              directives: [],
              kind: fieldData.node.kind,
              name: stringToNameNode(fieldData.name),
              type: fieldData.type,
            };
            const fieldPath = `${fieldData.renamedParentTypeName}.${fieldData.name}`;
            this.handleSubscriptionFilterDirective(fieldData, fieldPath);
            getValueOrDefault(this.pathsByNamedTypeName, fieldData.namedTypeName, () => new Set<string>()).add(
              fieldPath,
            );
            this.namedOutputTypeNames.add(fieldData.namedTypeName);
            extractPersistedDirectives(
              fieldData.persistedDirectivesData,
              fieldData.directivesByDirectiveName,
              this.persistedDirectiveDefinitionByDirectiveName,
            );
            this.recordTagNamesByPath(fieldData, fieldPath);
            const isFieldInaccessible = isNodeDataInaccessible(fieldData);
            if (isParentInaccessible || isFieldInaccessible) {
              this.inaccessiblePaths.add(fieldPath);
            }
            for (const [argumentName, inputValueData] of fieldData.argumentDataByArgumentName) {
              inputValueData.node = {
                directives: [],
                kind: inputValueData.node.kind,
                name: stringToNameNode(inputValueData.name),
                type: inputValueData.type,
              };
              const namedArgumentTypeName = getTypeNodeNamedTypeName(inputValueData.type);
              getValueOrDefault(this.pathsByNamedTypeName, namedArgumentTypeName, () => new Set<string>()).add(
                inputValueData.renamedPath,
              );
              this.namedInputValueTypeNames.add(namedArgumentTypeName);
              extractPersistedDirectives(
                inputValueData.persistedDirectivesData,
                inputValueData.directivesByDirectiveName,
                this.persistedDirectiveDefinitionByDirectiveName,
              );
              this.recordTagNamesByPath(inputValueData, `${fieldPath}.${argumentName}`);
              /* If either the parent or the field to which the field belongs are declared inaccessible, the nullability
               ** of the argument is not considered. However, if only the argument is declared inaccessible, it is an
               ** error. */
              this.handleArgumentInaccessibility(
                isParentInaccessible || isFieldInaccessible,
                inputValueData,
                inputValueData.renamedPath,
                fieldPath,
              );
            }
          }
          return;
        default:
          // Scalar and Union
          return;
      }
    }
    setLongestDescription(existingData, incomingData);
    if (existingData.kind !== incomingData.kind) {
      if (
        !entityInterfaceData ||
        !entityInterfaceData.interfaceObjectSubgraphs.has(subgraphName) ||
        existingData.kind !== Kind.INTERFACE_TYPE_DEFINITION ||
        incomingData.kind !== Kind.OBJECT_TYPE_DEFINITION
      ) {
        this.errors.push(
          incompatibleParentKindMergeError(
            existingData.name,
            kindToTypeString(existingData.kind),
            kindToTypeString(incomingData.kind),
          ),
        );
        return;
      }
    }
    switch (existingData.kind) {
      case Kind.ENUM_TYPE_DEFINITION:
        existingData.appearances += 1;
        for (const data of (incomingData as EnumDefinitionData).enumValueDataByValueName.values()) {
          this.upsertEnumValueData(existingData.enumValueDataByValueName, data, isParentInaccessible);
        }
        return;
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
        if (isParentInaccessible && !existingData.isInaccessible) {
          this.propagateInaccessibilityToExistingChildren(existingData);
        }
        addIterableValuesToSet((incomingData as InputObjectDefinitionData).subgraphNames, existingData.subgraphNames);
        for (const [inputFieldName, inputValueData] of (incomingData as InputObjectDefinitionData)
          .inputValueDataByValueName) {
          const inputFieldPath = `${incomingData.name}.${inputFieldName}`;
          const namedInputFieldTypeName = getTypeNodeNamedTypeName(inputValueData.type);
          getValueOrDefault(this.pathsByNamedTypeName, namedInputFieldTypeName, () => new Set<string>()).add(
            inputFieldPath,
          );
          this.namedInputValueTypeNames.add(namedInputFieldTypeName);
          this.upsertInputValueData(existingData.inputValueDataByValueName, inputValueData);
          this.recordTagNamesByPath(inputValueData, inputFieldPath);
          if (isParentInaccessible || isNodeDataInaccessible(inputValueData)) {
            this.inaccessiblePaths.add(inputFieldPath);
          }
        }
        return;
      case Kind.INTERFACE_TYPE_DEFINITION:
      // intentional fallthrough
      case Kind.OBJECT_TYPE_DEFINITION:
        if (isParentInaccessible && !existingData.isInaccessible) {
          this.propagateInaccessibilityToExistingChildren(existingData);
        }
        const definitionWithFieldsData = incomingData as DefinitionWithFieldsData;
        addIterableValuesToSet(
          definitionWithFieldsData.implementedInterfaceTypeNames,
          existingData.implementedInterfaceTypeNames,
        );
        addIterableValuesToSet(definitionWithFieldsData.subgraphNames, existingData.subgraphNames);
        for (const fieldData of definitionWithFieldsData.fieldDataByFieldName.values()) {
          this.upsertFieldData(
            existingData.fieldDataByFieldName,
            fieldData,
            isParentInaccessible || existingData.isInaccessible,
          );
        }
        return;
      case Kind.UNION_TYPE_DEFINITION:
        addMapEntries(
          (incomingData as UnionDefinitionData).memberByMemberTypeName,
          existingData.memberByMemberTypeName,
        );
        return;
      default:
        // Scalar type
        return;
    }
  }

  upsertObjectExtensionData(incomingData: ObjectExtensionData) {
    const existingData = this.objectExtensionDataByTypeName.get(incomingData.name);
    const baseData = existingData || incomingData;
    extractPersistedDirectives(
      baseData.persistedDirectivesData,
      incomingData.directivesByDirectiveName,
      this.persistedDirectiveDefinitionByDirectiveName,
    );
    this.recordTagNamesByPath(baseData);
    const isParentInaccessible = isNodeDataInaccessible(baseData);
    if (isParentInaccessible) {
      this.inaccessiblePaths.add(incomingData.name);
    }
    if (!existingData) {
      incomingData.node = {
        kind: incomingData.kind,
        name: stringToNameNode(incomingData.name),
      };
      for (const fieldData of incomingData.fieldDataByFieldName.values()) {
        fieldData.node = {
          arguments: [],
          directives: [],
          kind: fieldData.node.kind,
          name: stringToNameNode(fieldData.name),
          type: fieldData.type,
        };
        const fieldPath = `${fieldData.renamedParentTypeName}.${fieldData.name}`;
        getValueOrDefault(this.pathsByNamedTypeName, fieldData.namedTypeName, () => new Set<string>()).add(fieldPath);
        this.namedOutputTypeNames.add(fieldData.namedTypeName);
        extractPersistedDirectives(
          fieldData.persistedDirectivesData,
          fieldData.directivesByDirectiveName,
          this.persistedDirectiveDefinitionByDirectiveName,
        );
        this.recordTagNamesByPath(fieldData, fieldPath);
        const isFieldInaccessible = isNodeDataInaccessible(fieldData);
        if (isParentInaccessible || isFieldInaccessible) {
          this.inaccessiblePaths.add(fieldPath);
        }
        for (const [argumentName, inputValueData] of fieldData.argumentDataByArgumentName) {
          inputValueData.node = {
            directives: [],
            kind: inputValueData.node.kind,
            name: stringToNameNode(inputValueData.name),
            type: inputValueData.type,
          };
          const namedArgumentTypeName = getTypeNodeNamedTypeName(inputValueData.type);
          getValueOrDefault(this.pathsByNamedTypeName, namedArgumentTypeName, () => new Set<string>()).add(
            inputValueData.renamedPath,
          );
          this.namedInputValueTypeNames.add(namedArgumentTypeName);
          extractPersistedDirectives(
            inputValueData.persistedDirectivesData,
            inputValueData.directivesByDirectiveName,
            this.persistedDirectiveDefinitionByDirectiveName,
          );
          this.recordTagNamesByPath(inputValueData, `${incomingData.name}.${argumentName}`);
          this.handleArgumentInaccessibility(
            isParentInaccessible || isFieldInaccessible,
            inputValueData,
            inputValueData.renamedPath,
            fieldPath,
          );
        }
      }
      this.objectExtensionDataByTypeName.set(incomingData.name, incomingData);
      return;
    }
    if (isParentInaccessible && !existingData.isInaccessible) {
      this.propagateInaccessibilityToExistingChildren(existingData);
    }
    addIterableValuesToSet(incomingData.implementedInterfaceTypeNames, existingData.implementedInterfaceTypeNames);
    addIterableValuesToSet(incomingData.subgraphNames, existingData.subgraphNames);
    for (const fieldData of incomingData.fieldDataByFieldName.values()) {
      this.upsertFieldData(existingData.fieldDataByFieldName, fieldData, isParentInaccessible);
    }
  }

  propagateInaccessibilityToExistingChildren(
    data: InputObjectDefinitionData | InterfaceDefinitionData | ObjectDefinitionData | ObjectExtensionData,
  ) {
    data.isInaccessible = true;
    switch (data.kind) {
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
        for (const inputFieldName of data.inputValueDataByValueName.keys()) {
          this.inaccessiblePaths.add(`${data.name}.${inputFieldName}`);
        }
        break;
      default:
        for (const [fieldName, fieldData] of data.fieldDataByFieldName) {
          const fieldPath = `${fieldData.renamedParentTypeName}.${fieldName}`;
          this.inaccessiblePaths.add(fieldPath);
          for (const inputValueData of fieldData.argumentDataByArgumentName.values()) {
            this.inaccessiblePaths.add(inputValueData.renamedPath);
          }
        }
    }
  }

  upsertValidObjectExtensionData(incomingData: ObjectExtensionData) {
    const isParentInaccessible = isNodeDataInaccessible(incomingData);
    const existingData = this.parentDefinitionDataByTypeName.get(incomingData.name);
    if (!existingData) {
      if (incomingData.isRootType) {
        const authorizationData = this.authorizationDataByParentTypeName.get(incomingData.name);
        for (const fieldData of incomingData.fieldDataByFieldName.values()) {
          pushAuthorizationDirectives(fieldData, authorizationData);
        }
        this.parentDefinitionDataByTypeName.set(incomingData.name, {
          directivesByDirectiveName: incomingData.directivesByDirectiveName,
          fieldDataByFieldName: incomingData.fieldDataByFieldName,
          implementedInterfaceTypeNames: incomingData.implementedInterfaceTypeNames,
          isRootType: true,
          isInaccessible: isParentInaccessible,
          isEntity: false,
          kind: Kind.OBJECT_TYPE_DEFINITION,
          name: incomingData.name,
          node: {
            kind: Kind.OBJECT_TYPE_DEFINITION,
            name: stringToNameNode(incomingData.name),
          },
          persistedDirectivesData: incomingData.persistedDirectivesData,
          renamedTypeName: incomingData.renamedTypeName,
          subgraphNames: incomingData.subgraphNames,
        });
        return;
      }
      this.errors.push(noBaseTypeExtensionError(incomingData.name));
      return;
    }
    if (existingData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
      this.errors.push(
        incompatibleObjectExtensionOrphanBaseTypeError(existingData.name, kindToTypeString(existingData.kind)),
      );
      return;
    }
    upsertPersistedDirectivesData(existingData.persistedDirectivesData, incomingData.persistedDirectivesData);
    if (isParentInaccessible) {
      this.inaccessiblePaths.add(incomingData.name);
      // If the type was not previously known to be inaccessible, the existing children and arguments must be updated
      if (!existingData.isInaccessible) {
        this.propagateInaccessibilityToExistingChildren(existingData);
      }
    }
    addIterableValuesToSet(incomingData.implementedInterfaceTypeNames, existingData.implementedInterfaceTypeNames);
    for (const fieldData of incomingData.fieldDataByFieldName.values()) {
      this.upsertFieldData(existingData.fieldDataByFieldName, fieldData, isParentInaccessible);
    }
  }

  upsertPersistedDirectiveDefinitionData(incomingData: PersistedDirectiveDefinitionData, subgraphNumber: number) {
    const name = incomingData.name;
    const existingData = this.potentialPersistedDirectiveDefinitionDataByDirectiveName.get(name);
    if (!existingData) {
      // The executable directive must be defined in all subgraphs to be persisted.
      if (subgraphNumber > 1) {
        return;
      }
      const argumentDataByArgumentName = new Map<string, InputValueData>();
      for (const inputValueData of incomingData.argumentDataByArgumentName.values()) {
        this.namedInputValueTypeNames.add(getTypeNodeNamedTypeName(inputValueData.type));
        this.upsertInputValueData(argumentDataByArgumentName, inputValueData);
      }
      this.potentialPersistedDirectiveDefinitionDataByDirectiveName.set(name, {
        argumentDataByArgumentName,
        executableLocations: new Set<string>(incomingData.executableLocations),
        name,
        repeatable: incomingData.repeatable,
        subgraphNames: new Set<string>(incomingData.subgraphNames),
        description: incomingData.description,
      });
      return;
    }
    // If the executable directive has not been defined in at least one graph, the definition should not be persisted
    if (existingData.subgraphNames.size + 1 !== subgraphNumber) {
      this.potentialPersistedDirectiveDefinitionDataByDirectiveName.delete(name);
      return;
    }
    setMutualExecutableLocations(existingData, incomingData.executableLocations);
    // If there are no mutually defined executable locations, the definition should not be persisted
    if (existingData.executableLocations.size < 1) {
      this.potentialPersistedDirectiveDefinitionDataByDirectiveName.delete(name);
      return;
    }
    for (const inputValueData of incomingData.argumentDataByArgumentName.values()) {
      this.namedInputValueTypeNames.add(getTypeNodeNamedTypeName(inputValueData.type));
      this.upsertInputValueData(existingData.argumentDataByArgumentName, inputValueData);
    }
    setLongestDescription(existingData, incomingData);
    existingData.repeatable &&= incomingData.repeatable;
    addIterableValuesToSet(incomingData.subgraphNames, existingData.subgraphNames);
  }

  /* federateInternalSubgraphData is responsible for merging each subgraph TypeScript representation of a GraphQL type
   ** into a single representation.
   ** This method is always necessary, regardless of whether federating a source graph or contract graph. */
  federateInternalSubgraphData() {
    let subgraphNumber = 0;
    let shouldSkipPersistedExecutableDirectives = false;
    for (const internalSubgraph of this.internalSubgraphBySubgraphName.values()) {
      subgraphNumber += 1;
      this.currentSubgraphName = internalSubgraph.name;
      this.isVersionTwo ||= internalSubgraph.isVersionTwo;
      renameRootTypes(this, internalSubgraph);
      for (const parentDefinitionData of internalSubgraph.parentDefinitionDataByTypeName.values()) {
        this.upsertParentDefinitionData(parentDefinitionData, internalSubgraph.name);
      }
      for (const objectExtensionData of internalSubgraph.parentExtensionDataByTypeName.values()) {
        this.upsertObjectExtensionData(objectExtensionData);
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
        this.upsertPersistedDirectiveDefinitionData(persistedDirectiveDefinitionData, subgraphNumber);
      }
      /* Invalid directive keys are deleted; if there are no entries left, it is no longer necessary to evaluate more
         executable directives. */
      if (this.potentialPersistedDirectiveDefinitionDataByDirectiveName.size < 1) {
        shouldSkipPersistedExecutableDirectives = true;
      }
    }
  }

  handleInterfaceObjectForInternalGraph({
    entityData,
    internalSubgraph,
    interfaceObjectData,
    interfaceObjectNode,
    resolvableKeyFieldSets,
    subgraphName,
  }: InterfaceObjectForInternalGraphOptions) {
    const entityGraphNode = this.internalGraph.addOrUpdateNode(entityData.typeName);
    const entityDataNode = this.internalGraph.addEntityDataNode(entityData.typeName);
    for (const satisfiedFieldSet of interfaceObjectNode.satisfiedFieldSets) {
      entityGraphNode.satisfiedFieldSets.add(satisfiedFieldSet);
      if (resolvableKeyFieldSets.has(satisfiedFieldSet)) {
        entityDataNode.addTargetSubgraphByFieldSet(satisfiedFieldSet, subgraphName);
      }
    }
    const fieldDatas = interfaceObjectData.fieldDatasBySubgraphName.get(subgraphName);
    for (const { name, namedTypeName } of fieldDatas || []) {
      this.internalGraph.addEdge(entityGraphNode, this.internalGraph.addOrUpdateNode(namedTypeName), name);
    }
    this.internalGraph.addEdge(interfaceObjectNode, entityGraphNode, entityData.typeName, true);
    this.addValidPrimaryKeyTargetsFromInterfaceObject(
      internalSubgraph,
      interfaceObjectNode.typeName,
      entityData,
      entityGraphNode,
    );
  }

  handleEntityInterfaces() {
    for (const [entityInterfaceTypeName, entityInterfaceData] of this.entityInterfaceFederationDataByTypeName) {
      subtractSourceSetFromTargetSet(
        entityInterfaceData.interfaceFieldNames,
        entityInterfaceData.interfaceObjectFieldNames,
      );
      const entityInterface = getOrThrowError(
        this.parentDefinitionDataByTypeName,
        entityInterfaceTypeName,
        PARENT_DEFINITION_DATA,
      );
      if (entityInterface.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        // TODO error
        continue;
      }
      for (const subgraphName of entityInterfaceData.interfaceObjectSubgraphs) {
        const internalSubgraph = getOrThrowError(
          this.internalSubgraphBySubgraphName,
          subgraphName,
          'internalSubgraphBySubgraphName',
        );
        const configurationDataMap = internalSubgraph.configurationDataByParentTypeName;
        const concreteTypeNames = this.concreteTypeNamesByAbstractTypeName.get(entityInterfaceTypeName);
        if (!concreteTypeNames) {
          continue;
        }
        const interfaceObjectConfiguration = getOrThrowError(
          configurationDataMap,
          entityInterfaceTypeName,
          'configurationDataMap',
        );
        const keys = interfaceObjectConfiguration.keys;
        if (!keys) {
          // TODO no keys error
          continue;
        }
        interfaceObjectConfiguration.entityInterfaceConcreteTypeNames = entityInterfaceData.concreteTypeNames;
        const fieldNames = interfaceObjectConfiguration.fieldNames;
        const authorizationData = this.authorizationDataByParentTypeName.get(entityInterfaceData.typeName);
        this.internalGraph.setSubgraphName(subgraphName);
        const interfaceObjectNode = this.internalGraph.addOrUpdateNode(entityInterfaceTypeName, { isAbstract: true });
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
            PARENT_DEFINITION_DATA,
          );
          if (concreteTypeData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
            continue;
          }
          // The subgraph locations of the interface object must be added to the concrete types that implement it
          const entityData = getOrThrowError(this.entityDataByTypeName, concreteTypeName, 'entityDataByTypeName');
          entityData.subgraphNames.add(subgraphName);
          const configurationData: ConfigurationData = {
            fieldNames,
            isRootNode: true,
            keys,
            typeName: concreteTypeName,
          };
          const resolvableKeyFieldSets = new Set<string>();
          for (const key of keys.filter((k) => !k.disableEntityResolver)) {
            resolvableKeyFieldSets.add(key.selectionSet);
          }
          for (const fieldName of entityInterfaceData.interfaceObjectFieldNames) {
            const existingFieldData = concreteTypeData.fieldDataByFieldName.get(fieldName);
            if (existingFieldData) {
              // TODO handle shareability
              continue;
            }
            const interfaceFieldData = getOrThrowError(
              entityInterface.fieldDataByFieldName,
              fieldName,
              `${entityInterfaceTypeName}.fieldDataByFieldName`,
            );
            concreteTypeData.fieldDataByFieldName.set(fieldName, { ...interfaceFieldData });
          }
          configurationDataMap.set(concreteTypeName, configurationData);
          this.handleInterfaceObjectForInternalGraph({
            internalSubgraph,
            subgraphName,
            interfaceObjectData: entityInterfaceData,
            interfaceObjectNode,
            resolvableKeyFieldSets,
            entityData,
          });
        }
      }
    }
  }

  fieldDataToGraphFieldData(fieldData: FieldData): GraphFieldData {
    return {
      name: fieldData.name,
      namedTypeName: fieldData.namedTypeName,
      isLeaf: isNodeLeaf(this.parentDefinitionDataByTypeName.get(fieldData.namedTypeName)?.kind),
      subgraphNames: fieldData.subgraphNames,
    };
  }

  pushParentDefinitionDataToDocumentDefinitions(interfaceImplementations: InterfaceImplementationData[]) {
    for (const [parentTypeName, parentDefinitionData] of this.parentDefinitionDataByTypeName) {
      switch (parentDefinitionData.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
          const enumValueNodes: MutableEnumValueNode[] = [];
          const clientEnumValueNodes: MutableEnumValueNode[] = [];
          const mergeMethod = this.getEnumValueMergeMethod(parentTypeName);
          for (const enumValueData of parentDefinitionData.enumValueDataByValueName.values()) {
            const enumValueNode = getNodeForRouterSchemaByData(
              enumValueData,
              this.persistedDirectiveDefinitionByDirectiveName,
              this.errors,
            );
            const isValueInaccessible = isNodeDataInaccessible(enumValueData);
            const clientEnumValueNode: MutableEnumValueNode = {
              ...enumValueData.node,
              directives: getClientPersistedDirectiveNodes(enumValueData),
            };
            switch (mergeMethod) {
              case MergeMethod.CONSISTENT:
                if (!isValueInaccessible && parentDefinitionData.appearances > enumValueData.appearances) {
                  this.errors.push(incompatibleSharedEnumError(parentTypeName));
                }
                enumValueNodes.push(enumValueNode);
                if (!isValueInaccessible) {
                  clientEnumValueNodes.push(clientEnumValueNode);
                }
                break;
              case MergeMethod.INTERSECTION:
                if (parentDefinitionData.appearances === enumValueData.appearances) {
                  enumValueNodes.push(enumValueNode);
                  if (!isValueInaccessible) {
                    clientEnumValueNodes.push(clientEnumValueNode);
                  }
                }
                break;
              default:
                enumValueNodes.push(enumValueNode);
                if (!isValueInaccessible) {
                  clientEnumValueNodes.push(clientEnumValueNode);
                }
                break;
            }
          }
          parentDefinitionData.node.values = enumValueNodes;
          this.routerDefinitions.push(
            getNodeForRouterSchemaByData(
              parentDefinitionData,
              this.persistedDirectiveDefinitionByDirectiveName,
              this.errors,
            ),
          );
          if (isNodeDataInaccessible(parentDefinitionData)) {
            this.validateReferencesOfInaccessibleType(parentDefinitionData);
            this.internalGraph.setNodeInaccessible(parentDefinitionData.name);
            break;
          }
          if (clientEnumValueNodes.length < 1) {
            this.errors.push(
              allChildDefinitionsAreInaccessibleError(
                kindToTypeString(parentDefinitionData.kind),
                parentTypeName,
                'enum value',
              ),
            );
            break;
          }
          this.clientDefinitions.push({
            ...parentDefinitionData.node,
            directives: getClientPersistedDirectiveNodes(parentDefinitionData),
            values: clientEnumValueNodes,
          });
          break;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          const invalidRequiredInputs: InvalidRequiredInputValueData[] = [];
          const inputValueNodes: MutableInputValueNode[] = [];
          const clientInputValueNodes: MutableInputValueNode[] = [];
          for (const [inputValueName, inputValueData] of parentDefinitionData.inputValueDataByValueName) {
            if (parentDefinitionData.subgraphNames.size === inputValueData.subgraphNames.size) {
              inputValueNodes.push(
                getNodeWithPersistedDirectivesByInputValueData(
                  inputValueData,
                  this.persistedDirectiveDefinitionByDirectiveName,
                  this.errors,
                ),
              );
              if (isNodeDataInaccessible(inputValueData)) {
                continue;
              }
              clientInputValueNodes.push({
                ...inputValueData.node,
                directives: getClientPersistedDirectiveNodes(inputValueData),
              });
            } else if (isTypeRequired(inputValueData.type)) {
              invalidRequiredInputs.push({
                inputValueName,
                missingSubgraphs: getEntriesNotInHashSet(
                  parentDefinitionData.subgraphNames,
                  inputValueData.subgraphNames,
                ),
                requiredSubgraphs: [...inputValueData.requiredSubgraphNames],
              });
            }
          }
          if (invalidRequiredInputs.length > 0) {
            this.errors.push(
              invalidRequiredInputValueError(INPUT_OBJECT, parentTypeName, invalidRequiredInputs, false),
            );
            break;
          }
          parentDefinitionData.node.fields = inputValueNodes;
          this.routerDefinitions.push(
            getNodeForRouterSchemaByData(
              parentDefinitionData,
              this.persistedDirectiveDefinitionByDirectiveName,
              this.errors,
            ),
          );
          if (isNodeDataInaccessible(parentDefinitionData)) {
            this.validateReferencesOfInaccessibleType(parentDefinitionData);
            break;
          }
          if (clientInputValueNodes.length < 1) {
            this.errors.push(
              allChildDefinitionsAreInaccessibleError(
                kindToTypeString(parentDefinitionData.kind),
                parentTypeName,
                'input field',
              ),
            );
            break;
          }
          this.clientDefinitions.push({
            ...parentDefinitionData.node,
            directives: getClientPersistedDirectiveNodes(parentDefinitionData),
            fields: clientInputValueNodes,
          });
          break;
        case Kind.INTERFACE_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.OBJECT_TYPE_DEFINITION:
          const fieldNodes: MutableFieldNode[] = [];
          const clientSchemaFieldNodes: MutableFieldNode[] = [];
          const graphFieldDataByFieldName = new Map<string, GraphFieldData>();
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
            fieldNodes.push(
              getNodeWithPersistedDirectivesByFieldData(
                fieldData,
                this.persistedDirectiveDefinitionByDirectiveName,
                argumentNodes,
                this.errors,
              ),
            );
            if (isNodeDataInaccessible(fieldData)) {
              continue;
            }
            clientSchemaFieldNodes.push(getClientSchemaFieldNodeByFieldData(fieldData));
            graphFieldDataByFieldName.set(fieldName, this.fieldDataToGraphFieldData(fieldData));
          }
          if (isObject && invalidFieldNames.size > 0) {
            this.errors.push(invalidFieldShareabilityError(parentDefinitionData, invalidFieldNames));
          }
          parentDefinitionData.node.fields = fieldNodes;
          this.internalGraph.initializeNode(parentTypeName, graphFieldDataByFieldName);
          // Implemented interfaces can only be validated after all fields are merged
          if (parentDefinitionData.implementedInterfaceTypeNames.size > 0) {
            interfaceImplementations.push({ data: parentDefinitionData, clientSchemaFieldNodes });
            break;
          }
          this.routerDefinitions.push(
            getNodeForRouterSchemaByData(
              parentDefinitionData,
              this.persistedDirectiveDefinitionByDirectiveName,
              this.errors,
            ),
          );
          const isQuery = isNodeQuery(parentTypeName);
          if (isNodeDataInaccessible(parentDefinitionData)) {
            if (isQuery) {
              this.errors.push(inaccessibleQueryRootTypeError);
              break;
            }
            this.validateReferencesOfInaccessibleType(parentDefinitionData);
            this.internalGraph.setNodeInaccessible(parentDefinitionData.name);
            break;
          }
          if (clientSchemaFieldNodes.length < 1) {
            const error = isQuery
              ? noQueryRootTypeError
              : allChildDefinitionsAreInaccessibleError(
                  kindToTypeString(parentDefinitionData.kind),
                  parentTypeName,
                  FIELD,
                );
            this.errors.push(error);
            break;
          }
          this.clientDefinitions.push({
            ...parentDefinitionData.node,
            directives: getClientPersistedDirectiveNodes(parentDefinitionData),
            fields: clientSchemaFieldNodes,
          });
          break;
        case Kind.SCALAR_TYPE_DEFINITION:
          if (BASE_SCALARS.has(parentTypeName)) {
            break;
          }
          this.routerDefinitions.push(
            getNodeForRouterSchemaByData(
              parentDefinitionData,
              this.persistedDirectiveDefinitionByDirectiveName,
              this.errors,
            ),
          );
          if (isNodeDataInaccessible(parentDefinitionData)) {
            this.validateReferencesOfInaccessibleType(parentDefinitionData);
            this.internalGraph.setNodeInaccessible(parentDefinitionData.name);
            break;
          }
          this.clientDefinitions.push({
            ...parentDefinitionData.node,
            directives: getClientPersistedDirectiveNodes(parentDefinitionData),
          });
          break;
        case Kind.UNION_TYPE_DEFINITION:
          parentDefinitionData.node.types = mapToArrayOfValues(parentDefinitionData.memberByMemberTypeName);
          this.routerDefinitions.push(
            getNodeForRouterSchemaByData(
              parentDefinitionData,
              this.persistedDirectiveDefinitionByDirectiveName,
              this.errors,
            ),
          );
          if (isNodeDataInaccessible(parentDefinitionData)) {
            this.validateReferencesOfInaccessibleType(parentDefinitionData);
            this.internalGraph.setNodeInaccessible(parentDefinitionData.name);
            break;
          }
          const clientMembers = this.getClientSchemaUnionMembers(parentDefinitionData);
          if (clientMembers.length < 1) {
            this.errors.push(allChildDefinitionsAreInaccessibleError(UNION, parentTypeName, 'union member type'));
            break;
          }
          this.clientDefinitions.push({
            ...parentDefinitionData.node,
            directives: getClientPersistedDirectiveNodes(parentDefinitionData),
            types: clientMembers,
          });
          break;
      }
    }
  }

  federateSubgraphData() {
    this.federateInternalSubgraphData();
    this.handleEntityInterfaces();
    for (const objectExtensionData of this.objectExtensionDataByTypeName.values()) {
      this.upsertValidObjectExtensionData(objectExtensionData);
    }
    // generate the map of tag data that is used by contracts
    this.generateTagData();
    this.pushVersionTwoDirectiveDefinitionsToDocumentDefinitions();
  }

  validateInterfaceImplementationsAndPushToDocumentDefinitions(
    interfaceImplementations: InterfaceImplementationData[],
  ) {
    for (const { data, clientSchemaFieldNodes } of interfaceImplementations) {
      data.node.interfaces = this.getValidImplementedInterfaces(data);
      this.routerDefinitions.push(
        getNodeForRouterSchemaByData(data, this.persistedDirectiveDefinitionByDirectiveName, this.errors),
      );
      if (isNodeDataInaccessible(data)) {
        this.validateReferencesOfInaccessibleType(data);
        this.internalGraph.setNodeInaccessible(data.name);
        continue;
      }
      const clientInterfaces: NamedTypeNode[] = [];
      for (const interfaceTypeName of data.implementedInterfaceTypeNames) {
        if (!this.inaccessiblePaths.has(interfaceTypeName)) {
          clientInterfaces.push(stringToNamedTypeNode(interfaceTypeName));
        }
      }

      /* It is not possible for clientSchemaFieldNodes to be empty.
       * If all interface fields were declared @inaccessible, the error would be caught above.
       * */
      this.clientDefinitions.push({
        ...data.node,
        directives: getClientPersistedDirectiveNodes(data),
        fields: clientSchemaFieldNodes,
        interfaces: clientInterfaces,
      });
    }
  }

  pushVersionTwoDirectiveDefinitionsToDocumentDefinitions() {
    if (!this.isVersionTwo) {
      return;
    }
    this.routerDefinitions = [
      AUTHENTICATED_DEFINITION,
      DEPRECATED_DEFINITION,
      INACCESSIBLE_DEFINITION,
      REQUIRES_SCOPES_DEFINITION,
      TAG_DEFINITION,
      SCOPE_SCALAR_DEFINITION,
    ];
    this.clientDefinitions = [
      AUTHENTICATED_DEFINITION,
      DEPRECATED_DEFINITION,
      REQUIRES_SCOPES_DEFINITION,
      SCOPE_SCALAR_DEFINITION,
    ];
  }

  validateReferencesOfInaccessibleType(data: ParentDefinitionData) {
    const paths = this.pathsByNamedTypeName.get(data.name);
    if (!paths || paths.size < 1) {
      return;
    }
    const invalidPaths: string[] = [];
    for (const path of paths) {
      if (!this.inaccessiblePaths.has(path)) {
        invalidPaths.push(path);
      }
    }
    if (invalidPaths.length > 0) {
      this.errors.push(invalidReferencesOfInaccessibleTypeError(kindToTypeString(data.kind), data.name, invalidPaths));
    }
  }

  validateQueryRootType() {
    const query = this.parentDefinitionDataByTypeName.get(QUERY);
    if (!query || query.kind !== Kind.OBJECT_TYPE_DEFINITION || query.fieldDataByFieldName.size < 1) {
      this.errors.push(noQueryRootTypeError);
      return;
    }
    for (const fieldData of query.fieldDataByFieldName.values()) {
      if (!isNodeDataInaccessible(fieldData)) {
        return;
      }
    }
    this.errors.push(noQueryRootTypeError);
  }

  validateSubscriptionFieldConditionFieldPath(
    conditionFieldPath: string,
    objectData: ObjectDefinitionData,
    inputFieldPath: string,
    directiveSubgraphName: string,
    fieldErrorMessages: string[],
  ): string[] {
    const paths = conditionFieldPath.split(PERIOD);
    if (paths.length < 1) {
      fieldErrorMessages.push(
        invalidSubscriptionFieldConditionFieldPathErrorMessage(inputFieldPath, conditionFieldPath),
      );
      return [];
    }
    let lastData: ParentDefinitionData = objectData;
    if (this.inaccessiblePaths.has(lastData.renamedTypeName)) {
      fieldErrorMessages.push(
        inaccessibleSubscriptionFieldConditionFieldPathFieldErrorMessage(
          inputFieldPath,
          conditionFieldPath,
          paths[0],
          lastData.renamedTypeName,
        ),
      );
      return [];
    }
    let partialConditionFieldPath = '';
    for (let i = 0; i < paths.length; i++) {
      const fieldName = paths[i];
      partialConditionFieldPath += partialConditionFieldPath.length > 0 ? `.${fieldName}` : fieldName;
      if (lastData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        fieldErrorMessages.push(
          invalidSubscriptionFieldConditionFieldPathParentErrorMessage(
            inputFieldPath,
            conditionFieldPath,
            partialConditionFieldPath,
          ),
        );
        return [];
      }
      const fieldData: FieldData | undefined = lastData.fieldDataByFieldName.get(fieldName);
      if (!fieldData) {
        fieldErrorMessages.push(
          undefinedSubscriptionFieldConditionFieldPathFieldErrorMessage(
            inputFieldPath,
            conditionFieldPath,
            partialConditionFieldPath,
            fieldName,
            lastData.renamedTypeName,
          ),
        );
        return [];
      }
      const fieldPath = `${lastData.renamedTypeName}.${fieldName}`;
      if (!fieldData.subgraphNames.has(directiveSubgraphName)) {
        fieldErrorMessages.push(
          invalidSubscriptionFieldConditionFieldPathFieldErrorMessage(
            inputFieldPath,
            conditionFieldPath,
            partialConditionFieldPath,
            fieldPath,
            directiveSubgraphName,
          ),
        );
        return [];
      }
      if (this.inaccessiblePaths.has(fieldPath)) {
        fieldErrorMessages.push(
          inaccessibleSubscriptionFieldConditionFieldPathFieldErrorMessage(
            inputFieldPath,
            conditionFieldPath,
            partialConditionFieldPath,
            fieldPath,
          ),
        );
        return [];
      }
      if (BASE_SCALARS.has(fieldData.namedTypeName)) {
        lastData = { kind: Kind.SCALAR_TYPE_DEFINITION, name: fieldData.namedTypeName } as ScalarDefinitionData;
        continue;
      }
      lastData = getOrThrowError(this.parentDefinitionDataByTypeName, fieldData.namedTypeName, PARENT_DEFINITION_DATA);
    }
    if (!isLeafKind(lastData.kind)) {
      fieldErrorMessages.push(
        nonLeafSubscriptionFieldConditionFieldPathFinalFieldErrorMessage(
          inputFieldPath,
          conditionFieldPath,
          paths[paths.length - 1],
          kindToTypeString(lastData.kind),
          lastData.name,
        ),
      );
      return [];
    }
    return paths;
  }

  validateSubscriptionFieldCondition(
    objectValueNode: ConstObjectValueNode,
    condition: SubscriptionFieldCondition,
    objectData: ObjectDefinitionData,
    depth: number,
    inputPath: string,
    directiveSubgraphName: string,
    errorMessages: string[],
  ): boolean {
    if (depth > MAX_SUBSCRIPTION_FILTER_DEPTH || this.isMaxDepth) {
      errorMessages.push(subscriptionFilterConditionDepthExceededErrorMessage(inputPath));
      this.isMaxDepth = true;
      return false;
    }
    let hasErrors = false;
    const validFieldNames = new Set<string>([FIELD_PATH, VALUES]);
    const duplicatedFieldNames = new Set<string>();
    const invalidFieldNames = new Set<string>();
    const fieldErrorMessages: string[] = [];
    for (const objectFieldNode of objectValueNode.fields) {
      const inputFieldName = objectFieldNode.name.value;
      const inputFieldPath = inputPath + `.${inputFieldName}`;
      switch (inputFieldName) {
        case FIELD_PATH: {
          if (validFieldNames.has(FIELD_PATH)) {
            validFieldNames.delete(FIELD_PATH);
          } else {
            hasErrors = true;
            duplicatedFieldNames.add(FIELD_PATH);
            break;
          }
          if (objectFieldNode.value.kind !== Kind.STRING) {
            fieldErrorMessages.push(
              invalidInputFieldTypeErrorMessage(inputFieldPath, STRING, kindToTypeString(objectFieldNode.value.kind)),
            );
            hasErrors = true;
            break;
          }
          const fieldPath = this.validateSubscriptionFieldConditionFieldPath(
            objectFieldNode.value.value,
            objectData,
            inputFieldPath,
            directiveSubgraphName,
            fieldErrorMessages,
          );
          if (fieldPath.length < 1) {
            hasErrors = true;
            break;
          }
          condition.fieldPath = fieldPath;
          break;
        }
        case VALUES: {
          if (validFieldNames.has(VALUES)) {
            validFieldNames.delete(VALUES);
          } else {
            hasErrors = true;
            duplicatedFieldNames.add(VALUES);
            break;
          }
          const objectFieldValueKind = objectFieldNode.value.kind;
          if (objectFieldValueKind == Kind.NULL || objectFieldValueKind == Kind.OBJECT) {
            fieldErrorMessages.push(
              invalidInputFieldTypeErrorMessage(inputFieldPath, LIST, kindToTypeString(objectFieldNode.value.kind)),
            );
            hasErrors = true;
            break;
          }
          // Coerce scalars into a list
          if (objectFieldValueKind !== Kind.LIST) {
            condition.values = [getSubscriptionFilterValue(objectFieldNode.value)];
            break;
          }
          // Prevent duplicate values
          const values = new Set<SubscriptionFilterValue>();
          const invalidIndices: number[] = [];
          for (let i = 0; i < objectFieldNode.value.values.length; i++) {
            const valueNode = objectFieldNode.value.values[i];
            if (valueNode.kind === Kind.OBJECT || valueNode.kind === Kind.LIST) {
              hasErrors = true;
              invalidIndices.push(i);
              continue;
            }
            values.add(getSubscriptionFilterValue(valueNode));
          }
          if (invalidIndices.length > 0) {
            fieldErrorMessages.push(
              subscriptionFieldConditionInvalidValuesArrayErrorMessage(inputFieldPath, invalidIndices),
            );
            continue;
          }
          if (values.size < 1) {
            hasErrors = true;
            fieldErrorMessages.push(subscriptionFieldConditionEmptyValuesArrayErrorMessage(inputFieldPath));
            continue;
          }
          condition.values = [...values];
          break;
        }
        default: {
          hasErrors = true;
          invalidFieldNames.add(inputFieldName);
        }
      }
    }
    if (!hasErrors) {
      return true;
    }
    errorMessages.push(
      subscriptionFieldConditionInvalidInputFieldErrorMessage(
        inputPath,
        [...validFieldNames],
        [...duplicatedFieldNames],
        [...invalidFieldNames],
        fieldErrorMessages,
      ),
    );

    return false;
  }

  validateSubscriptionFilterCondition(
    objectValueNode: ConstObjectValueNode,
    configuration: SubscriptionCondition,
    objectData: ObjectDefinitionData,
    depth: number,
    inputPath: string,
    directiveSubgraphName: string,
    errorMessages: string[],
  ): boolean {
    if (depth > MAX_SUBSCRIPTION_FILTER_DEPTH || this.isMaxDepth) {
      errorMessages.push(subscriptionFilterConditionDepthExceededErrorMessage(inputPath));
      this.isMaxDepth = true;
      return false;
    }
    depth += 1;
    if (objectValueNode.fields.length !== 1) {
      errorMessages.push(
        subscriptionFilterConditionInvalidInputFieldNumberErrorMessage(inputPath, objectValueNode.fields.length),
      );
      return false;
    }
    const objectFieldNode = objectValueNode.fields[0];
    const fieldName = objectFieldNode.name.value;
    if (!SUBSCRIPTION_FILTER_INPUT_NAMES.has(fieldName)) {
      errorMessages.push(subscriptionFilterConditionInvalidInputFieldErrorMessage(inputPath, fieldName));
      return false;
    }
    const inputFieldPath = inputPath + `.${fieldName}`;
    switch (objectFieldNode.value.kind) {
      case Kind.OBJECT: {
        switch (fieldName) {
          case IN_UPPER: {
            configuration.in = { fieldPath: [], values: [] };
            return this.validateSubscriptionFieldCondition(
              objectFieldNode.value,
              configuration.in,
              objectData,
              depth,
              inputPath + `.IN`,
              directiveSubgraphName,
              errorMessages,
            );
          }
          case NOT_UPPER: {
            configuration.not = {};
            return this.validateSubscriptionFilterCondition(
              objectFieldNode.value,
              configuration.not,
              objectData,
              depth,
              inputPath + `.NOT`,
              directiveSubgraphName,
              errorMessages,
            );
          }
          default:
            // The field is guaranteed to be an AND or an OR
            errorMessages.push(
              subscriptionFilterConditionInvalidInputFieldTypeErrorMessage(inputFieldPath, LIST, OBJECT),
            );
            return false;
        }
      }
      case Kind.LIST: {
        const listConfigurations: SubscriptionCondition[] = [];
        switch (fieldName) {
          case AND_UPPER: {
            configuration.and = listConfigurations;
            break;
          }
          case OR_UPPER: {
            configuration.or = listConfigurations;
            break;
          }
          default:
            // The field is guaranteed to be an IN or a NOT
            errorMessages.push(
              subscriptionFilterConditionInvalidInputFieldTypeErrorMessage(inputFieldPath, OBJECT, LIST),
            );
            return false;
        }
        const listLength = objectFieldNode.value.values.length;
        if (listLength < 1 || listLength > 5) {
          errorMessages.push(subscriptionFilterArrayConditionInvalidLengthErrorMessage(inputFieldPath, listLength));
          return false;
        }
        let isValid = true;
        const invalidIndices: number[] = [];
        for (let i = 0; i < objectFieldNode.value.values.length; i++) {
          const arrayIndexPath = inputFieldPath + `[${i}]`;
          const listValueNode = objectFieldNode.value.values[i];
          if (listValueNode.kind !== Kind.OBJECT) {
            invalidIndices.push(i);
            continue;
          }
          const listConfiguration: SubscriptionCondition = {};
          isValid &&= this.validateSubscriptionFilterCondition(
            listValueNode,
            listConfiguration,
            objectData,
            depth,
            arrayIndexPath,
            directiveSubgraphName,
            errorMessages,
          );
          if (isValid) {
            listConfigurations.push(listConfiguration);
          }
        }
        if (invalidIndices.length > 0) {
          errorMessages.push(
            subscriptionFilterArrayConditionInvalidItemTypeErrorMessage(inputFieldPath, invalidIndices),
          );
          return false;
        }
        return isValid;
      }
      default: {
        const expectedTypeString = SUBSCRIPTION_FILTER_LIST_INPUT_NAMES.has(fieldName) ? LIST : OBJECT;
        errorMessages.push(
          subscriptionFilterConditionInvalidInputFieldTypeErrorMessage(
            inputFieldPath,
            expectedTypeString,
            kindToTypeString(objectFieldNode.value.kind),
          ),
        );
        return false;
      }
    }
  }

  validateSubscriptionFilterAndGenerateConfiguration(
    directiveNode: ConstDirectiveNode,
    objectData: ObjectDefinitionData,
    fieldPath: string,
    fieldName: string,
    parentTypeName: string,
    directiveSubgraphName: string,
  ) {
    // directive validation occurs elsewhere
    if (!directiveNode.arguments || directiveNode.arguments.length !== 1) {
      return;
    }
    const argumentNode = directiveNode.arguments[0];
    if (argumentNode.value.kind !== Kind.OBJECT) {
      this.errors.push(
        invalidSubscriptionFilterDirectiveError(fieldPath, [
          subscriptionFilterConditionInvalidInputFieldTypeErrorMessage(
            CONDITION,
            'object',
            kindToTypeString(argumentNode.value.kind),
          ),
        ]),
      );
      return;
    }
    const condition = {} as SubscriptionCondition;
    const errorMessages: string[] = [];
    if (
      !this.validateSubscriptionFilterCondition(
        argumentNode.value,
        condition,
        objectData,
        0,
        CONDITION,
        directiveSubgraphName,
        errorMessages,
      )
    ) {
      this.errors.push(invalidSubscriptionFilterDirectiveError(fieldPath, errorMessages));
      this.isMaxDepth = false;
      return;
    }
    getValueOrDefault(this.fieldConfigurationByFieldPath, fieldPath, () => ({
      argumentNames: [],
      fieldName,
      typeName: parentTypeName,
    })).subscriptionFilterCondition = condition;
  }

  validateSubscriptionFiltersAndGenerateConfiguration() {
    for (const [fieldPath, data] of this.subscriptionFilterDataByFieldPath) {
      if (this.inaccessiblePaths.has(fieldPath)) {
        continue;
      }
      const namedTypeData = getOrThrowError(
        this.parentDefinitionDataByTypeName,
        data.fieldData.namedTypeName,
        PARENT_DEFINITION_DATA,
      );
      if (isNodeDataInaccessible(namedTypeData)) {
        // @inaccessible error are caught elsewhere
        continue;
      }
      // TODO handle Unions and Interfaces
      if (namedTypeData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        continue;
      }
      this.validateSubscriptionFilterAndGenerateConfiguration(
        data.directive,
        namedTypeData,
        fieldPath,
        data.fieldData.name,
        data.fieldData.renamedParentTypeName,
        data.directiveSubgraphName,
      );
    }
  }

  buildFederationResult(): FederationResultContainer {
    if (this.subscriptionFilterDataByFieldPath.size > 0) {
      this.validateSubscriptionFiltersAndGenerateConfiguration();
    }
    if (this.invalidOrScopesHostPaths.size > 0) {
      this.errors.push(orScopesLimitError(maxOrScopes, [...this.invalidOrScopesHostPaths]));
    }
    for (const data of this.potentialPersistedDirectiveDefinitionDataByDirectiveName.values()) {
      addValidPersistedDirectiveDefinitionNodeByData(
        this.routerDefinitions,
        data,
        this.persistedDirectiveDefinitionByDirectiveName,
        this.errors,
      );
    }
    const definitionsWithInterfaces: InterfaceImplementationData[] = [];
    this.pushParentDefinitionDataToDocumentDefinitions(definitionsWithInterfaces);
    this.validateInterfaceImplementationsAndPushToDocumentDefinitions(definitionsWithInterfaces);
    this.validateQueryRootType();
    // Return any composition errors before checking whether all fields are resolvable
    if (this.errors.length > 0) {
      return { errors: this.errors };
    }
    /* Resolvability evaluations are not necessary for contracts because the source graph resolvability checks must
     * have already completed without error. */
    const warnings = this.warnings.length > 0 ? { warnings: this.warnings } : {};
    // Resolvability checks are unnecessary for a single subgraph
    if (this.internalSubgraphBySubgraphName.size > 1) {
      const resolvabilityErrors = this.internalGraph.validate();
      if (resolvabilityErrors.length > 0) {
        return { errors: resolvabilityErrors, ...warnings };
      }
    }
    if (this.errors.length > 0) {
      return { errors: this.errors, ...warnings };
    }
    const newRouterAST: DocumentNode = {
      kind: Kind.DOCUMENT,
      definitions: this.routerDefinitions,
    };
    const newClientSchema: GraphQLSchema = buildASTSchema(
      {
        kind: Kind.DOCUMENT,
        definitions: this.clientDefinitions,
      },
      { assumeValid: true, assumeValidSDL: true },
    );
    const subgraphConfigBySubgraphName = new Map<string, SubgraphConfig>();
    for (const subgraph of this.internalSubgraphBySubgraphName.values()) {
      subgraphConfigBySubgraphName.set(subgraph.name, {
        configurationDataMap: subgraph.configurationDataByParentTypeName,
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
        federatedGraphAST: newRouterAST,
        federatedGraphSchema: buildASTSchema(newRouterAST, { assumeValid: true, assumeValidSDL: true }),
        federatedGraphClientSchema: newClientSchema,
        ...this.getClientSchemaObjectBoolean(),
      },
      ...warnings,
    };
  }

  getClientSchemaObjectBoolean() {
    // If the schema does not implement @tag nor @inaccessible, an empty object will be spread
    if (this.inaccessiblePaths.size < 1 && this.tagNamesByPath.size < 1) {
      return {};
    }
    // otherwise, the object is spread in as true
    return { shouldIncludeClientSchema: true };
  }

  handleChildRemovalByTag(
    parentDefinitionData: ParentDefinitionData,
    children: Map<string, ChildData>,
    childTagDataByChildName: Map<string, ChildTagData>,
    tagsToExclude: Set<string>,
  ) {
    let accessibleChildren = children.size;
    for (const [childName, childTagData] of childTagDataByChildName) {
      const childData = getOrThrowError(children, childName, `${parentDefinitionData.name}.childDataByChildName`);
      if (isNodeDataInaccessible(childData)) {
        accessibleChildren -= 1;
        continue;
      }
      if (doSetsIntersect(tagsToExclude, childTagData.tagNames)) {
        getValueOrDefault(childData.persistedDirectivesData.directives, INACCESSIBLE, () => [
          generateSimpleDirective(INACCESSIBLE),
        ]);
        this.inaccessiblePaths.add(`${parentDefinitionData.name}.${childName}`);
        accessibleChildren -= 1;
      }
    }
    if (accessibleChildren < 1) {
      parentDefinitionData.persistedDirectivesData.directives.set(INACCESSIBLE, [
        generateSimpleDirective(INACCESSIBLE),
      ]);
      this.inaccessiblePaths.add(parentDefinitionData.name);
    }
  }

  buildFederationContractResult(tagsToExclude: Set<string>): FederationResultContainer {
    if (!this.isVersionTwo) {
      /* If all the subgraphs are version one, the @inaccessible directive won't be present.
       ** However, contracts require @inaccessible to exclude applicable tagged types. */
      this.routerDefinitions.push(INACCESSIBLE_DEFINITION);
    }
    for (const [parentTypeName, parentTagData] of this.parentTagDataByTypeName) {
      const parentDefinitionData = getOrThrowError(
        this.parentDefinitionDataByTypeName,
        parentTypeName,
        PARENT_DEFINITION_DATA,
      );
      if (isNodeDataInaccessible(parentDefinitionData)) {
        continue;
      }
      if (doSetsIntersect(tagsToExclude, parentTagData.tagNames)) {
        parentDefinitionData.persistedDirectivesData.directives.set(INACCESSIBLE, [
          generateSimpleDirective(INACCESSIBLE),
        ]);
        this.inaccessiblePaths.add(parentTypeName);
        // If the parent is inaccessible, there is no need to assess further
        continue;
      }
      if (parentTagData.childTagDataByChildName.size < 1) {
        continue;
      }
      switch (parentDefinitionData.kind) {
        case Kind.SCALAR_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.UNION_TYPE_DEFINITION:
          continue;
        case Kind.ENUM_TYPE_DEFINITION:
          this.handleChildRemovalByTag(
            parentDefinitionData,
            parentDefinitionData.enumValueDataByValueName,
            parentTagData.childTagDataByChildName,
            tagsToExclude,
          );
          break;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          this.handleChildRemovalByTag(
            parentDefinitionData,
            parentDefinitionData.inputValueDataByValueName,
            parentTagData.childTagDataByChildName,
            tagsToExclude,
          );
          break;
        default:
          let accessibleFields = parentDefinitionData.fieldDataByFieldName.size;
          for (const [fieldName, childTagData] of parentTagData.childTagDataByChildName) {
            const fieldData = getOrThrowError(
              parentDefinitionData.fieldDataByFieldName,
              fieldName,
              `${parentTypeName}.fieldDataByFieldName`,
            );
            if (isNodeDataInaccessible(fieldData)) {
              accessibleFields -= 1;
              continue;
            }
            if (doSetsIntersect(tagsToExclude, childTagData.tagNames)) {
              getValueOrDefault(fieldData.persistedDirectivesData.directives, INACCESSIBLE, () => [
                generateSimpleDirective(INACCESSIBLE),
              ]);
              this.inaccessiblePaths.add(`${parentTypeName}.${fieldName}`);
              accessibleFields -= 1;
              continue;
            }
            for (const [argumentName, tagNames] of childTagData.tagNamesByArgumentName) {
              const inputValueData = getOrThrowError(
                fieldData.argumentDataByArgumentName,
                argumentName,
                `${fieldName}.argumentDataByArgumentName`,
              );
              if (isNodeDataInaccessible(inputValueData)) {
                continue;
              }
              if (doSetsIntersect(tagsToExclude, tagNames)) {
                getValueOrDefault(inputValueData.persistedDirectivesData.directives, INACCESSIBLE, () => [
                  generateSimpleDirective(INACCESSIBLE),
                ]);
                this.inaccessiblePaths.add(inputValueData.renamedPath);
              }
            }
          }
          if (accessibleFields < 1) {
            parentDefinitionData.persistedDirectivesData.directives.set(INACCESSIBLE, [
              generateSimpleDirective(INACCESSIBLE),
            ]);
            this.inaccessiblePaths.add(parentTypeName);
          }
      }
    }
    if (this.subscriptionFilterDataByFieldPath.size > 0) {
      this.validateSubscriptionFiltersAndGenerateConfiguration();
    }
    for (const data of this.potentialPersistedDirectiveDefinitionDataByDirectiveName.values()) {
      addValidPersistedDirectiveDefinitionNodeByData(
        this.routerDefinitions,
        data,
        this.persistedDirectiveDefinitionByDirectiveName,
        this.errors,
      );
    }
    const interfaceImplementations: InterfaceImplementationData[] = [];
    this.pushParentDefinitionDataToDocumentDefinitions(interfaceImplementations);
    this.validateInterfaceImplementationsAndPushToDocumentDefinitions(interfaceImplementations);
    this.validateQueryRootType();
    const warnings = this.warnings.length > 0 ? this.warnings : undefined;
    if (this.errors.length > 0) {
      return { errors: this.errors, warnings };
    }
    const newRouterAST: DocumentNode = {
      kind: Kind.DOCUMENT,
      definitions: this.routerDefinitions,
    };
    const newClientSchema: GraphQLSchema = buildASTSchema(
      {
        kind: Kind.DOCUMENT,
        definitions: this.clientDefinitions,
      },
      { assumeValid: true, assumeValidSDL: true },
    );
    const subgraphConfigBySubgraphName = new Map<string, SubgraphConfig>();
    for (const subgraph of this.internalSubgraphBySubgraphName.values()) {
      subgraphConfigBySubgraphName.set(subgraph.name, {
        configurationDataMap: subgraph.configurationDataByParentTypeName,
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
        federatedGraphAST: newRouterAST,
        federatedGraphSchema: buildASTSchema(newRouterAST, { assumeValid: true, assumeValidSDL: true }),
        federatedGraphClientSchema: newClientSchema,
        ...this.getClientSchemaObjectBoolean(),
      },
      warnings,
    };
  }

  federateSubgraphsInternal(): FederationResultContainer {
    this.federateSubgraphData();
    return this.buildFederationResult();
  }
}

type FederationFactoryResult = {
  errors?: Error[];
  federationFactory?: FederationFactory;
};

function initializeFederationFactory(subgraphs: Subgraph[]): FederationFactoryResult {
  if (subgraphs.length < 1) {
    return { errors: [minimumSubgraphRequirementError] };
  }
  const {
    authorizationDataByParentTypeName,
    concreteTypeNamesByAbstractTypeName,
    entityDataByTypeName,
    errors,
    internalSubgraphBySubgraphName,
    internalGraph,
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
      getValueOrDefault(invalidEntityInterfacesByTypeName, typeName, () => []).push({
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
  return {
    federationFactory: new FederationFactory({
      authorizationDataByParentTypeName,
      concreteTypeNamesByAbstractTypeName,
      entityDataByTypeName,
      entityInterfaceFederationDataByTypeName,
      internalSubgraphBySubgraphName,
      internalGraph,
      warnings,
    }),
  };
}

export function federateSubgraphs(subgraphs: Subgraph[]): FederationResultContainer {
  const { errors, federationFactory } = initializeFederationFactory(subgraphs);
  if (errors || !federationFactory) {
    return { errors: errors || [federationFactoryInitializationFatalError] };
  }
  return federationFactory.federateSubgraphsInternal();
}

// the flow when publishing a subgraph that also has contracts
export function federateSubgraphsWithContracts(
  subgraphs: Subgraph[],
  tagExclusionsByContractName: Map<string, Set<string>>,
): FederationResultContainerWithContracts {
  const { errors: normalizationErrors, federationFactory } = initializeFederationFactory(subgraphs);
  if (normalizationErrors || !federationFactory) {
    return { errors: normalizationErrors || [federationFactoryInitializationFatalError] };
  }
  federationFactory.federateSubgraphData();
  const federationFactories = [cloneDeep(federationFactory)];
  const { errors, federationResult, warnings } = federationFactory.buildFederationResult();
  // if the base graph fails composition, no contracts will be attempted
  if (errors) {
    return { errors, warnings };
  }
  const lastContractIndex = tagExclusionsByContractName.size - 1;
  const federationResultContainerByContractName: Map<string, FederationResultContainer> = new Map<
    string,
    FederationResultContainer
  >();
  let i = 0;
  for (const [contractName, tagExclusions] of tagExclusionsByContractName) {
    // deep copy the current FederationFactory before it is mutated if it is not the last one required
    if (i !== lastContractIndex) {
      federationFactories.push(cloneDeep(federationFactories[i]));
    }
    // note that any one contract could have its own errors
    const federationResultContainer = federationFactories[i].buildFederationContractResult(tagExclusions);
    federationResultContainerByContractName.set(contractName, federationResultContainer);
    i++;
  }
  return { federationResult, federationResultContainerByContractName };
}

// the flow when adding a completely new contract
export function federateSubgraphsContract(
  subgraphs: Subgraph[],
  tagExclusions: Set<string>,
): FederationResultContainer {
  const { errors, federationFactory } = initializeFederationFactory(subgraphs);
  if (errors || !federationFactory) {
    return { errors: errors || [federationFactoryInitializationFatalError] };
  }
  federationFactory.federateSubgraphData();
  return federationFactory.buildFederationContractResult(tagExclusions);
}
