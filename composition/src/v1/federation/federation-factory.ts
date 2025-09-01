import {
  buildASTSchema,
  ConstDirectiveNode,
  ConstObjectValueNode,
  DirectiveDefinitionNode,
  DocumentNode,
  GraphQLSchema,
  Kind,
  ListTypeNode,
  NamedTypeNode,
  NonNullTypeNode,
  StringValueNode,
  TypeNode,
} from 'graphql';
import {
  getMutableTypeNode,
  getTypeNodeNamedTypeName,
  MutableEnumValueNode,
  MutableFieldNode,
  MutableInputValueNode,
  MutableIntermediateTypeNode,
  MutableTypeDefinitionNode,
  MutableTypeNode,
} from '../../schema-building/ast';
import { stringToNamedTypeNode, stringToNameNode } from '../../ast/utils';
import {
  allChildDefinitionsAreInaccessibleError,
  allExternalFieldInstancesError,
  configureDescriptionPropagationError,
  inaccessibleQueryRootTypeError,
  inaccessibleRequiredInputValueError,
  inaccessibleSubscriptionFieldConditionFieldPathFieldErrorMessage,
  incompatibleFederatedFieldNamedTypeError,
  incompatibleMergedTypesError,
  incompatibleParentKindFatalError,
  incompatibleParentKindMergeError,
  incompatibleSharedEnumError,
  invalidFieldShareabilityError,
  invalidImplementedTypeError,
  invalidInputFieldTypeErrorMessage,
  invalidInterfaceImplementationError,
  invalidInterfaceObjectImplementationDefinitionsError,
  invalidReferencesOfInaccessibleTypeError,
  invalidRepeatedFederatedDirectiveErrorMessage,
  invalidRequiredInputValueError,
  invalidSubscriptionFieldConditionFieldPathErrorMessage,
  invalidSubscriptionFieldConditionFieldPathFieldErrorMessage,
  invalidSubscriptionFieldConditionFieldPathParentErrorMessage,
  invalidSubscriptionFilterDirectiveError,
  maximumTypeNestingExceededError,
  minimumSubgraphRequirementError,
  noBaseDefinitionForExtensionError,
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
  subscriptionFilterNamedTypeErrorMessage,
  undefinedEntityInterfaceImplementationsError,
  undefinedSubscriptionFieldConditionFieldPathFieldErrorMessage,
  undefinedTypeError,
  unexpectedNonCompositeOutputTypeError,
  unknownFieldDataError,
  unknownFieldSubgraphNameError,
  unknownNamedTypeError,
} from '../../errors/errors';
import {
  ChildTagData,
  FederationFactoryParams,
  getDescriptionFromString,
  InterfaceImplementationData,
  InterfaceObjectForInternalGraphOptions,
  newChildTagData,
  newParentTagData,
  ParentTagData,
  SubscriptionFilterData,
  validateImplicitFieldSets,
} from './utils';
import { SUBSCRIPTION_FILTER_INPUT_NAMES, SUBSCRIPTION_FILTER_LIST_INPUT_NAMES } from '../utils/string-constants';
import {
  isNodeLeaf,
  isObjectDefinitionData,
  mapToArrayOfValues,
  mergeRequiredScopesByAND,
  newAuthorizationData,
  newEntityInterfaceFederationData,
  newFieldAuthorizationData,
  upsertAuthorizationConfiguration,
  upsertEntityInterfaceFederationData,
  upsertFieldAuthorizationData,
} from '../utils/utils';
import { printTypeNode } from '@graphql-tools/merge';
import {
  FieldConfiguration,
  RequiredFieldConfiguration,
  SubscriptionCondition,
  SubscriptionFieldCondition,
  SubscriptionFilterValue,
} from '../../router-configuration/types';
import {
  AUTHENTICATED_DEFINITION,
  BASE_SCALARS,
  DEPRECATED_DEFINITION,
  INACCESSIBLE_DEFINITION,
  MAX_OR_SCOPES,
  REQUIRES_SCOPES_DEFINITION,
  SCOPE_SCALAR_DEFINITION,
  TAG_DEFINITION,
} from '../utils/constants';
import { batchNormalize } from '../normalization/normalization-factory';
import { isNodeQuery } from '../normalization/utils';
import {
  AuthorizationData,
  ChildData,
  CompositeOutputData,
  EntityData,
  EntityInterfaceFederationData,
  EnumValueData,
  ExtensionType,
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
} from '../../schema-building/types';
import {
  addValidPersistedDirectiveDefinitionNodeByData,
  areKindsEqual,
  compareAndValidateInputValueDefaultValues,
  extractPersistedDirectives,
  generateDeprecatedDirective,
  getClientPersistedDirectiveNodes,
  getClientSchemaFieldNodeByFieldData,
  getDefinitionDataCoords,
  getInitialFederatedDescription,
  getNodeForRouterSchemaByData,
  getSubscriptionFilterValue,
  isLeafKind,
  isNodeDataInaccessible,
  isParentDataCompositeOutputType,
  isParentDataRootType,
  isTypeRequired,
  isTypeValidImplementation,
  MergeMethod,
  newInvalidFieldNames,
  newPersistedDirectivesData,
  propagateAuthDirectives,
  propagateFieldAuthDirectives,
  setLongestDescription,
  setMutualExecutableLocations,
  setParentDataExtensionType,
  validateExternalAndShareable,
} from '../../schema-building/utils';

import { renameRootTypes } from './walkers';
import { cloneDeep } from 'lodash';
import {
  DivergentType,
  FederateTypeParams,
  FederateTypeResult,
  getMostRestrictiveMergedTypeNode,
} from '../schema-building/type-merging';
import { Graph } from '../../resolvability-graph/graph';
import { GraphNode } from '../../resolvability-graph/graph-nodes';
import { InternalSubgraph, SubgraphConfig } from '../../subgraph/types';
import { Warning } from '../../warnings/types';
import {
  ContractTagOptions,
  FederationResult,
  FederationResultWithContracts,
  MutualParentDefinitionData,
} from '../../federation/types';
import {
  AND_UPPER,
  AUTHENTICATED,
  CONDITION,
  DEPRECATED,
  ENUM_VALUE,
  FIELD,
  FIELD_PATH,
  IN_UPPER,
  INACCESSIBLE,
  INPUT_OBJECT,
  LEFT_PARENTHESIS,
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
  TAG,
  UNION,
  VALUES,
} from '../../utils/string-constants';
import { MAX_SUBSCRIPTION_FILTER_DEPTH, MAXIMUM_TYPE_NESTING } from '../../utils/integer-constants';
import {
  addIterableValuesToSet,
  addMapEntries,
  addNewObjectValueMapEntries,
  copyArrayValueMap,
  copyObjectValueMap,
  generateSimpleDirective,
  getEntriesNotInHashSet,
  getOrThrowError,
  getSingleSetEntry,
  getValueOrDefault,
  kindToNodeType,
} from '../../utils/utils';
import {
  GraphFieldData,
  ImplementationErrors,
  InvalidEntityInterface,
  InvalidFieldImplementation,
  InvalidRequiredInputValueData,
} from '../../utils/types';
import { FederateSubgraphsContractV1Params, FederateSubgraphsWithContractsV1Params, FederationParams } from './types';
import { ContractName, FieldCoords, FieldName, SubgraphName, TypeName } from '../../types/types';

export class FederationFactory {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  coordsByNamedTypeName = new Map<string, Set<string>>();
  disableResolvabilityValidation: boolean = false;
  clientDefinitions: MutableTypeDefinitionNode[] = [DEPRECATED_DEFINITION];
  currentSubgraphName = '';
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  subgraphNamesByNamedTypeNameByFieldCoords = new Map<string, Map<string, Set<string>>>();
  entityDataByTypeName: Map<string, EntityData>;
  entityInterfaceFederationDataByTypeName: Map<string, EntityInterfaceFederationData>;
  errors: Error[] = [];
  fieldConfigurationByFieldCoords = new Map<string, FieldConfiguration>();
  fieldCoordsByNamedTypeName: Map<TypeName, Set<FieldCoords>>;
  inaccessibleCoords = new Set<string>();
  inaccessibleRequiredInputValueErrorByCoords = new Map<string, Error>();
  internalGraph: Graph;
  internalSubgraphBySubgraphName: Map<string, InternalSubgraph>;
  invalidORScopesCoords = new Set<string>();
  isMaxDepth = false;
  isVersionTwo = false;
  namedInputValueTypeNames = new Set<string>();
  namedOutputTypeNames = new Set<string>();
  parentDefinitionDataByTypeName = new Map<string, ParentDefinitionData>();
  parentTagDataByTypeName = new Map<string, ParentTagData>();
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
  subscriptionFilterDataByFieldPath = new Map<string, SubscriptionFilterData>();
  tagNamesByCoords = new Map<string, Set<string>>();
  warnings: Warning[];

  constructor({
    authorizationDataByParentTypeName,
    concreteTypeNamesByAbstractTypeName,
    disableResolvabilityValidation,
    entityDataByTypeName,
    entityInterfaceFederationDataByTypeName,
    fieldCoordsByNamedTypeName,
    internalGraph,
    internalSubgraphBySubgraphName,
    warnings,
  }: FederationFactoryParams) {
    this.authorizationDataByParentTypeName = authorizationDataByParentTypeName;
    this.concreteTypeNamesByAbstractTypeName = concreteTypeNamesByAbstractTypeName;
    this.disableResolvabilityValidation = disableResolvabilityValidation ?? false;
    this.entityDataByTypeName = entityDataByTypeName;
    this.entityInterfaceFederationDataByTypeName = entityInterfaceFederationDataByTypeName;
    this.fieldCoordsByNamedTypeName = fieldCoordsByNamedTypeName;
    this.internalGraph = internalGraph;
    this.internalSubgraphBySubgraphName = internalSubgraphBySubgraphName;
    this.warnings = warnings;
  }

  getValidImplementedInterfaces(data: CompositeOutputData): NamedTypeNode[] {
    const interfaces: NamedTypeNode[] = [];
    if (data.implementedInterfaceTypeNames.size < 1) {
      return interfaces;
    }
    const isParentInaccessible = isNodeDataInaccessible(data);
    const implementationErrorsByInterfaceName = new Map<string, ImplementationErrors>();
    const invalidImplementationTypeStringByTypeName = new Map<string, string>();
    for (const interfaceName of data.implementedInterfaceTypeNames) {
      interfaces.push(stringToNamedTypeNode(interfaceName));
      const implementationData = getOrThrowError(
        this.parentDefinitionDataByTypeName,
        interfaceName,
        PARENT_DEFINITION_DATA,
      );
      if (implementationData.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        invalidImplementationTypeStringByTypeName.set(implementationData.name, kindToNodeType(implementationData.kind));
        continue;
      }
      const implementationErrors: ImplementationErrors = {
        invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
        unimplementedFields: [],
      };
      let hasErrors = false;
      for (const [fieldName, interfaceField] of implementationData.fieldDataByName) {
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
        for (const [argumentName, inputValueData] of interfaceField.argumentDataByName) {
          const interfaceArgument = inputValueData.node;
          handledArguments.add(argumentName);
          const argumentNode = fieldData.argumentDataByName.get(argumentName)?.node;
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
        for (const [argumentName, inputValueContainer] of fieldData.argumentDataByName) {
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
        implementationErrorsByInterfaceName.set(interfaceName, implementationErrors);
      }
    }
    if (invalidImplementationTypeStringByTypeName.size > 0) {
      this.errors.push(invalidImplementedTypeError(data.name, invalidImplementationTypeStringByTypeName));
    }
    if (implementationErrorsByInterfaceName.size > 0) {
      this.errors.push(
        invalidInterfaceImplementationError(
          data.node.name.value,
          kindToNodeType(data.kind),
          implementationErrorsByInterfaceName,
        ),
      );
    }
    return interfaces;
  }

  addValidPrimaryKeyTargetsToEntityData(typeName: string) {
    const entityData = this.entityDataByTypeName.get(typeName);
    if (!entityData) {
      return;
    }
    const internalSubgraph = getOrThrowError(
      this.internalSubgraphBySubgraphName,
      this.currentSubgraphName,
      'internalSubgraphBySubgraphName',
    );
    const parentDefinitionDataByTypeName = internalSubgraph.parentDefinitionDataByTypeName;
    const objectData = parentDefinitionDataByTypeName.get(entityData.typeName);
    if (!objectData || objectData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
      throw incompatibleParentKindFatalError(
        entityData.typeName,
        Kind.OBJECT_TYPE_DEFINITION,
        objectData?.kind || Kind.NULL,
      );
    }
    const configurationData = internalSubgraph.configurationDataByTypeName.get(entityData.typeName);
    // If all fields are overridden, there will be no configuration data.
    if (!configurationData) {
      return;
    }
    const implicitKeys: RequiredFieldConfiguration[] = [];
    const graphNode = this.internalGraph.nodeByNodeName.get(`${this.currentSubgraphName}.${entityData.typeName}`);
    // Any errors in the field sets would be caught when evaluating the explicit entities, so they are ignored here
    validateImplicitFieldSets({
      conditionalFieldDataByCoords: internalSubgraph.conditionalFieldDataByCoordinates,
      currentSubgraphName: this.currentSubgraphName,
      entityData,
      implicitKeys,
      objectData,
      parentDefinitionDataByTypeName,
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
        conditionalFieldDataByCoords: internalSubgraph.conditionalFieldDataByCoordinates,
        currentSubgraphName: this.currentSubgraphName,
        entityData: interfaceObjectEntityData,
        implicitKeys,
        objectData,
        parentDefinitionDataByTypeName,
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
    const interfaceObjectData = parentDefinitionDataByTypeName.get(interfaceObjectTypeName);
    if (!interfaceObjectData || !isParentDataCompositeOutputType(interfaceObjectData)) {
      throw incompatibleParentKindFatalError(
        interfaceObjectTypeName,
        Kind.INTERFACE_TYPE_DEFINITION,
        interfaceObjectData?.kind || Kind.NULL,
      );
    }
    const configurationData = getOrThrowError(
      internalSubgraph.configurationDataByTypeName,
      entityData.typeName,
      'internalSubgraph.configurationDataByTypeName',
    );
    const implicitKeys: RequiredFieldConfiguration[] = [];
    // Any errors in the field sets would be caught when evaluating the explicit entities, so they are ignored here
    validateImplicitFieldSets({
      conditionalFieldDataByCoords: internalSubgraph.conditionalFieldDataByCoordinates,
      currentSubgraphName: internalSubgraph.name,
      entityData,
      implicitKeys,
      objectData: interfaceObjectData,
      parentDefinitionDataByTypeName,
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
    for (const [path, tagNames] of this.tagNamesByCoords) {
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
    const targetData = existingData || this.copyEnumValueData(incomingData);
    extractPersistedDirectives(
      targetData.persistedDirectivesData,
      incomingData.directivesByDirectiveName,
      this.persistedDirectiveDefinitionByDirectiveName,
    );
    const isValueInaccessible = isNodeDataInaccessible(incomingData);
    if (isParentInaccessible || isValueInaccessible) {
      this.inaccessibleCoords.add(targetData.federatedCoords);
    }
    this.recordTagNamesByCoords(targetData, targetData.federatedCoords);
    if (!existingData) {
      enumValueDataByValueName.set(targetData.name, targetData);
      return;
    }
    targetData.appearances += 1;
    addNewObjectValueMapEntries(
      incomingData.configureDescriptionDataBySubgraphName,
      targetData.configureDescriptionDataBySubgraphName,
    );
    setLongestDescription(targetData, incomingData);
    addIterableValuesToSet(incomingData.subgraphNames, targetData.subgraphNames);
  }

  // To facilitate the splitting of tag paths, field arguments do not use the renamedPath property for tagNamesByPath
  upsertInputValueData(
    inputValueDataByValueName: Map<string, InputValueData>,
    incomingData: InputValueData,
    parentCoords: string,
    isParentInaccessible: boolean,
  ) {
    const existingData = inputValueDataByValueName.get(incomingData.name);
    const targetData = existingData || this.copyInputValueData(incomingData);
    extractPersistedDirectives(
      targetData.persistedDirectivesData,
      incomingData.directivesByDirectiveName,
      this.persistedDirectiveDefinitionByDirectiveName,
    );
    this.recordTagNamesByCoords(targetData, `${parentCoords}.${targetData.name}`);
    this.namedInputValueTypeNames.add(targetData.namedTypeName);
    getValueOrDefault(this.coordsByNamedTypeName, targetData.namedTypeName, () => new Set<string>()).add(
      targetData.federatedCoords,
    );
    if (!existingData) {
      inputValueDataByValueName.set(targetData.name, targetData);
      return;
    }
    addNewObjectValueMapEntries(
      incomingData.configureDescriptionDataBySubgraphName,
      targetData.configureDescriptionDataBySubgraphName,
    );
    setLongestDescription(targetData, incomingData);
    addIterableValuesToSet(incomingData.requiredSubgraphNames, targetData.requiredSubgraphNames);
    addIterableValuesToSet(incomingData.subgraphNames, targetData.subgraphNames);
    this.handleInputValueInaccessibility(isParentInaccessible, targetData, parentCoords);
    // TODO refactor type merging
    const mergeResult = getMostRestrictiveMergedTypeNode(
      targetData.type,
      incomingData.type,
      targetData.originalCoords,
      this.errors,
    );
    if (mergeResult.success) {
      targetData.type = mergeResult.typeNode;
    } else {
      this.errors.push(
        incompatibleMergedTypesError({
          actualType: mergeResult.actualType,
          isArgument: existingData.isArgument,
          coords: existingData.federatedCoords,
          expectedType: mergeResult.expectedType,
        }),
      );
    }
    compareAndValidateInputValueDefaultValues(targetData, incomingData, this.errors);
  }

  handleInputValueInaccessibility(isParentInaccessible: boolean, inputValueData: InputValueData, parentCoords: string) {
    /* If an ancestor (Input Object for field; Composite type or field for argument) of the input value is
     * @inaccessible, nullability is not considered.
     * However, if only the input value (field or argument) itself is @inaccessible, an error is returned.
     */
    if (isParentInaccessible) {
      this.inaccessibleRequiredInputValueErrorByCoords.delete(inputValueData.federatedCoords);
      this.inaccessibleCoords.add(inputValueData.federatedCoords);
      return;
    }
    if (!isNodeDataInaccessible(inputValueData)) {
      return;
    }
    if (isTypeRequired(inputValueData.type)) {
      this.inaccessibleRequiredInputValueErrorByCoords.set(
        inputValueData.federatedCoords,
        inaccessibleRequiredInputValueError(inputValueData, parentCoords),
      );
      return;
    }
    this.inaccessibleCoords.add(inputValueData.federatedCoords);
  }

  handleSubscriptionFilterDirective(incomingData: FieldData, targetData?: FieldData) {
    const subscriptionFilters = incomingData.directivesByDirectiveName.get(SUBSCRIPTION_FILTER);
    if (!subscriptionFilters) {
      return;
    }
    // There should only be a single entry in the set
    const subgraphName = getSingleSetEntry(incomingData.subgraphNames);
    if (subgraphName === undefined) {
      this.errors.push(unknownFieldSubgraphNameError(incomingData.federatedCoords));
      return;
    }
    // @openfed__subscriptionFilter is non-repeatable
    this.subscriptionFilterDataByFieldPath.set(incomingData.federatedCoords, {
      directive: subscriptionFilters[0],
      fieldData: targetData || incomingData,
      directiveSubgraphName: subgraphName,
    });
  }

  federateOutputType({ current, other, coords, mostRestrictive }: FederateTypeParams): FederateTypeResult {
    other = getMutableTypeNode(other, coords, this.errors); // current is already a deep copy
    // The first type of the pair to diverge in restriction takes precedence in all future differences.
    // If the other type of the pair also diverges, it's an error.
    // To keep the output link intact, it is not possible to spread assign "lastTypeNode".
    const federatedTypeNode: MutableIntermediateTypeNode = { kind: current.kind };
    let divergentType = DivergentType.NONE;
    let lastTypeNode: MutableIntermediateTypeNode = federatedTypeNode;
    for (let i = 0; i < MAXIMUM_TYPE_NESTING; i++) {
      if (current.kind === other.kind) {
        switch (current.kind) {
          case Kind.NAMED_TYPE:
            lastTypeNode.kind = current.kind;
            lastTypeNode.name = current.name;
            return { success: true, typeNode: federatedTypeNode as TypeNode };
          case Kind.LIST_TYPE:
            lastTypeNode.kind = current.kind;
            lastTypeNode.type = { kind: current.type.kind };
            lastTypeNode = lastTypeNode.type;
            current = current.type;
            other = (other as ListTypeNode).type;
            continue;
          case Kind.NON_NULL_TYPE:
            lastTypeNode.kind = current.kind;
            lastTypeNode.type = { kind: current.type.kind };
            lastTypeNode = lastTypeNode.type;
            current = current.type;
            other = (other as NonNullTypeNode).type;
            continue;
        }
      }
      if (current.kind === Kind.NON_NULL_TYPE) {
        if (divergentType === DivergentType.OTHER) {
          this.errors.push(
            incompatibleMergedTypesError({ actualType: other.kind, coords, expectedType: current.kind }),
          );
          return { success: false };
        } else {
          divergentType = DivergentType.CURRENT;
        }
        if (mostRestrictive) {
          lastTypeNode.kind = current.kind;
          lastTypeNode.type = { kind: current.type.kind };
          lastTypeNode = lastTypeNode.type;
        }
        current = current.type;
        continue;
      }
      if (other.kind === Kind.NON_NULL_TYPE) {
        if (divergentType === DivergentType.CURRENT) {
          this.errors.push(
            incompatibleMergedTypesError({ actualType: other.kind, coords, expectedType: current.kind }),
          );
          return { success: false };
        } else {
          divergentType = DivergentType.OTHER;
        }
        if (mostRestrictive) {
          lastTypeNode.kind = other.kind;
          lastTypeNode.type = { kind: other.type.kind };
          lastTypeNode = lastTypeNode.type;
        }
        other = other.type;
        continue;
      }
      // At least one of the types must be a non-null wrapper, or the types are inconsistent
      this.errors.push(incompatibleMergedTypesError({ actualType: other.kind, coords, expectedType: current.kind }));
      return { success: false };
    }
    this.errors.push(maximumTypeNestingExceededError(coords));
    return { success: false };
  }

  addSubgraphNameToExistingFieldNamedTypeDisparity(incomingData: FieldData) {
    const subgraphNamesByNamedTypeName = this.subgraphNamesByNamedTypeNameByFieldCoords.get(
      incomingData.federatedCoords,
    );
    if (!subgraphNamesByNamedTypeName) {
      return;
    }
    addIterableValuesToSet(
      incomingData.subgraphNames,
      getValueOrDefault(subgraphNamesByNamedTypeName, incomingData.namedTypeName, () => new Set<String>()),
    );
  }

  upsertFieldData(
    fieldDataByFieldName: Map<string, FieldData>,
    incomingData: FieldData,
    isParentInaccessible: boolean,
  ) {
    const existingData = fieldDataByFieldName.get(incomingData.name);
    const targetData =
      existingData || this.copyFieldData(incomingData, isParentInaccessible || isNodeDataInaccessible(incomingData));
    getValueOrDefault(this.coordsByNamedTypeName, incomingData.namedTypeName, () => new Set<string>()).add(
      targetData.federatedCoords,
    );
    this.namedOutputTypeNames.add(incomingData.namedTypeName);
    this.handleSubscriptionFilterDirective(incomingData, targetData);
    extractPersistedDirectives(
      targetData.persistedDirectivesData,
      incomingData.directivesByDirectiveName,
      this.persistedDirectiveDefinitionByDirectiveName,
    );
    const isFieldInaccessible = isParentInaccessible || isNodeDataInaccessible(targetData);
    if (isFieldInaccessible) {
      this.inaccessibleCoords.add(targetData.federatedCoords);
    }
    this.recordTagNamesByCoords(targetData, targetData.federatedCoords);
    if (!existingData) {
      fieldDataByFieldName.set(targetData.name, targetData);
      return;
    }
    const result = this.federateOutputType({
      current: targetData.type,
      other: incomingData.type,
      coords: targetData.federatedCoords,
      mostRestrictive: false,
    });
    if (result.success) {
      targetData.type = result.typeNode;
      if (targetData.namedTypeName !== incomingData.namedTypeName) {
        const subgraphNamesByNamedTypeName = getValueOrDefault(
          this.subgraphNamesByNamedTypeNameByFieldCoords,
          targetData.federatedCoords,
          () => new Map<string, Set<string>>(),
        );
        /* Only propagate the subgraph names of the existing data if it has never been propagated before.
         * This is to prevent the propagation of subgraph names where that named type is not returned.
         */
        const existingSubgraphNames = getValueOrDefault(
          subgraphNamesByNamedTypeName,
          targetData.namedTypeName,
          () => new Set<String>(),
        );
        if (existingSubgraphNames.size < 1) {
          // Add all subgraph names that are not the subgraph name in the incoming data
          for (const subgraphName of targetData.subgraphNames) {
            if (!incomingData.subgraphNames.has(subgraphName)) {
              existingSubgraphNames.add(subgraphName);
            }
          }
        }
        addIterableValuesToSet(
          incomingData.subgraphNames,
          getValueOrDefault(subgraphNamesByNamedTypeName, incomingData.namedTypeName, () => new Set<String>()),
        );
      } else {
        /* If the named types match but there has already been a disparity in the named type names returned by the
         * field, add the incoming subgraph name to the existing subgraph name set for that named type name.
         */
        this.addSubgraphNameToExistingFieldNamedTypeDisparity(incomingData);
      }
    }
    for (const inputValueData of incomingData.argumentDataByName.values()) {
      this.upsertInputValueData(
        targetData.argumentDataByName,
        inputValueData,
        targetData.federatedCoords,
        isFieldInaccessible,
      );
    }
    addNewObjectValueMapEntries(
      incomingData.configureDescriptionDataBySubgraphName,
      existingData.configureDescriptionDataBySubgraphName,
    );
    setLongestDescription(targetData, incomingData);
    targetData.isInaccessible ||= incomingData.isInaccessible;
    addNewObjectValueMapEntries(
      incomingData.externalFieldDataBySubgraphName,
      targetData.externalFieldDataBySubgraphName,
    );
    addMapEntries(incomingData.isShareableBySubgraphName, targetData.isShareableBySubgraphName);
    addIterableValuesToSet(incomingData.subgraphNames, targetData.subgraphNames);
  }

  getClientSchemaUnionMembers(unionData: UnionDefinitionData): NamedTypeNode[] {
    const members: NamedTypeNode[] = [];
    for (const [memberName, namedTypeNode] of unionData.memberByMemberTypeName) {
      if (!this.inaccessibleCoords.has(memberName)) {
        members.push(namedTypeNode);
      }
    }
    return members;
  }

  recordTagNamesByCoords(data: NodeData, coords?: string) {
    const path = coords || data.name;
    if (data.persistedDirectivesData.tagDirectiveByName.size < 1) {
      return;
    }
    const tagNames = getValueOrDefault(this.tagNamesByCoords, path, () => new Set<string>());
    for (const tagName of data.persistedDirectivesData.tagDirectiveByName.keys()) {
      tagNames.add(tagName);
    }
  }

  copyMutualParentDefinitionData(sourceData: ParentDefinitionData): MutualParentDefinitionData {
    return {
      configureDescriptionDataBySubgraphName: copyObjectValueMap(sourceData.configureDescriptionDataBySubgraphName),
      directivesByDirectiveName: copyArrayValueMap(sourceData.directivesByDirectiveName),
      extensionType: sourceData.extensionType,
      name: sourceData.name,
      persistedDirectivesData: extractPersistedDirectives(
        newPersistedDirectivesData(),
        sourceData.directivesByDirectiveName,
        this.persistedDirectiveDefinitionByDirectiveName,
      ),
      description: getInitialFederatedDescription(sourceData),
    };
  }

  copyEnumValueData(sourceData: EnumValueData): EnumValueData {
    return {
      appearances: sourceData.appearances,
      configureDescriptionDataBySubgraphName: copyObjectValueMap(sourceData.configureDescriptionDataBySubgraphName),
      federatedCoords: sourceData.federatedCoords,
      directivesByDirectiveName: copyArrayValueMap(sourceData.directivesByDirectiveName),
      kind: sourceData.kind,
      name: sourceData.name,
      node: {
        directives: [],
        kind: sourceData.kind,
        name: stringToNameNode(sourceData.name),
      },
      parentTypeName: sourceData.parentTypeName,
      persistedDirectivesData: extractPersistedDirectives(
        newPersistedDirectivesData(),
        sourceData.directivesByDirectiveName,
        this.persistedDirectiveDefinitionByDirectiveName,
      ),
      subgraphNames: new Set(sourceData.subgraphNames),
      description: getInitialFederatedDescription(sourceData),
    };
  }

  copyInputValueData(sourceData: InputValueData): InputValueData {
    return {
      configureDescriptionDataBySubgraphName: copyObjectValueMap(sourceData.configureDescriptionDataBySubgraphName),
      directivesByDirectiveName: copyArrayValueMap(sourceData.directivesByDirectiveName),
      federatedCoords: sourceData.federatedCoords,
      fieldName: sourceData.fieldName,
      includeDefaultValue: sourceData.includeDefaultValue,
      isArgument: sourceData.isArgument,
      kind: sourceData.kind,
      name: sourceData.name,
      namedTypeKind: sourceData.namedTypeKind,
      namedTypeName: sourceData.namedTypeName,
      node: {
        directives: [],
        kind: Kind.INPUT_VALUE_DEFINITION,
        name: stringToNameNode(sourceData.name),
        type: sourceData.type,
      },
      originalCoords: sourceData.originalCoords,
      originalParentTypeName: sourceData.originalParentTypeName,
      persistedDirectivesData: extractPersistedDirectives(
        newPersistedDirectivesData(),
        sourceData.directivesByDirectiveName,
        this.persistedDirectiveDefinitionByDirectiveName,
      ),
      renamedParentTypeName: sourceData.renamedParentTypeName,
      requiredSubgraphNames: new Set(sourceData.requiredSubgraphNames),
      subgraphNames: new Set(sourceData.subgraphNames),
      type: sourceData.type,
      defaultValue: sourceData.defaultValue,
      description: getInitialFederatedDescription(sourceData),
    };
  }

  copyInputValueDataByValueName(
    source: Map<string, InputValueData>,
    isParentInaccessible: boolean,
    parentCoords: string,
  ): Map<string, InputValueData> {
    const inputValueDataByInputValueName = new Map<string, InputValueData>();
    for (const [inputValueName, sourceData] of source) {
      const targetData = this.copyInputValueData(sourceData);
      this.handleInputValueInaccessibility(isParentInaccessible, targetData, parentCoords);
      getValueOrDefault(this.coordsByNamedTypeName, targetData.namedTypeName, () => new Set<string>()).add(
        targetData.federatedCoords,
      );
      this.namedInputValueTypeNames.add(targetData.namedTypeName);
      this.recordTagNamesByCoords(targetData, `${parentCoords}.${sourceData.name}`);
      inputValueDataByInputValueName.set(inputValueName, targetData);
    }
    return inputValueDataByInputValueName;
  }

  copyFieldData(sourceData: FieldData, isInaccessible: boolean): FieldData {
    return {
      argumentDataByName: this.copyInputValueDataByValueName(
        sourceData.argumentDataByName,
        isInaccessible,
        sourceData.federatedCoords,
      ),
      configureDescriptionDataBySubgraphName: copyObjectValueMap(sourceData.configureDescriptionDataBySubgraphName),
      directivesByDirectiveName: copyArrayValueMap(sourceData.directivesByDirectiveName),
      externalFieldDataBySubgraphName: copyObjectValueMap(sourceData.externalFieldDataBySubgraphName),
      federatedCoords: sourceData.federatedCoords,
      // Intentionally reset; only the subgraph fields involve directive inheritance
      inheritedDirectiveNames: new Set<string>(),
      isInaccessible: sourceData.isInaccessible,
      isShareableBySubgraphName: new Map(sourceData.isShareableBySubgraphName),
      kind: sourceData.kind,
      name: sourceData.name,
      namedTypeKind: sourceData.namedTypeKind,
      namedTypeName: sourceData.namedTypeName,
      node: {
        arguments: [],
        directives: [],
        kind: sourceData.kind,
        name: stringToNameNode(sourceData.name),
        type: sourceData.type,
      },
      originalParentTypeName: sourceData.originalParentTypeName,
      persistedDirectivesData: extractPersistedDirectives(
        newPersistedDirectivesData(),
        sourceData.directivesByDirectiveName,
        this.persistedDirectiveDefinitionByDirectiveName,
      ),
      renamedParentTypeName: sourceData.renamedParentTypeName,
      subgraphNames: new Set(sourceData.subgraphNames),
      type: sourceData.type,
      description: getInitialFederatedDescription(sourceData),
    };
  }

  copyEnumValueDataByValueName(
    source: Map<string, EnumValueData>,
    isParentInaccessible: boolean,
  ): Map<string, EnumValueData> {
    const output = new Map<string, EnumValueData>();
    for (const [childName, sourceData] of source) {
      const targetData = this.copyEnumValueData(sourceData);
      this.recordTagNamesByCoords(targetData, targetData.federatedCoords);
      if (isParentInaccessible || isNodeDataInaccessible(targetData)) {
        this.inaccessibleCoords.add(targetData.federatedCoords);
      }
      output.set(childName, targetData);
    }
    return output;
  }

  copyFieldDataByName(source: Map<string, FieldData>, isParentInaccessible: boolean): Map<string, FieldData> {
    const fieldDataByFieldName = new Map<string, FieldData>();
    for (const [fieldName, sourceData] of source) {
      const isFieldInaccessible = isParentInaccessible || isNodeDataInaccessible(sourceData);
      const targetData = this.copyFieldData(sourceData, isFieldInaccessible);
      this.handleSubscriptionFilterDirective(targetData);
      getValueOrDefault(this.coordsByNamedTypeName, targetData.namedTypeName, () => new Set<string>()).add(
        targetData.federatedCoords,
      );
      this.namedOutputTypeNames.add(targetData.namedTypeName);
      this.recordTagNamesByCoords(targetData, targetData.federatedCoords);
      if (isFieldInaccessible) {
        this.inaccessibleCoords.add(targetData.federatedCoords);
      }
      fieldDataByFieldName.set(fieldName, targetData);
    }
    return fieldDataByFieldName;
  }

  copyParentDefinitionData(sourceData: ParentDefinitionData): ParentDefinitionData {
    const data = this.copyMutualParentDefinitionData(sourceData);
    switch (sourceData.kind) {
      case Kind.ENUM_TYPE_DEFINITION: {
        return {
          ...data,
          appearances: sourceData.appearances,
          enumValueDataByValueName: this.copyEnumValueDataByValueName(
            sourceData.enumValueDataByValueName,
            sourceData.isInaccessible,
          ),
          isInaccessible: sourceData.isInaccessible,
          kind: sourceData.kind,
          node: {
            kind: sourceData.kind,
            name: stringToNameNode(sourceData.name),
          },
          subgraphNames: new Set(sourceData.subgraphNames),
        };
      }
      case Kind.INPUT_OBJECT_TYPE_DEFINITION: {
        return {
          ...data,
          inputValueDataByName: this.copyInputValueDataByValueName(
            sourceData.inputValueDataByName,
            sourceData.isInaccessible,
            sourceData.name,
          ),
          isInaccessible: sourceData.isInaccessible,
          kind: sourceData.kind,
          node: {
            kind: sourceData.kind,
            name: stringToNameNode(sourceData.name),
          },
          subgraphNames: new Set(sourceData.subgraphNames),
        };
      }
      case Kind.INTERFACE_TYPE_DEFINITION: {
        return {
          ...data,
          fieldDataByName: this.copyFieldDataByName(sourceData.fieldDataByName, sourceData.isInaccessible),
          implementedInterfaceTypeNames: new Set(sourceData.implementedInterfaceTypeNames),
          isEntity: sourceData.isEntity,
          isInaccessible: sourceData.isInaccessible,
          kind: sourceData.kind,
          node: {
            kind: sourceData.kind,
            name: stringToNameNode(sourceData.name),
          },
          subgraphNames: new Set(sourceData.subgraphNames),
        };
      }
      case Kind.OBJECT_TYPE_DEFINITION: {
        return {
          ...data,
          fieldDataByName: this.copyFieldDataByName(sourceData.fieldDataByName, sourceData.isInaccessible),
          implementedInterfaceTypeNames: new Set(sourceData.implementedInterfaceTypeNames),
          isEntity: sourceData.isEntity,
          isInaccessible: sourceData.isInaccessible,
          isRootType: sourceData.isRootType,
          kind: sourceData.kind,
          node: {
            kind: sourceData.kind,
            name: stringToNameNode(sourceData.renamedTypeName || sourceData.name),
          },
          requireFetchReasonsFieldNames: new Set<FieldName>(),
          renamedTypeName: sourceData.renamedTypeName,
          subgraphNames: new Set(sourceData.subgraphNames),
        };
      }
      case Kind.SCALAR_TYPE_DEFINITION: {
        return {
          ...data,
          kind: sourceData.kind,
          node: {
            kind: sourceData.kind,
            name: stringToNameNode(sourceData.name),
          },
          subgraphNames: new Set(sourceData.subgraphNames),
        };
      }
      case Kind.UNION_TYPE_DEFINITION: {
        return {
          ...data,
          kind: sourceData.kind,
          node: {
            kind: sourceData.kind,
            name: stringToNameNode(sourceData.name),
          },
          memberByMemberTypeName: new Map(sourceData.memberByMemberTypeName),
          subgraphNames: new Set(sourceData.subgraphNames),
        };
      }
    }
  }

  getParentTargetData({
    existingData,
    incomingData,
  }: {
    existingData?: ParentDefinitionData;
    incomingData: ParentDefinitionData;
  }): ParentDefinitionData {
    if (!existingData) {
      const targetData = this.copyParentDefinitionData(incomingData);
      if (isParentDataRootType(targetData)) {
        targetData.extensionType = ExtensionType.NONE;
      }
      return targetData;
    }
    extractPersistedDirectives(
      existingData.persistedDirectivesData,
      incomingData.directivesByDirectiveName,
      this.persistedDirectiveDefinitionByDirectiveName,
    );
    return existingData;
  }

  upsertParentDefinitionData(incomingData: ParentDefinitionData, subgraphName: string) {
    const entityInterfaceData = this.entityInterfaceFederationDataByTypeName.get(incomingData.name);
    const existingData = this.parentDefinitionDataByTypeName.get(incomingData.name);
    const targetData = this.getParentTargetData({ existingData, incomingData });
    this.recordTagNamesByCoords(targetData);
    const isParentInaccessible = isNodeDataInaccessible(targetData);
    if (isParentInaccessible) {
      this.inaccessibleCoords.add(targetData.name);
    }
    if (entityInterfaceData && entityInterfaceData.interfaceObjectSubgraphs.has(subgraphName)) {
      targetData.kind = Kind.INTERFACE_TYPE_DEFINITION;
      targetData.node.kind = Kind.INTERFACE_TYPE_DEFINITION;
    }
    if (!existingData) {
      this.parentDefinitionDataByTypeName.set(targetData.name, targetData);
      return;
    }
    if (targetData.kind !== incomingData.kind) {
      if (
        !entityInterfaceData ||
        !entityInterfaceData.interfaceObjectSubgraphs.has(subgraphName) ||
        targetData.kind !== Kind.INTERFACE_TYPE_DEFINITION ||
        incomingData.kind !== Kind.OBJECT_TYPE_DEFINITION
      ) {
        this.errors.push(
          incompatibleParentKindMergeError(
            targetData.name,
            kindToNodeType(targetData.kind),
            kindToNodeType(incomingData.kind),
          ),
        );
        return;
      }
    }
    addNewObjectValueMapEntries(
      incomingData.configureDescriptionDataBySubgraphName,
      targetData.configureDescriptionDataBySubgraphName,
    );
    setLongestDescription(targetData, incomingData);
    setParentDataExtensionType(targetData, incomingData);
    switch (targetData.kind) {
      case Kind.ENUM_TYPE_DEFINITION:
        if (!areKindsEqual(targetData, incomingData)) {
          return;
        }
        targetData.appearances += 1;
        targetData.isInaccessible ||= isParentInaccessible;
        addIterableValuesToSet(incomingData.subgraphNames, targetData.subgraphNames);
        for (const data of incomingData.enumValueDataByValueName.values()) {
          this.upsertEnumValueData(targetData.enumValueDataByValueName, data, isParentInaccessible);
        }
        return;
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
        if (!areKindsEqual(targetData, incomingData)) {
          return;
        }
        // targetData.isInaccessible currently yields the previous state not the new one.
        if (isParentInaccessible && !targetData.isInaccessible) {
          this.propagateInaccessibilityToExistingChildren(targetData);
        }
        targetData.isInaccessible ||= isParentInaccessible;
        addIterableValuesToSet(incomingData.subgraphNames, targetData.subgraphNames);
        for (const inputValueData of incomingData.inputValueDataByName.values()) {
          this.upsertInputValueData(
            targetData.inputValueDataByName,
            inputValueData,
            targetData.name,
            targetData.isInaccessible,
          );
        }
        return;
      case Kind.INTERFACE_TYPE_DEFINITION:
      // intentional fallthrough
      case Kind.OBJECT_TYPE_DEFINITION:
        // Not a type guard due to entity interfaces
        const compositeOutputData = incomingData as CompositeOutputData;
        // targetData.isInaccessible is not yet updated with the newest state
        if (isParentInaccessible && !targetData.isInaccessible) {
          this.propagateInaccessibilityToExistingChildren(targetData);
        }
        targetData.isInaccessible ||= isParentInaccessible;
        addIterableValuesToSet(
          compositeOutputData.implementedInterfaceTypeNames,
          targetData.implementedInterfaceTypeNames,
        );
        addIterableValuesToSet(compositeOutputData.subgraphNames, targetData.subgraphNames);
        for (const fieldData of compositeOutputData.fieldDataByName.values()) {
          this.upsertFieldData(targetData.fieldDataByName, fieldData, targetData.isInaccessible);
        }
        return;
      case Kind.UNION_TYPE_DEFINITION:
        if (!areKindsEqual(targetData, incomingData)) {
          return;
        }
        addMapEntries(incomingData.memberByMemberTypeName, targetData.memberByMemberTypeName);
        addIterableValuesToSet(incomingData.subgraphNames, targetData.subgraphNames);
        return;
      default:
        // Scalar
        addIterableValuesToSet(incomingData.subgraphNames, targetData.subgraphNames);
        return;
    }
  }

  propagateInaccessibilityToExistingChildren(
    data: InputObjectDefinitionData | InterfaceDefinitionData | ObjectDefinitionData,
  ) {
    switch (data.kind) {
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
        for (const inputFieldData of data.inputValueDataByName.values()) {
          this.inaccessibleCoords.add(inputFieldData.federatedCoords);
        }
        break;
      default:
        for (const fieldData of data.fieldDataByName.values()) {
          this.inaccessibleCoords.add(fieldData.federatedCoords);
          for (const inputValueData of fieldData.argumentDataByName.values()) {
            this.inaccessibleCoords.add(inputValueData.federatedCoords);
          }
        }
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
        this.namedInputValueTypeNames.add(inputValueData.namedTypeName);
        this.upsertInputValueData(argumentDataByArgumentName, inputValueData, `@${incomingData.name}`, false);
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
      this.upsertInputValueData(
        existingData.argumentDataByArgumentName,
        inputValueData,
        `@${existingData.name}`,
        false,
      );
    }
    setLongestDescription(existingData, incomingData);
    existingData.repeatable &&= incomingData.repeatable;
    addIterableValuesToSet(incomingData.subgraphNames, existingData.subgraphNames);
  }

  shouldUpdateFederatedFieldAbstractNamedType(abstractTypeName: string, objectTypeNames: Set<string>): boolean {
    if (!abstractTypeName) {
      return false;
    }
    const concreteTypeNames = this.concreteTypeNamesByAbstractTypeName.get(abstractTypeName);
    if (!concreteTypeNames || concreteTypeNames.size < 1) {
      return false;
    }
    for (const objectTypeName of objectTypeNames) {
      if (!concreteTypeNames.has(objectTypeName)) {
        return false;
      }
    }
    return true;
  }

  updateTypeNodeNamedType(typeNode: MutableTypeNode, namedTypeName: string) {
    let lastTypeNode = typeNode;
    for (let i = 0; i < MAXIMUM_TYPE_NESTING; i++) {
      if (lastTypeNode.kind === Kind.NAMED_TYPE) {
        lastTypeNode.name = stringToNameNode(namedTypeName);
        return;
      }
      lastTypeNode = lastTypeNode.type;
    }
  }

  handleDisparateFieldNamedTypes() {
    for (const [fieldCoordinates, subgraphNamesByNamedTypeName] of this.subgraphNamesByNamedTypeNameByFieldCoords) {
      const coordinates = fieldCoordinates.split(PERIOD);
      if (coordinates.length !== 2) {
        continue;
      }
      const compositeOutputData = this.parentDefinitionDataByTypeName.get(coordinates[0]);
      if (!compositeOutputData) {
        this.errors.push(undefinedTypeError(coordinates[0]));
        continue;
      }
      // This error should never happen
      if (
        compositeOutputData.kind !== Kind.INTERFACE_TYPE_DEFINITION &&
        compositeOutputData.kind !== Kind.OBJECT_TYPE_DEFINITION
      ) {
        this.errors.push(
          unexpectedNonCompositeOutputTypeError(coordinates[0], kindToNodeType(compositeOutputData.kind)),
        );
        continue;
      }
      const fieldData = compositeOutputData.fieldDataByName.get(coordinates[1]);
      // This error should never happen
      if (!fieldData) {
        this.errors.push(unknownFieldDataError(fieldCoordinates));
        continue;
      }
      const interfaceDataByTypeName = new Map<string, InterfaceDefinitionData>();
      const objectTypeNames = new Set<string>();
      let unionTypeName = '';
      for (const namedTypeName of subgraphNamesByNamedTypeName.keys()) {
        if (BASE_SCALARS.has(namedTypeName)) {
          this.errors.push(incompatibleFederatedFieldNamedTypeError(fieldCoordinates, subgraphNamesByNamedTypeName));
          break;
        }
        const namedTypeData = this.parentDefinitionDataByTypeName.get(namedTypeName);
        // This error should never happen
        if (!namedTypeData) {
          this.errors.push(unknownNamedTypeError(fieldCoordinates, namedTypeName));
          break;
        }
        switch (namedTypeData.kind) {
          case Kind.INTERFACE_TYPE_DEFINITION: {
            interfaceDataByTypeName.set(namedTypeData.name, namedTypeData);
            break;
          }
          case Kind.OBJECT_TYPE_DEFINITION: {
            objectTypeNames.add(namedTypeData.name);
            /* Multiple shared Field instances can explicitly return the same Object named type across subgraphs.
             * However, the Field is invalid if *any* of the other shared Field instances return a different Object named
             * type, even if each of those Objects named types could be coerced into the same mutual abstract type.
             * This is because it would be impossible to return identical data from each subgraph if one shared Field
             * instance explicitly returns a different Object named type to another shared Field instance.
             */
            if (objectTypeNames.size > 1) {
              this.errors.push(
                incompatibleFederatedFieldNamedTypeError(fieldCoordinates, subgraphNamesByNamedTypeName),
              );
              continue;
            }
            break;
          }
          case Kind.UNION_TYPE_DEFINITION: {
            if (unionTypeName) {
              this.errors.push(
                incompatibleFederatedFieldNamedTypeError(fieldCoordinates, subgraphNamesByNamedTypeName),
              );
              continue;
            }
            unionTypeName = namedTypeName;
            break;
          }
          default: {
            this.errors.push(incompatibleFederatedFieldNamedTypeError(fieldCoordinates, subgraphNamesByNamedTypeName));
            break;
          }
        }
      }
      if (interfaceDataByTypeName.size < 0 && !unionTypeName) {
        this.errors.push(incompatibleFederatedFieldNamedTypeError(fieldCoordinates, subgraphNamesByNamedTypeName));
        continue;
      }
      /* Default to the Union type name.
       * If more than one type of abstract type is returned, an error will be propagated.
       */
      let abstractTypeName = unionTypeName;
      if (interfaceDataByTypeName.size > 0) {
        if (unionTypeName) {
          this.errors.push(incompatibleFederatedFieldNamedTypeError(fieldCoordinates, subgraphNamesByNamedTypeName));
          continue;
        }
        /* If there is more than one Interface, there must be an origin Interface.
         * This is the "mutual Interface" that all the other Interfaces implement.
         */
        for (const interfaceTypeName of interfaceDataByTypeName.keys()) {
          abstractTypeName = interfaceTypeName;
          for (const [comparisonTypeName, comparisonData] of interfaceDataByTypeName) {
            if (interfaceTypeName === comparisonTypeName) {
              continue;
            }
            if (!comparisonData.implementedInterfaceTypeNames.has(interfaceTypeName)) {
              abstractTypeName = '';
              break;
            }
          }
          if (abstractTypeName) {
            break;
          }
        }
      }
      /* If the abstract type is:
       * 1. An Interface: each returned Object types must implement that origin Interface.
       * 2. A Union: all returned Object types must be Member of that Union.
       * 3. Invalid (empty string): return an error
       */
      if (!this.shouldUpdateFederatedFieldAbstractNamedType(abstractTypeName, objectTypeNames)) {
        this.errors.push(incompatibleFederatedFieldNamedTypeError(fieldCoordinates, subgraphNamesByNamedTypeName));
        continue;
      }
      fieldData.namedTypeName = abstractTypeName;
      this.updateTypeNodeNamedType(fieldData.type, abstractTypeName);
    }
  }

  /* federateInternalSubgraphData is responsible for merging each subgraph TypeScript representation of a GraphQL type
   * into a single representation.
   * This method is always necessary, regardless of whether federating a source graph or contract graph.
   * */
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
    this.handleDisparateFieldNamedTypes();
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
      const entityInterfaceFederationData = getOrThrowError(
        this.parentDefinitionDataByTypeName,
        entityInterfaceTypeName,
        PARENT_DEFINITION_DATA,
      );
      if (entityInterfaceFederationData.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        // TODO error
        continue;
      }
      for (const subgraphName of entityInterfaceData.interfaceObjectSubgraphs) {
        const internalSubgraph = getOrThrowError(
          this.internalSubgraphBySubgraphName,
          subgraphName,
          'internalSubgraphBySubgraphName',
        );
        const configurationDataByTypeName = internalSubgraph.configurationDataByTypeName;
        const concreteTypeNames = this.concreteTypeNamesByAbstractTypeName.get(entityInterfaceTypeName);
        if (!concreteTypeNames) {
          continue;
        }
        const interfaceObjectConfiguration = getOrThrowError(
          configurationDataByTypeName,
          entityInterfaceTypeName,
          'configurationDataByTypeName',
        );
        const keys = interfaceObjectConfiguration.keys;
        if (!keys) {
          // TODO no keys error
          continue;
        }
        interfaceObjectConfiguration.entityInterfaceConcreteTypeNames = new Set<TypeName>(
          entityInterfaceData.concreteTypeNames,
        );
        this.internalGraph.setSubgraphName(subgraphName);
        const interfaceObjectNode = this.internalGraph.addOrUpdateNode(entityInterfaceTypeName, { isAbstract: true });
        for (const concreteTypeName of concreteTypeNames) {
          const concreteTypeData = getOrThrowError(
            this.parentDefinitionDataByTypeName,
            concreteTypeName,
            PARENT_DEFINITION_DATA,
          );
          if (!isObjectDefinitionData(concreteTypeData)) {
            continue;
          }
          // The subgraph locations of the Interface Object must be added to the concrete types that implement it
          const entityData = getOrThrowError(this.entityDataByTypeName, concreteTypeName, 'entityDataByTypeName');
          entityData.subgraphNames.add(subgraphName);
          const configurationData = configurationDataByTypeName.get(concreteTypeName);
          if (configurationData) {
            addIterableValuesToSet(interfaceObjectConfiguration.fieldNames, configurationData.fieldNames);
            if (!configurationData.keys) {
              configurationData.keys = [...keys];
            } else {
              parentLoop: for (const key of keys) {
                for (const { selectionSet } of configurationData.keys) {
                  if (key.selectionSet === selectionSet) {
                    continue parentLoop;
                  }
                }
                configurationData.keys.push(key);
              }
            }
          } else {
            configurationDataByTypeName.set(concreteTypeName, {
              fieldNames: new Set<string>(interfaceObjectConfiguration.fieldNames),
              isRootNode: true,
              keys: [...keys],
              typeName: concreteTypeName,
            });
          }
          const resolvableKeyFieldSets = new Set<string>();
          for (const key of keys.filter((k) => !k.disableEntityResolver)) {
            resolvableKeyFieldSets.add(key.selectionSet);
          }
          const interfaceAuthData = this.authorizationDataByParentTypeName.get(entityInterfaceTypeName);
          const entityInterfaceSubgraphData = getOrThrowError(
            internalSubgraph.parentDefinitionDataByTypeName,
            entityInterfaceTypeName,
            'internalSubgraph.parentDefinitionDataByTypeName',
          );
          if (!isObjectDefinitionData(entityInterfaceSubgraphData)) {
            continue;
          }
          for (const [fieldName, fieldData] of entityInterfaceSubgraphData.fieldDataByName) {
            const fieldCoords = `${concreteTypeName}.${fieldName}`;
            getValueOrDefault(
              this.fieldCoordsByNamedTypeName,
              fieldData.namedTypeName,
              () => new Set<FieldCoords>(),
            ).add(fieldCoords);
            const interfaceFieldAuthData = interfaceAuthData?.fieldAuthDataByFieldName.get(fieldName);
            if (interfaceFieldAuthData) {
              const concreteAuthData = getValueOrDefault(this.authorizationDataByParentTypeName, concreteTypeName, () =>
                newAuthorizationData(concreteTypeName),
              );
              if (!upsertFieldAuthorizationData(concreteAuthData.fieldAuthDataByFieldName, interfaceFieldAuthData)) {
                this.invalidORScopesCoords.add(fieldCoords);
              }
            }
            const existingFieldData = concreteTypeData.fieldDataByName.get(fieldName);
            // @shareable and @external need to be propagated (e.g., to satisfy interfaces)
            if (existingFieldData) {
              const isShareable = fieldData.isShareableBySubgraphName.get(subgraphName) ?? false;
              existingFieldData.isShareableBySubgraphName.set(subgraphName, isShareable);
              existingFieldData.subgraphNames.add(subgraphName);
              const externalData = fieldData.externalFieldDataBySubgraphName.get(subgraphName);
              if (!externalData) {
                continue;
              }
              existingFieldData.externalFieldDataBySubgraphName.set(subgraphName, { ...externalData });
              continue;
            }
            const isInaccessible =
              entityInterfaceFederationData.isInaccessible ||
              concreteTypeData.isInaccessible ||
              fieldData.isInaccessible;
            concreteTypeData.fieldDataByName.set(fieldName, this.copyFieldData(fieldData, isInaccessible));
          }
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

  getValidFlattenedPersistedDirectiveNodeArray(
    directivesByDirectiveName: Map<string, Array<ConstDirectiveNode>>,
    coords: string,
  ): Array<ConstDirectiveNode> {
    const persistedDirectiveNodes: Array<ConstDirectiveNode> = [];
    for (const [directiveName, directiveNodes] of directivesByDirectiveName) {
      const persistedDirectiveDefinition = this.persistedDirectiveDefinitionByDirectiveName.get(directiveName);
      if (!persistedDirectiveDefinition) {
        continue;
      }
      if (directiveNodes.length < 2) {
        persistedDirectiveNodes.push(...directiveNodes);
        continue;
      }
      if (!persistedDirectiveDefinition.repeatable) {
        this.errors.push(invalidRepeatedFederatedDirectiveErrorMessage(directiveName, coords));
        continue;
      }
      persistedDirectiveNodes.push(...directiveNodes);
    }
    return persistedDirectiveNodes;
  }

  getRouterPersistedDirectiveNodes<T extends NodeData>(nodeData: T): ConstDirectiveNode[] {
    const persistedDirectiveNodes = [...nodeData.persistedDirectivesData.tagDirectiveByName.values()];
    if (nodeData.persistedDirectivesData.isDeprecated) {
      persistedDirectiveNodes.push(generateDeprecatedDirective(nodeData.persistedDirectivesData.deprecatedReason));
    }
    persistedDirectiveNodes.push(
      ...this.getValidFlattenedPersistedDirectiveNodeArray(
        nodeData.persistedDirectivesData.directivesByDirectiveName,
        nodeData.name,
      ),
    );
    return persistedDirectiveNodes;
  }

  getFederatedGraphNodeDescription(data: NodeData): StringValueNode | undefined {
    if (data.configureDescriptionDataBySubgraphName.size < 1) {
      return data.description;
    }
    const subgraphNames: Array<string> = [];
    let descriptionToPropagate = '';
    for (const [subgraphName, { propagate, description }] of data.configureDescriptionDataBySubgraphName) {
      if (!propagate) {
        continue;
      }
      subgraphNames.push(subgraphName);
      descriptionToPropagate = description;
    }
    if (subgraphNames.length === 1) {
      return getDescriptionFromString(descriptionToPropagate);
    }
    // If no instances define the configureDescription directive, return the longest description
    if (subgraphNames.length < 1) {
      return data.description;
    }
    this.errors.push(configureDescriptionPropagationError(getDefinitionDataCoords(data, true), subgraphNames));
  }

  getNodeForRouterSchemaByData<T extends NodeData>(data: T): T['node'] {
    data.node.name = stringToNameNode(data.name);
    data.node.description = this.getFederatedGraphNodeDescription(data);
    data.node.directives = this.getRouterPersistedDirectiveNodes(data);
    return data.node;
  }

  getNodeWithPersistedDirectivesByInputValueData(inputValueData: InputValueData): MutableInputValueNode {
    inputValueData.node.name = stringToNameNode(inputValueData.name);
    inputValueData.node.type = inputValueData.type;
    inputValueData.node.description = this.getFederatedGraphNodeDescription(inputValueData);
    inputValueData.node.directives = this.getRouterPersistedDirectiveNodes(inputValueData);
    if (inputValueData.includeDefaultValue) {
      inputValueData.node.defaultValue = inputValueData.defaultValue;
    }
    return inputValueData.node;
  }

  getValidFieldArgumentNodes(fieldData: FieldData): MutableInputValueNode[] {
    const argumentNodes: Array<MutableInputValueNode> = [];
    const argumentNames: Array<string> = [];
    const invalidRequiredArguments: InvalidRequiredInputValueData[] = [];
    const fieldPath = `${fieldData.renamedParentTypeName}.${fieldData.name}`;
    for (const [argumentName, inputValueData] of fieldData.argumentDataByName) {
      if (fieldData.subgraphNames.size === inputValueData.subgraphNames.size) {
        argumentNames.push(argumentName);
        argumentNodes.push(this.getNodeWithPersistedDirectivesByInputValueData(inputValueData));
      } else if (isTypeRequired(inputValueData.type)) {
        invalidRequiredArguments.push({
          inputValueName: argumentName,
          missingSubgraphs: getEntriesNotInHashSet(fieldData.subgraphNames, inputValueData.subgraphNames),
          requiredSubgraphs: [...inputValueData.requiredSubgraphNames],
        });
      }
    }
    if (invalidRequiredArguments.length > 0) {
      this.errors.push(invalidRequiredInputValueError(FIELD, fieldPath, invalidRequiredArguments));
    } else if (argumentNames.length > 0) {
      // fieldConfiguration might already exist through subscriptionFilter
      getValueOrDefault(this.fieldConfigurationByFieldCoords, fieldPath, () => ({
        argumentNames,
        fieldName: fieldData.name,
        typeName: fieldData.renamedParentTypeName,
      })).argumentNames = argumentNames;
    }
    return argumentNodes;
  }

  getNodeWithPersistedDirectivesByFieldData(
    fieldData: FieldData,
    argumentNodes: Array<MutableInputValueNode>,
  ): MutableFieldNode {
    fieldData.node.arguments = argumentNodes;
    fieldData.node.name = stringToNameNode(fieldData.name);
    fieldData.node.type = fieldData.type;
    fieldData.node.description = this.getFederatedGraphNodeDescription(fieldData);
    fieldData.node.directives = this.getRouterPersistedDirectiveNodes(fieldData);
    return fieldData.node;
  }

  pushParentDefinitionDataToDocumentDefinitions(interfaceImplementations: InterfaceImplementationData[]) {
    for (const [parentTypeName, parentDefinitionData] of this.parentDefinitionDataByTypeName) {
      if (parentDefinitionData.extensionType !== ExtensionType.NONE) {
        this.errors.push(noBaseDefinitionForExtensionError(kindToNodeType(parentDefinitionData.kind), parentTypeName));
      }
      switch (parentDefinitionData.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
          const enumValueNodes: Array<MutableEnumValueNode> = [];
          const clientEnumValueNodes: Array<MutableEnumValueNode> = [];
          const mergeMethod = this.getEnumValueMergeMethod(parentTypeName);
          propagateAuthDirectives(parentDefinitionData, this.authorizationDataByParentTypeName.get(parentTypeName));
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
          this.routerDefinitions.push(this.getNodeForRouterSchemaByData(parentDefinitionData));
          if (isNodeDataInaccessible(parentDefinitionData)) {
            this.validateReferencesOfInaccessibleType(parentDefinitionData);
            this.internalGraph.setNodeInaccessible(parentDefinitionData.name);
            break;
          }
          if (clientEnumValueNodes.length < 1) {
            this.errors.push(
              allChildDefinitionsAreInaccessibleError(
                kindToNodeType(parentDefinitionData.kind),
                parentTypeName,
                ENUM_VALUE,
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
          const invalidRequiredInputs: Array<InvalidRequiredInputValueData> = [];
          const inputValueNodes: Array<MutableInputValueNode> = [];
          const clientInputValueNodes: Array<MutableInputValueNode> = [];
          for (const [inputValueName, inputValueData] of parentDefinitionData.inputValueDataByName) {
            if (parentDefinitionData.subgraphNames.size === inputValueData.subgraphNames.size) {
              inputValueNodes.push(this.getNodeWithPersistedDirectivesByInputValueData(inputValueData));
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
          this.routerDefinitions.push(this.getNodeForRouterSchemaByData(parentDefinitionData));
          if (isNodeDataInaccessible(parentDefinitionData)) {
            this.validateReferencesOfInaccessibleType(parentDefinitionData);
            break;
          }
          if (clientInputValueNodes.length < 1) {
            this.errors.push(
              allChildDefinitionsAreInaccessibleError(
                kindToNodeType(parentDefinitionData.kind),
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
          const fieldNodes: Array<MutableFieldNode> = [];
          const clientSchemaFieldNodes: Array<MutableFieldNode> = [];
          const graphFieldDataByFieldName = new Map<string, GraphFieldData>();
          const invalidFieldNames = newInvalidFieldNames();
          const isObject = parentDefinitionData.kind === Kind.OBJECT_TYPE_DEFINITION;
          const authData = this.authorizationDataByParentTypeName.get(parentTypeName);
          propagateAuthDirectives(parentDefinitionData, authData);
          for (const [fieldName, fieldData] of parentDefinitionData.fieldDataByName) {
            propagateFieldAuthDirectives(fieldData, authData);
            const argumentNodes = this.getValidFieldArgumentNodes(fieldData);
            if (isObject) {
              validateExternalAndShareable(fieldData, invalidFieldNames);
            }
            fieldNodes.push(this.getNodeWithPersistedDirectivesByFieldData(fieldData, argumentNodes));
            if (isNodeDataInaccessible(fieldData)) {
              continue;
            }
            clientSchemaFieldNodes.push(getClientSchemaFieldNodeByFieldData(fieldData));
            graphFieldDataByFieldName.set(fieldName, this.fieldDataToGraphFieldData(fieldData));
          }
          if (isObject) {
            if (invalidFieldNames.byShareable.size > 0) {
              this.errors.push(invalidFieldShareabilityError(parentDefinitionData, invalidFieldNames.byShareable));
            }
            if (invalidFieldNames.subgraphNamesByExternalFieldName.size > 0) {
              this.errors.push(
                allExternalFieldInstancesError(parentTypeName, invalidFieldNames.subgraphNamesByExternalFieldName),
              );
            }
          }
          parentDefinitionData.node.fields = fieldNodes;
          this.internalGraph.initializeNode(parentTypeName, graphFieldDataByFieldName);
          // Implemented interfaces can only be validated after all fields are merged
          if (parentDefinitionData.implementedInterfaceTypeNames.size > 0) {
            interfaceImplementations.push({ data: parentDefinitionData, clientSchemaFieldNodes });
            break;
          }
          this.routerDefinitions.push(this.getNodeForRouterSchemaByData(parentDefinitionData));
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
              ? noQueryRootTypeError(false)
              : allChildDefinitionsAreInaccessibleError(
                  kindToNodeType(parentDefinitionData.kind),
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
          propagateAuthDirectives(parentDefinitionData, this.authorizationDataByParentTypeName.get(parentTypeName));
          this.routerDefinitions.push(this.getNodeForRouterSchemaByData(parentDefinitionData));
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
          this.routerDefinitions.push(this.getNodeForRouterSchemaByData(parentDefinitionData));
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

  pushNamedTypeAuthDataToFields() {
    for (const [typeName, namedTypeAuthData] of this.authorizationDataByParentTypeName) {
      if (!namedTypeAuthData.requiresAuthentication && namedTypeAuthData.requiredScopes.length < 1) {
        continue;
      }
      const fieldCoords = this.fieldCoordsByNamedTypeName.get(typeName);
      if (!fieldCoords) {
        continue;
      }
      for (const coords of fieldCoords) {
        // The coords should all be exactly <parentTypeName>.<fieldName>
        const segments = coords.split(PERIOD);
        switch (segments.length) {
          case 2: {
            const parentAuthData = getValueOrDefault(this.authorizationDataByParentTypeName, segments[0], () =>
              newAuthorizationData(segments[0]),
            );
            const fieldAuthData = getValueOrDefault(parentAuthData.fieldAuthDataByFieldName, segments[1], () =>
              newFieldAuthorizationData(segments[1]),
            );
            fieldAuthData.inheritedData.requiresAuthentication ||= namedTypeAuthData.requiresAuthentication;
            if (
              fieldAuthData.inheritedData.requiredScopes.length * namedTypeAuthData.requiredScopes.length >
              MAX_OR_SCOPES
            ) {
              this.invalidORScopesCoords.add(coords);
            } else {
              fieldAuthData.inheritedData.requiredScopesByOR = mergeRequiredScopesByAND(
                fieldAuthData.inheritedData.requiredScopesByOR,
                namedTypeAuthData.requiredScopesByOR,
              );
              fieldAuthData.inheritedData.requiredScopes = mergeRequiredScopesByAND(
                fieldAuthData.inheritedData.requiredScopes,
                namedTypeAuthData.requiredScopes,
              );
            }
            break;
          }
          default: {
            break;
          }
        }
      }
    }
  }

  federateSubgraphData() {
    this.federateInternalSubgraphData();
    this.handleEntityInterfaces();
    // generate the map of tag data that is used by contracts
    this.generateTagData();
    this.pushVersionTwoDirectiveDefinitionsToDocumentDefinitions();
    // The named type auth data can only be pushed to the field once it has all been consolidated
    this.pushNamedTypeAuthDataToFields();
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
        if (!this.inaccessibleCoords.has(interfaceTypeName)) {
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
    this.clientDefinitions = [DEPRECATED_DEFINITION];
  }

  validatePathSegmentInaccessibility(path: string): boolean {
    if (!path) {
      return false;
    }
    const coordinates = path.split(LEFT_PARENTHESIS)[0];
    const segments = coordinates.split(PERIOD);
    let segment = segments[0];
    for (let i = 0; i < segments.length; i++) {
      if (this.inaccessibleCoords.has(segment)) {
        return true;
      }
      segment += `.${segments[i + 1]}`;
    }
    return false;
  }

  validateReferencesOfInaccessibleType(data: ParentDefinitionData) {
    const allCoords = this.coordsByNamedTypeName.get(data.name);
    if (!allCoords || allCoords.size < 1) {
      return;
    }
    const invalidCoords: Array<string> = [];
    for (const coords of allCoords) {
      if (this.inaccessibleCoords.has(coords)) {
        continue;
      }
      if (!this.validatePathSegmentInaccessibility(coords)) {
        invalidCoords.push(coords);
      }
    }
    if (invalidCoords.length > 0) {
      this.errors.push(invalidReferencesOfInaccessibleTypeError(kindToNodeType(data.kind), data.name, invalidCoords));
    }
  }

  validateQueryRootType() {
    const query = this.parentDefinitionDataByTypeName.get(QUERY);
    if (!query || query.kind !== Kind.OBJECT_TYPE_DEFINITION || query.fieldDataByName.size < 1) {
      this.errors.push(noQueryRootTypeError());
      return;
    }
    for (const fieldData of query.fieldDataByName.values()) {
      if (!isNodeDataInaccessible(fieldData)) {
        return;
      }
    }
    this.errors.push(noQueryRootTypeError());
  }

  validateSubscriptionFieldConditionFieldPath(
    conditionFieldPath: string,
    objectData: ObjectDefinitionData,
    inputFieldPath: string,
    directiveSubgraphName: string,
    fieldErrorMessages: Array<string>,
  ): string[] {
    const paths = conditionFieldPath.split(PERIOD);
    if (paths.length < 1) {
      fieldErrorMessages.push(
        invalidSubscriptionFieldConditionFieldPathErrorMessage(inputFieldPath, conditionFieldPath),
      );
      return [];
    }
    let lastData: ParentDefinitionData = objectData;
    if (this.inaccessibleCoords.has(lastData.renamedTypeName)) {
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
      const fieldData: FieldData | undefined = lastData.fieldDataByName.get(fieldName);
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
      if (this.inaccessibleCoords.has(fieldPath)) {
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
          kindToNodeType(lastData.kind),
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
              invalidInputFieldTypeErrorMessage(inputFieldPath, STRING, kindToNodeType(objectFieldNode.value.kind)),
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
              invalidInputFieldTypeErrorMessage(inputFieldPath, LIST, kindToNodeType(objectFieldNode.value.kind)),
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
            kindToNodeType(objectFieldNode.value.kind),
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
            OBJECT,
            kindToNodeType(argumentNode.value.kind),
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
    getValueOrDefault(this.fieldConfigurationByFieldCoords, fieldPath, () => ({
      argumentNames: [],
      fieldName,
      typeName: parentTypeName,
    })).subscriptionFilterCondition = condition;
  }

  validateSubscriptionFiltersAndGenerateConfiguration() {
    for (const [fieldPath, data] of this.subscriptionFilterDataByFieldPath) {
      if (this.inaccessibleCoords.has(fieldPath)) {
        continue;
      }

      const namedTypeData = this.parentDefinitionDataByTypeName.get(data.fieldData.namedTypeName);

      /* An undefined namedTypeData should be impossible.
       * If the type were unknown, it would have resulted in an earlier normalization error.
       */
      if (!namedTypeData) {
        this.errors.push(
          invalidSubscriptionFilterDirectiveError(fieldPath, [
            subscriptionFilterNamedTypeErrorMessage(data.fieldData.namedTypeName),
          ]),
        );
        continue;
      }

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

  buildFederationResult(): FederationResult {
    if (this.subscriptionFilterDataByFieldPath.size > 0) {
      this.validateSubscriptionFiltersAndGenerateConfiguration();
    }
    if (this.invalidORScopesCoords.size > 0) {
      this.errors.push(orScopesLimitError(MAX_OR_SCOPES, [...this.invalidORScopesCoords]));
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
    /*
     * If an input value (field or argument) is declared @inaccessible but its parent is not, it is an error.
     * However, this state can only be known after all subgraphs have been federated.
     */
    for (const err of this.inaccessibleRequiredInputValueErrorByCoords.values()) {
      this.errors.push(err);
    }
    // Return any composition errors before checking whether all fields are resolvable
    if (this.errors.length > 0) {
      return { errors: this.errors, success: false, warnings: this.warnings };
    }
    /* Resolvability evaluations are not necessary for contracts because the source graph resolvability evaluations
     * must have already completed without error.
     * Resolvability evaluations are also unnecessary for a single subgraph.
     *
     * These checks can be disabled by setting `disableResolvabilityValidation` to true.
     * This should only be done for troubleshooting purposes.
     * */
    if (!this.disableResolvabilityValidation && this.internalSubgraphBySubgraphName.size > 1) {
      const resolvabilityErrors = this.internalGraph.validate();
      if (resolvabilityErrors.length > 0) {
        return { errors: resolvabilityErrors, success: false, warnings: this.warnings };
      }
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
        configurationDataByTypeName: subgraph.configurationDataByTypeName,
        isVersionTwo: subgraph.isVersionTwo,
        parentDefinitionDataByTypeName: subgraph.parentDefinitionDataByTypeName,
        schema: subgraph.schema,
      });
    }
    for (const authorizationData of this.authorizationDataByParentTypeName.values()) {
      upsertAuthorizationConfiguration(this.fieldConfigurationByFieldCoords, authorizationData);
    }
    return {
      fieldConfigurations: Array.from(this.fieldConfigurationByFieldCoords.values()),
      subgraphConfigBySubgraphName,
      federatedGraphAST: newRouterAST,
      federatedGraphSchema: buildASTSchema(newRouterAST, { assumeValid: true, assumeValidSDL: true }),
      federatedGraphClientSchema: newClientSchema,
      parentDefinitionDataByTypeName: this.parentDefinitionDataByTypeName,
      success: true,
      warnings: this.warnings,
      ...this.getClientSchemaObjectBoolean(),
    };
  }

  getClientSchemaObjectBoolean() {
    // If the schema does not implement @tag nor @inaccessible, an empty object will be spread
    if (this.inaccessibleCoords.size < 1 && this.tagNamesByCoords.size < 1) {
      return {};
    }
    // otherwise, the object is spread in as true
    return { shouldIncludeClientSchema: true };
  }

  handleChildTagExclusions(
    parentDefinitionData: ParentDefinitionData,
    children: Map<string, ChildData>,
    childTagDataByChildName: Map<string, ChildTagData>,
    tagNames: Set<string>,
  ) {
    let accessibleChildren = children.size;
    for (const [childName, childTagData] of childTagDataByChildName) {
      const childData = getOrThrowError(children, childName, `${parentDefinitionData.name}.childDataByChildName`);
      if (isNodeDataInaccessible(childData)) {
        accessibleChildren -= 1;
        continue;
      }
      if (!tagNames.isDisjointFrom(childTagData.tagNames)) {
        getValueOrDefault(childData.persistedDirectivesData.directivesByDirectiveName, INACCESSIBLE, () => [
          generateSimpleDirective(INACCESSIBLE),
        ]);
        this.inaccessibleCoords.add(`${parentDefinitionData.name}.${childName}`);
        accessibleChildren -= 1;
      }
    }
    if (accessibleChildren < 1) {
      parentDefinitionData.persistedDirectivesData.directivesByDirectiveName.set(INACCESSIBLE, [
        generateSimpleDirective(INACCESSIBLE),
      ]);
      this.inaccessibleCoords.add(parentDefinitionData.name);
    }
  }

  handleChildTagInclusions(
    parentDefinitionData: ParentDefinitionData,
    children: Map<string, ChildData>,
    childTagDataByChildName: Map<string, ChildTagData>,
    tagNames: Set<string>,
  ) {
    let accessibleChildren = children.size;
    for (const [childName, childData] of children) {
      if (isNodeDataInaccessible(childData)) {
        accessibleChildren -= 1;
        continue;
      }
      const childTagData = childTagDataByChildName.get(childName);
      if (!childTagData || tagNames.isDisjointFrom(childTagData.tagNames)) {
        getValueOrDefault(childData.persistedDirectivesData.directivesByDirectiveName, INACCESSIBLE, () => [
          generateSimpleDirective(INACCESSIBLE),
        ]);
        this.inaccessibleCoords.add(`${parentDefinitionData.name}.${childName}`);
        accessibleChildren -= 1;
      }
    }
    if (accessibleChildren < 1) {
      parentDefinitionData.persistedDirectivesData.directivesByDirectiveName.set(INACCESSIBLE, [
        generateSimpleDirective(INACCESSIBLE),
      ]);
      this.inaccessibleCoords.add(parentDefinitionData.name);
    }
  }

  buildFederationContractResult(contractTagOptions: ContractTagOptions): FederationResult {
    if (!this.isVersionTwo) {
      /* If all the subgraphs are version one, the @inaccessible directive won't be present.
       ** However, contracts require @inaccessible to exclude applicable tagged types. */
      this.routerDefinitions.push(INACCESSIBLE_DEFINITION);
    }
    if (contractTagOptions.tagNamesToExclude.size > 0) {
      for (const [parentTypeName, parentTagData] of this.parentTagDataByTypeName) {
        const parentDefinitionData = getOrThrowError(
          this.parentDefinitionDataByTypeName,
          parentTypeName,
          PARENT_DEFINITION_DATA,
        );
        if (isNodeDataInaccessible(parentDefinitionData)) {
          continue;
        }
        if (!contractTagOptions.tagNamesToExclude.isDisjointFrom(parentTagData.tagNames)) {
          parentDefinitionData.persistedDirectivesData.directivesByDirectiveName.set(INACCESSIBLE, [
            generateSimpleDirective(INACCESSIBLE),
          ]);
          this.inaccessibleCoords.add(parentTypeName);
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
            this.handleChildTagExclusions(
              parentDefinitionData,
              parentDefinitionData.enumValueDataByValueName,
              parentTagData.childTagDataByChildName,
              contractTagOptions.tagNamesToExclude,
            );
            break;
          case Kind.INPUT_OBJECT_TYPE_DEFINITION:
            this.handleChildTagExclusions(
              parentDefinitionData,
              parentDefinitionData.inputValueDataByName,
              parentTagData.childTagDataByChildName,
              contractTagOptions.tagNamesToExclude,
            );
            break;
          default:
            let accessibleFields = parentDefinitionData.fieldDataByName.size;
            for (const [fieldName, childTagData] of parentTagData.childTagDataByChildName) {
              const fieldData = getOrThrowError(
                parentDefinitionData.fieldDataByName,
                fieldName,
                `${parentTypeName}.fieldDataByFieldName`,
              );
              if (isNodeDataInaccessible(fieldData)) {
                accessibleFields -= 1;
                continue;
              }
              if (!contractTagOptions.tagNamesToExclude.isDisjointFrom(childTagData.tagNames)) {
                getValueOrDefault(fieldData.persistedDirectivesData.directivesByDirectiveName, INACCESSIBLE, () => [
                  generateSimpleDirective(INACCESSIBLE),
                ]);
                this.inaccessibleCoords.add(fieldData.federatedCoords);
                accessibleFields -= 1;
                continue;
              }
              for (const [argumentName, tagNames] of childTagData.tagNamesByArgumentName) {
                const inputValueData = getOrThrowError(
                  fieldData.argumentDataByName,
                  argumentName,
                  `${fieldName}.argumentDataByArgumentName`,
                );
                if (isNodeDataInaccessible(inputValueData)) {
                  continue;
                }
                if (!tagNames.isDisjointFrom(tagNames)) {
                  getValueOrDefault(
                    inputValueData.persistedDirectivesData.directivesByDirectiveName,
                    INACCESSIBLE,
                    () => [generateSimpleDirective(INACCESSIBLE)],
                  );
                  this.inaccessibleCoords.add(inputValueData.federatedCoords);
                }
              }
            }
            if (accessibleFields < 1) {
              parentDefinitionData.persistedDirectivesData.directivesByDirectiveName.set(INACCESSIBLE, [
                generateSimpleDirective(INACCESSIBLE),
              ]);
              this.inaccessibleCoords.add(parentTypeName);
            }
        }
      }
    } else if (contractTagOptions.tagNamesToInclude.size > 0) {
      for (const [parentTypeName, parentDefinitionData] of this.parentDefinitionDataByTypeName) {
        if (isNodeDataInaccessible(parentDefinitionData)) {
          continue;
        }
        const parentTagData = this.parentTagDataByTypeName.get(parentTypeName);
        if (!parentTagData) {
          parentDefinitionData.persistedDirectivesData.directivesByDirectiveName.set(INACCESSIBLE, [
            generateSimpleDirective(INACCESSIBLE),
          ]);
          this.inaccessibleCoords.add(parentTypeName);
          // If the parent is inaccessible, there is no need to assess further
          continue;
        }
        if (!contractTagOptions.tagNamesToInclude.isDisjointFrom(parentTagData.tagNames)) {
          continue;
        }
        if (parentTagData.childTagDataByChildName.size < 1) {
          parentDefinitionData.persistedDirectivesData.directivesByDirectiveName.set(INACCESSIBLE, [
            generateSimpleDirective(INACCESSIBLE),
          ]);
          this.inaccessibleCoords.add(parentTypeName);
          // If the parent is inaccessible, there is no need to assess further
          continue;
        }
        switch (parentDefinitionData.kind) {
          case Kind.SCALAR_TYPE_DEFINITION:
          // intentional fallthrough
          case Kind.UNION_TYPE_DEFINITION:
            continue;
          case Kind.ENUM_TYPE_DEFINITION:
            this.handleChildTagInclusions(
              parentDefinitionData,
              parentDefinitionData.enumValueDataByValueName,
              parentTagData.childTagDataByChildName,
              contractTagOptions.tagNamesToInclude,
            );
            break;
          case Kind.INPUT_OBJECT_TYPE_DEFINITION:
            this.handleChildTagInclusions(
              parentDefinitionData,
              parentDefinitionData.inputValueDataByName,
              parentTagData.childTagDataByChildName,
              contractTagOptions.tagNamesToInclude,
            );
            break;
          default:
            let accessibleFields = parentDefinitionData.fieldDataByName.size;
            for (const [fieldName, fieldData] of parentDefinitionData.fieldDataByName) {
              if (isNodeDataInaccessible(fieldData)) {
                accessibleFields -= 1;
                continue;
              }
              const childTagData = parentTagData.childTagDataByChildName.get(fieldName);
              if (!childTagData || contractTagOptions.tagNamesToInclude.isDisjointFrom(childTagData.tagNames)) {
                getValueOrDefault(fieldData.persistedDirectivesData.directivesByDirectiveName, INACCESSIBLE, () => [
                  generateSimpleDirective(INACCESSIBLE),
                ]);
                this.inaccessibleCoords.add(fieldData.federatedCoords);
                accessibleFields -= 1;
              }
            }
            if (accessibleFields < 1) {
              parentDefinitionData.persistedDirectivesData.directivesByDirectiveName.set(INACCESSIBLE, [
                generateSimpleDirective(INACCESSIBLE),
              ]);
              this.inaccessibleCoords.add(parentTypeName);
            }
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
    if (this.errors.length > 0) {
      return { errors: this.errors, success: false, warnings: this.warnings };
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
        configurationDataByTypeName: subgraph.configurationDataByTypeName,
        isVersionTwo: subgraph.isVersionTwo,
        parentDefinitionDataByTypeName: subgraph.parentDefinitionDataByTypeName,
        schema: subgraph.schema,
      });
    }
    for (const authorizationData of this.authorizationDataByParentTypeName.values()) {
      upsertAuthorizationConfiguration(this.fieldConfigurationByFieldCoords, authorizationData);
    }
    return {
      fieldConfigurations: Array.from(this.fieldConfigurationByFieldCoords.values()),
      subgraphConfigBySubgraphName,
      federatedGraphAST: newRouterAST,
      federatedGraphSchema: buildASTSchema(newRouterAST, { assumeValid: true, assumeValidSDL: true }),
      federatedGraphClientSchema: newClientSchema,
      parentDefinitionDataByTypeName: this.parentDefinitionDataByTypeName,
      success: true,
      warnings: this.warnings,
      ...this.getClientSchemaObjectBoolean(),
    };
  }

  federateSubgraphsInternal(): FederationResult {
    this.federateSubgraphData();
    return this.buildFederationResult();
  }
}

type FederationFactoryResultSuccess = {
  federationFactory: FederationFactory;
  success: true;
  warnings: Array<Warning>;
};

type FederationFactoryResultFailure = {
  errors: Array<Error>;
  success: false;
  warnings: Array<Warning>;
};

type FederationFactoryResult = FederationFactoryResultFailure | FederationFactoryResultSuccess;

function initializeFederationFactory({
  disableResolvabilityValidation,
  subgraphs,
}: FederationParams): FederationFactoryResult {
  if (subgraphs.length < 1) {
    return { errors: [minimumSubgraphRequirementError], success: false, warnings: [] };
  }
  const result = batchNormalize(subgraphs);
  if (!result.success) {
    return { errors: result.errors, success: false, warnings: result.warnings };
  }
  const entityInterfaceFederationDataByTypeName = new Map<string, EntityInterfaceFederationData>();
  const invalidEntityInterfacesByTypeName = new Map<string, Array<InvalidEntityInterface>>();
  for (const [subgraphName, internalSubgraph] of result.internalSubgraphBySubgraphName) {
    for (const [typeName, entityInterfaceData] of internalSubgraph.entityInterfaces) {
      const existingData = entityInterfaceFederationDataByTypeName.get(typeName);
      if (!existingData) {
        entityInterfaceFederationDataByTypeName.set(
          typeName,
          newEntityInterfaceFederationData(entityInterfaceData, subgraphName),
        );
        continue;
      }
      upsertEntityInterfaceFederationData(existingData, entityInterfaceData, subgraphName);
    }
  }
  const entityInterfaceErrors = new Array<Error>();
  const definedConcreteTypeNamesBySubgraphName = new Map<SubgraphName, Set<TypeName>>();
  for (const [typeName, entityInterfaceData] of entityInterfaceFederationDataByTypeName) {
    const implementations = entityInterfaceData.concreteTypeNames.size;
    for (const [subgraphName, subgraphData] of entityInterfaceData.subgraphDataByTypeName) {
      const definedConcreteTypeNames = getValueOrDefault(
        definedConcreteTypeNamesBySubgraphName,
        subgraphName,
        () => new Set<TypeName>(),
      );
      addIterableValuesToSet(subgraphData.concreteTypeNames, definedConcreteTypeNames);
      if (!subgraphData.isInterfaceObject) {
        if (subgraphData.resolvable && subgraphData.concreteTypeNames.size !== implementations) {
          getValueOrDefault(
            invalidEntityInterfacesByTypeName,
            typeName,
            () => new Array<InvalidEntityInterface>(),
          ).push({
            subgraphName,
            definedConcreteTypeNames: new Set<TypeName>(subgraphData.concreteTypeNames),
            requiredConcreteTypeNames: new Set<TypeName>(entityInterfaceData.concreteTypeNames),
          });
        }
        continue;
      }
      addIterableValuesToSet(entityInterfaceData.concreteTypeNames, definedConcreteTypeNames);
      const { parentDefinitionDataByTypeName } = getOrThrowError(
        result.internalSubgraphBySubgraphName,
        subgraphName,
        'internalSubgraphBySubgraphName',
      );
      const invalidTypeNames: Array<string> = [];
      for (const concreteTypeName of entityInterfaceData.concreteTypeNames) {
        if (parentDefinitionDataByTypeName.has(concreteTypeName)) {
          invalidTypeNames.push(concreteTypeName);
        }
      }
      if (invalidTypeNames.length > 0) {
        entityInterfaceErrors.push(
          invalidInterfaceObjectImplementationDefinitionsError(typeName, subgraphName, invalidTypeNames),
        );
      }
    }
  }
  for (const [typeName, invalidInterfaces] of invalidEntityInterfacesByTypeName) {
    const checkedInvalidInterfaces = new Array<InvalidEntityInterface>();
    for (const invalidInterface of invalidInterfaces) {
      const validTypeNames = definedConcreteTypeNamesBySubgraphName.get(invalidInterface.subgraphName);
      if (!validTypeNames) {
        checkedInvalidInterfaces.push(invalidInterface);
        continue;
      }
      const definedTypeNames = invalidInterface.requiredConcreteTypeNames.intersection(validTypeNames);
      if (invalidInterface.requiredConcreteTypeNames.size !== definedTypeNames.size) {
        invalidInterface.definedConcreteTypeNames = definedTypeNames;
        checkedInvalidInterfaces.push(invalidInterface);
      }
    }
    if (checkedInvalidInterfaces.length > 0) {
      invalidEntityInterfacesByTypeName.set(typeName, checkedInvalidInterfaces);
      continue;
    }
    invalidEntityInterfacesByTypeName.delete(typeName);
  }
  if (invalidEntityInterfacesByTypeName.size > 0) {
    entityInterfaceErrors.push(
      undefinedEntityInterfaceImplementationsError(
        invalidEntityInterfacesByTypeName,
        entityInterfaceFederationDataByTypeName,
      ),
    );
  }
  if (entityInterfaceErrors.length > 0) {
    return {
      errors: entityInterfaceErrors,
      success: false,
      warnings: result.warnings,
    };
  }
  return {
    federationFactory: new FederationFactory({
      authorizationDataByParentTypeName: result.authorizationDataByParentTypeName,
      concreteTypeNamesByAbstractTypeName: result.concreteTypeNamesByAbstractTypeName,
      disableResolvabilityValidation,
      entityDataByTypeName: result.entityDataByTypeName,
      entityInterfaceFederationDataByTypeName,
      fieldCoordsByNamedTypeName: result.fieldCoordsByNamedTypeName,
      internalSubgraphBySubgraphName: result.internalSubgraphBySubgraphName,
      internalGraph: result.internalGraph,
      warnings: result.warnings,
    }),
    success: true,
    warnings: result.warnings,
  };
}

export function federateSubgraphs({ disableResolvabilityValidation, subgraphs }: FederationParams): FederationResult {
  const federationFactoryResult = initializeFederationFactory({ subgraphs, disableResolvabilityValidation });
  if (!federationFactoryResult.success) {
    return { errors: federationFactoryResult.errors, success: false, warnings: federationFactoryResult.warnings };
  }
  return federationFactoryResult.federationFactory.federateSubgraphsInternal();
}

// the flow when publishing a subgraph that also has contracts
export function federateSubgraphsWithContracts({
  subgraphs,
  tagOptionsByContractName,
  disableResolvabilityValidation,
}: FederateSubgraphsWithContractsV1Params): FederationResultWithContracts {
  const factoryResult = initializeFederationFactory({ subgraphs, disableResolvabilityValidation });
  if (!factoryResult.success) {
    return {
      errors: factoryResult.errors,
      success: false,
      warnings: factoryResult.warnings,
    };
  }
  factoryResult.federationFactory.federateSubgraphData();
  const federationFactories = [cloneDeep(factoryResult.federationFactory)];
  const federationResult = factoryResult.federationFactory.buildFederationResult();
  // if the base graph fails composition, no contracts will be attempted
  if (!federationResult.success) {
    return { errors: federationResult.errors, success: false, warnings: federationResult.warnings };
  }
  const lastContractIndex = tagOptionsByContractName.size - 1;
  const federationResultByContractName = new Map<ContractName, FederationResult>();
  let i = 0;
  for (const [contractName, tagOptions] of tagOptionsByContractName) {
    // deep copy the current FederationFactory before it is mutated if it is not the last one required
    if (i !== lastContractIndex) {
      federationFactories.push(cloneDeep(federationFactories[i]));
    }
    // note that any one contract could have its own errors
    const contractResult = federationFactories[i].buildFederationContractResult(tagOptions);
    federationResultByContractName.set(contractName, contractResult);
    i++;
  }
  return { ...federationResult, federationResultByContractName };
}

// the flow when adding a completely new contract
export function federateSubgraphsContract({
  contractTagOptions,
  disableResolvabilityValidation,
  subgraphs,
}: FederateSubgraphsContractV1Params): FederationResult {
  const result = initializeFederationFactory({ subgraphs, disableResolvabilityValidation });
  if (!result.success) {
    return { errors: result.errors, success: false, warnings: result.warnings };
  }
  result.federationFactory.federateSubgraphData();
  return result.federationFactory.buildFederationContractResult(contractTagOptions);
}
