import { MultiGraph } from 'graphology';
import {
  BREAK,
  buildASTSchema,
  DirectiveDefinitionNode,
  DocumentNode,
  GraphQLSchema,
  Kind,
  NamedTypeNode,
  visit,
} from 'graphql';
import {
  getTypeNodeNamedTypeName,
  MutableEnumValueNode,
  MutableFieldNode,
  MutableInputValueNode,
  MutableTypeDefinitionNode,
} from '../schema-building/ast';
import { isKindAbstract, safeParse, stringToNamedTypeNode, stringToNameNode } from '../ast/utils';
import {
  allChildDefinitionsAreInaccessibleError,
  federationFactoryInitializationFatalError,
  fieldTypeMergeFatalError,
  inaccessibleQueryRootTypeError,
  inaccessibleRequiredArgumentError,
  incompatibleArgumentTypesError,
  incompatibleChildTypesError,
  incompatibleObjectExtensionOrphanBaseTypeError,
  incompatibleParentKindFatalError,
  incompatibleParentKindMergeError,
  incompatibleSharedEnumError,
  invalidFieldShareabilityError,
  invalidImplementedTypeError,
  invalidInterfaceImplementationError,
  invalidReferencesOfInaccessibleTypeError,
  invalidRequiredInputValueError,
  minimumSubgraphRequirementError,
  noBaseTypeExtensionError,
  noConcreteTypesForAbstractTypeError,
  noQueryRootTypeError,
  orScopesLimitError,
  undefinedEntityInterfaceImplementationsError,
  unexpectedObjectResponseType,
  unexpectedParentKindErrorMessage,
  unresolvableFieldError,
} from '../errors/errors';
import {
  FederationResultContainer,
  FederationResultContainerWithContracts,
  InterfaceImplementationData,
  newChildTagData,
  newParentTagData,
  ParentTagData,
  RootTypeFieldData,
} from './utils';
import { InternalSubgraph, Subgraph, SubgraphConfig } from '../subgraph/subgraph';
import {
  AUTHENTICATED,
  DEPRECATED,
  ENTITIES,
  FIELD,
  INACCESSIBLE,
  INPUT_OBJECT,
  PARENT_DEFINITION_DATA,
  QUERY,
  REQUIRES_SCOPES,
  ROOT_TYPES,
  SELECTION_REPRESENTATION,
  TAG,
  UNION,
} from '../utils/string-constants';
import {
  addIterableValuesToSet,
  addMapEntries,
  AuthorizationData,
  doSetsHaveAnyOverlap,
  EntityData,
  EntityDataByTypeName,
  EntityInterfaceFederationData,
  generateSimpleDirective,
  getAllMutualEntries,
  getEntriesNotInHashSet,
  getOrThrowError,
  getValueOrDefault,
  hasSimplePath,
  ImplementationErrors,
  InvalidEntityInterface,
  InvalidFieldImplementation,
  InvalidRequiredInputValueData,
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
  EnumDefinitionData,
  EnumValueData,
  FieldData,
  InputObjectDefinitionData,
  InputValueData,
  InterfaceDefinitionData,
  ObjectDefinitionData,
  ParentDefinitionData,
  ParentWithFieldsData,
  PersistedDirectiveDefinitionData,
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
  getValidFieldArgumentNodes,
  isFieldExternalInAllMutualSubgraphs,
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

import { createMultiGraphAndRenameRootTypes } from './walkers';
import { cloneDeep } from 'lodash';
import { getLeastRestrictiveMergedTypeNode, getMostRestrictiveMergedTypeNode } from '../schema-building/type-merging';

export class FederationFactory {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  clientDefinitions: MutableTypeDefinitionNode[] = [DEPRECATED_DEFINITION];
  currentSubgraphName = '';
  entityDataByTypeName: Map<string, EntityData>;
  entityInterfaceFederationDataByTypeName: Map<string, EntityInterfaceFederationData>;
  errors: Error[] = [];
  evaluatedObjectLikesBySubgraph = new Map<string, Set<string>>();
  fieldConfigurationByFieldPath = new Map<string, FieldConfiguration>();
  graph: MultiGraph;
  graphEdges = new Set<string>();
  graphPaths = new Map<string, boolean>();
  inaccessiblePaths = new Set<string>();
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
  tagNamesByPath = new Map<string, Set<string>>();
  warnings: string[];

  constructor(
    authorizationDataByParentTypeName: Map<string, AuthorizationData>,
    concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>,
    entityContainersByTypeName: EntityDataByTypeName,
    entityInterfaceFederationDataByTypeName: Map<string, EntityInterfaceFederationData>,
    graph: MultiGraph,
    internalSubgraphBySubgraphName: Map<string, InternalSubgraph>,
    warnings?: string[],
  ) {
    this.authorizationDataByParentTypeName = authorizationDataByParentTypeName;
    this.concreteTypeNamesByAbstractTypeName = concreteTypeNamesByAbstractTypeName;
    this.entityDataByTypeName = entityContainersByTypeName;
    this.entityInterfaceFederationDataByTypeName = entityInterfaceFederationDataByTypeName;
    this.graph = graph;
    this.internalSubgraphBySubgraphName = internalSubgraphBySubgraphName;
    this.warnings = warnings || [];
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
          getOrThrowError(this.entityDataByTypeName, entityAncestorName, ENTITIES).subgraphNames,
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
      const entityObjectData = getOrThrowError(
        this.parentDefinitionDataByTypeName,
        entityAncestorTypeName,
        'parentDefinitionDataByTypeName',
      ) as ObjectDefinitionData;
      const mutualEntityAncestorRootTypeFieldSubgraphs = getAllMutualEntries(
        rootTypeFieldSubgraphs,
        entityObjectData.subgraphNames,
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
      const fieldPath = `${fieldData.renamedParentTypeName}.${fieldName}`;
      if (this.inaccessiblePaths.has(fieldPath)) {
        continue;
      }
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
      const entity = this.entityDataByTypeName.get(namedFieldTypeName);
      if (isFieldResolvable) {
        // The base scalars are not in this.parentMap
        if (BASE_SCALARS.has(namedFieldTypeName)) {
          continue;
        }
        const namedTypeData = getOrThrowError(
          this.parentDefinitionDataByTypeName,
          namedFieldTypeName,
          PARENT_DEFINITION_DATA,
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
      const entity = this.entityDataByTypeName.get(concreteTypeName);
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
      'internalSubgraph.configurationDataMap',
    );
    const keyFieldNames = new Set<string>();
    const implicitKeys: RequiredFieldConfiguration[] = [];
    // Any errors in the field sets would be caught when evaluating the explicit entities, so they are ignored here
    for (const fieldSet of entityData.keyFieldSets) {
      // Create a new selection set so that the value can be parsed as a new DocumentNode
      const { error, documentNode } = safeParse('{' + fieldSet + '}');
      if (error || !documentNode) {
        // This would be caught as an error elsewhere
        continue;
      }
      const parentDatas: ParentWithFieldsData[] = [objectData];
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
            const parentData = parentDatas[currentDepth];
            // If an object-like was just visited, a selection set should have been entered
            if (shouldDefineSelectionSet) {
              shouldAddKeyFieldSet = false;
              return BREAK;
            }
            const fieldName = node.name.value;
            const fieldData = parentData.fieldDataByFieldName.get(fieldName);
            // undefined if the field does not exist on the parent
            if (!fieldData || fieldData.argumentDataByArgumentName.size || definedFields[currentDepth].has(fieldName)) {
              shouldAddKeyFieldSet = false;
              return BREAK;
            }
            definedFields[currentDepth].add(fieldName);
            // Depth 0 is the original parent type
            // If a field is external, but it's part of a key FieldSet, it will be included in the root configuration
            if (currentDepth === 0) {
              keyFieldNames.add(fieldName);
            }
            const namedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
            // The base scalars are not in the parents map
            if (BASE_SCALARS.has(namedTypeName)) {
              return;
            }
            // The child could itself be a parent and could exist as an object extension
            const fieldNamedTypeData =
              parentDefinitionDataByTypeName.get(namedTypeName) || parentExtensionDataByTypeName.get(namedTypeName);
            if (!fieldNamedTypeData) {
              shouldAddKeyFieldSet = false;
              return BREAK;
            }
            if (
              fieldNamedTypeData.kind === Kind.OBJECT_TYPE_DEFINITION ||
              fieldNamedTypeData.kind === Kind.OBJECT_TYPE_EXTENSION
            ) {
              shouldDefineSelectionSet = true;
              parentDatas.push(fieldNamedTypeData);
              return;
            }
            // interfaces and unions are invalid in a key directive
            if (isKindAbstract(fieldNamedTypeData.kind)) {
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
            if (currentDepth < 0 || currentDepth >= parentDatas.length) {
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
            parentDatas.pop();
            definedFields.pop();
          },
        },
      });
      if (!shouldAddKeyFieldSet) {
        continue;
      }
      // Add any top-level fields that compose the key in case they are external
      addIterableValuesToSet(keyFieldNames, configurationData.fieldNames);
      implicitKeys.push({
        fieldName: '',
        selectionSet: getNormalizedFieldSet(documentNode),
        disableEntityResolver: true,
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

  evaluateRootNodeFieldsResolvability() {
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
        if (this.inaccessiblePaths.has(fieldPath)) {
          continue;
        }
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
              this.entityDataByTypeName.has(namedRootFieldTypeName) ? [namedRootFieldTypeName] : [],
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
              this.entityDataByTypeName.has(namedRootFieldTypeName) ? [namedRootFieldTypeName] : [],
            );
            continue;
          default:
            this.errors.push(unexpectedObjectResponseType(fieldPath, kindToTypeString(namedTypeData.kind)));
        }
      }
    }
  }

  upsertEnumValueData(enumValueDataByValueName: Map<string, EnumValueData>, incomingData: EnumValueData) {
    const existingData = enumValueDataByValueName.get(incomingData.name);
    extractPersistedDirectives(
      existingData?.persistedDirectivesData || incomingData.persistedDirectivesData,
      incomingData.directivesByDirectiveName,
      this.persistedDirectiveDefinitionByDirectiveName,
    );
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

  upsertInputValueData(inputValueDataByValueName: Map<string, InputValueData>, incomingData: InputValueData) {
    const existingData = inputValueDataByValueName.get(incomingData.name);
    extractPersistedDirectives(
      existingData?.persistedDirectivesData || incomingData.persistedDirectivesData,
      incomingData.directivesByDirectiveName,
      this.persistedDirectiveDefinitionByDirectiveName,
    );
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

  upsertFieldData(
    fieldDataByFieldName: Map<string, FieldData>,
    incomingData: FieldData,
    isParentInaccessible: boolean,
  ) {
    const fieldPath = `${incomingData.renamedParentTypeName}.${incomingData.name}`;
    getValueOrDefault(this.pathsByNamedTypeName, incomingData.namedTypeName, () => new Set<string>()).add(fieldPath);
    this.namedOutputTypeNames.add(incomingData.namedTypeName);
    const existingData = fieldDataByFieldName.get(incomingData.name);
    extractPersistedDirectives(
      existingData?.persistedDirectivesData || incomingData.persistedDirectivesData,
      incomingData.directivesByDirectiveName,
      this.persistedDirectiveDefinitionByDirectiveName,
    );
    const isFieldInaccessible = isNodeDataInaccessible(incomingData);
    if (isParentInaccessible || isFieldInaccessible) {
      this.inaccessiblePaths.add(fieldPath);
    }
    if (incomingData.persistedDirectivesData.tags.size > 0) {
      const tagNames = getValueOrDefault(this.tagNamesByPath, fieldPath, () => new Set<string>());
      for (const tagName of incomingData.persistedDirectivesData.tags.keys()) {
        tagNames.add(tagName);
      }
    }
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
        const argumentPath = `${fieldPath}(${argumentName}: ... )`;
        const namedArgumentTypeName = getTypeNodeNamedTypeName(inputValueData.type);
        getValueOrDefault(this.pathsByNamedTypeName, namedArgumentTypeName, () => new Set<string>()).add(argumentPath);
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
          argumentPath,
          fieldPath,
        );
        if (inputValueData.persistedDirectivesData.tags.size > 0) {
          const tagArgumentPath = `${fieldPath}.${argumentName}`;
          const tagNames = getValueOrDefault(this.tagNamesByPath, tagArgumentPath, () => new Set<string>());
          for (const tagName of inputValueData.persistedDirectivesData.tags.keys()) {
            tagNames.add(tagName);
          }
        }
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
      const argumentPath = `${fieldPath}(${argumentName}: ... )`;
      const namedArgumentTypeName = getTypeNodeNamedTypeName(inputValueData.type);
      getValueOrDefault(this.pathsByNamedTypeName, namedArgumentTypeName, () => new Set<string>()).add(argumentPath);
      this.namedInputValueTypeNames.add(namedArgumentTypeName);
      /* If either the parent or the field to which the field belongs are declared inaccessible, the nullability
       ** of the argument is not considered. However, if only the argument is declared inaccessible, it is an
       ** error. */
      this.handleArgumentInaccessibility(
        isParentInaccessible || isFieldInaccessible,
        inputValueData,
        argumentPath,
        fieldPath,
      );
      if (inputValueData.persistedDirectivesData.tags.size > 0) {
        const tagArgumentPath = `${fieldPath}.${argumentName}`;
        const tagNames = getValueOrDefault(this.tagNamesByPath, tagArgumentPath, () => new Set<string>());
        for (const tagName of inputValueData.persistedDirectivesData.tags.keys()) {
          tagNames.add(tagName);
        }
      }
      this.upsertInputValueData(existingData.argumentDataByArgumentName, inputValueData);
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

  upsertParentDefinitionData(incomingData: ParentDefinitionData, subgraphName: string) {
    const entityInterfaceData = this.entityInterfaceFederationDataByTypeName.get(incomingData.name);
    const existingData = this.parentDefinitionDataByTypeName.get(incomingData.name);
    const baseData = existingData || incomingData;
    extractPersistedDirectives(
      baseData.persistedDirectivesData,
      incomingData.directivesByDirectiveName,
      this.persistedDirectiveDefinitionByDirectiveName,
    );
    const isParentInaccessible = isNodeDataInaccessible(baseData);
    if (isParentInaccessible) {
      this.inaccessiblePaths.add(incomingData.name);
    }
    if (incomingData.persistedDirectivesData.tags.size > 0) {
      const tagNames = getValueOrDefault(this.tagNamesByPath, incomingData.name, () => new Set<string>());
      for (const tagName of incomingData.persistedDirectivesData.tags.keys()) {
        tagNames.add(tagName);
      }
    }
    if (!existingData) {
      if (entityInterfaceData && entityInterfaceData.interfaceObjectSubgraphs.has(subgraphName)) {
        incomingData.kind = Kind.INTERFACE_TYPE_DEFINITION;
      }
      incomingData.node = {
        kind: incomingData.kind,
        name: stringToNameNode(incomingData.name),
      };
      this.parentDefinitionDataByTypeName.set(incomingData.name, incomingData);
      switch (incomingData.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
          for (const [enumValueName, enumValueData] of incomingData.enumValueDataByValueName) {
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
            if (isNodeDataInaccessible(enumValueData)) {
              this.inaccessiblePaths.add(`${incomingData.name}.${enumValueName}`);
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
            const inputFieldPath = `${incomingData.name}.${inputFieldName}`;
            getValueOrDefault(this.pathsByNamedTypeName, namedInputFieldTypeName, () => new Set<string>()).add(
              inputFieldPath,
            );
            this.namedInputValueTypeNames.add(namedInputFieldTypeName);
            extractPersistedDirectives(
              inputValueData.persistedDirectivesData,
              inputValueData.directivesByDirectiveName,
              this.persistedDirectiveDefinitionByDirectiveName,
            );
            if (isParentInaccessible || isNodeDataInaccessible(inputValueData)) {
              this.inaccessiblePaths.add(inputFieldPath);
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
            getValueOrDefault(this.pathsByNamedTypeName, fieldData.namedTypeName, () => new Set<string>()).add(
              fieldPath,
            );
            this.namedOutputTypeNames.add(fieldData.namedTypeName);
            extractPersistedDirectives(
              fieldData.persistedDirectivesData,
              fieldData.directivesByDirectiveName,
              this.persistedDirectiveDefinitionByDirectiveName,
            );
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
              const argumentPath = `${fieldPath}(${argumentName}: ... )`;
              getValueOrDefault(this.pathsByNamedTypeName, namedArgumentTypeName, () => new Set<string>()).add(
                argumentPath,
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
                argumentPath,
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
          this.upsertEnumValueData(existingData.enumValueDataByValueName, data);
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
        const objectData = incomingData as DefinitionWithFieldsData;
        if (objectData.persistedDirectivesData.tags.size > 0) {
          const tagNames = getValueOrDefault(this.tagNamesByPath, incomingData.name, () => new Set<string>());
          for (const tagName of objectData.persistedDirectivesData.tags.keys()) {
            tagNames.add(tagName);
          }
        }
        addIterableValuesToSet(objectData.implementedInterfaceTypeNames, existingData.implementedInterfaceTypeNames);
        addIterableValuesToSet(objectData.subgraphNames, existingData.subgraphNames);
        for (const fieldData of objectData.fieldDataByFieldName.values()) {
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
          const argumentPath = `${fieldPath}(${argumentName}: ... )`;
          getValueOrDefault(this.pathsByNamedTypeName, namedArgumentTypeName, () => new Set<string>()).add(
            argumentPath,
          );
          this.namedInputValueTypeNames.add(namedArgumentTypeName);
          extractPersistedDirectives(
            inputValueData.persistedDirectivesData,
            inputValueData.directivesByDirectiveName,
            this.persistedDirectiveDefinitionByDirectiveName,
          );
          this.handleArgumentInaccessibility(
            isParentInaccessible || isFieldInaccessible,
            inputValueData,
            argumentPath,
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
          for (const [argumentName, inputValueData] of fieldData.argumentDataByArgumentName) {
            const argumentPath = `${fieldPath}(${argumentName}: ... )`;
            this.inaccessiblePaths.add(argumentPath);
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
      createMultiGraphAndRenameRootTypes(this, internalSubgraph);
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

  handleEntityInterfaces() {
    for (const [typeName, entityInterfaceData] of this.entityInterfaceFederationDataByTypeName) {
      subtractSourceSetFromTargetSet(
        entityInterfaceData.interfaceFieldNames,
        entityInterfaceData.interfaceObjectFieldNames,
      );
      const entityInterface = getOrThrowError(this.parentDefinitionDataByTypeName, typeName, PARENT_DEFINITION_DATA);
      if (entityInterface.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        // TODO error
        continue;
      }
      for (const subgraphName of entityInterfaceData.interfaceObjectSubgraphs) {
        const configurationDataMap = getOrThrowError(
          this.internalSubgraphBySubgraphName,
          subgraphName,
          'internalSubgraphBySubgraphName',
        ).configurationDataByParentTypeName;
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
            PARENT_DEFINITION_DATA,
          );
          if (concreteTypeData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
            continue;
          }
          // The subgraph locations of the interface object must be added to the concrete types that implement it
          const entity = this.entityDataByTypeName.get(concreteTypeName);
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
                if (parentDefinitionData.appearances > enumValueData.appearances) {
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
            if (fieldData.isInaccessible) {
              continue;
            }
            clientSchemaFieldNodes.push(getClientSchemaFieldNodeByFieldData(fieldData));
          }
          if (isObject && invalidFieldNames.size > 0) {
            this.errors.push(invalidFieldShareabilityError(parentDefinitionData, invalidFieldNames));
          }
          parentDefinitionData.node.fields = fieldNodes;
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
    for (const [parentTypeName, objectExtensionData] of this.objectExtensionDataByTypeName) {
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
      const validInterfaces = this.getValidImplementedInterfaces(data);
      data.node.interfaces = validInterfaces;
      this.routerDefinitions.push(
        getNodeForRouterSchemaByData(data, this.persistedDirectiveDefinitionByDirectiveName, this.errors),
      );
      if (isNodeDataInaccessible(data)) {
        this.validateReferencesOfInaccessibleType(data);
        continue;
      }
      const clientInterfaces: NamedTypeNode[] = [];
      for (const interfaceTypeName of data.implementedInterfaceTypeNames) {
        if (!this.inaccessiblePaths.has(interfaceTypeName)) {
          clientInterfaces.push(stringToNamedTypeNode(interfaceTypeName));
        }
      }
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

  buildFederationResult(): FederationResultContainer {
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
    // return any composition errors before checking whether all fields are resolvable
    if (this.errors.length > 0) {
      return { errors: this.errors };
    }
    /* Resolvability evaluations are not necessary for contracts because the source graph resolvability checks must
     ** have already completed without error. */
    const warnings = this.warnings.length > 0 ? { warnings: this.warnings } : {};
    this.evaluateRootNodeFieldsResolvability();
    if (this.errors.length > 0) {
      return { errors: this.errors, ...warnings };
    }
    const newRouterAST: DocumentNode = {
      kind: Kind.DOCUMENT,
      definitions: this.routerDefinitions,
    };
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
        federatedGraphSchema: buildASTSchema(newRouterAST),
        federatedGraphClientSchema: this.getFederatedClientSchema(),
      },
      ...warnings,
    };
  }

  getFederatedClientSchema(): GraphQLSchema {
    if (this.inaccessiblePaths.size < 1 && this.tagNamesByPath.size < 1) {
      return buildASTSchema({
        kind: Kind.DOCUMENT,
        definitions: [],
      });
    }
    return buildASTSchema({
      kind: Kind.DOCUMENT,
      definitions: this.clientDefinitions,
    });
  }

  buildFederationContractResult(tagExclusions: Set<string>): FederationResultContainer {
    if (!this.isVersionTwo) {
      /* If all the subgraphs are version one, the @inaccessible directive won't be present.
       ** However, contracts require @inaccessible to exclude applicable tagged types. */
      this.routerDefinitions.push(INACCESSIBLE_DEFINITION);
    }
    for (const [typeName, parentTagData] of this.parentTagDataByTypeName) {
      // TODO assess children
      const parentDefinitionData = getOrThrowError(
        this.parentDefinitionDataByTypeName,
        typeName,
        PARENT_DEFINITION_DATA,
      );
      if (doSetsHaveAnyOverlap(tagExclusions, parentTagData.tagNames)) {
        getValueOrDefault(parentDefinitionData.persistedDirectivesData.directives, INACCESSIBLE, () => [
          generateSimpleDirective(INACCESSIBLE),
        ]);
      }
      if (parentTagData.childTagDataByChildName.size < 1) {
        continue;
      }
      switch (parentDefinitionData.kind) {
        case Kind.SCALAR_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.ENUM_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.UNION_TYPE_DEFINITION:
          continue;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          for (const [inputFieldName, childTagData] of parentTagData.childTagDataByChildName) {
            const inputValueData = getOrThrowError(
              parentDefinitionData.inputValueDataByValueName,
              inputFieldName,
              'parentDefinitionData.inputValueDataByValueName',
            );
            if (doSetsHaveAnyOverlap(tagExclusions, childTagData.tagNames)) {
              getValueOrDefault(inputValueData.persistedDirectivesData.directives, INACCESSIBLE, () => [
                generateSimpleDirective(INACCESSIBLE),
              ]);
            }
          }
          break;
        default:
          for (const [fieldName, childTagData] of parentTagData.childTagDataByChildName) {
            const fieldData = getOrThrowError(
              parentDefinitionData.fieldDataByFieldName,
              fieldName,
              'parentDefinitionData.fieldDataByFieldName',
            );
            if (doSetsHaveAnyOverlap(tagExclusions, childTagData.tagNames)) {
              getValueOrDefault(fieldData.persistedDirectivesData.directives, INACCESSIBLE, () => [
                generateSimpleDirective(INACCESSIBLE),
              ]);
            }
            for (const [argumentName, tagNames] of childTagData.tagNamesByArgumentName) {
              const inputValueData = getOrThrowError(
                fieldData.argumentDataByArgumentName,
                argumentName,
                'fieldData.argumentDataByArgumentName',
              );
              if (doSetsHaveAnyOverlap(tagExclusions, tagNames)) {
                getValueOrDefault(inputValueData.persistedDirectivesData.directives, INACCESSIBLE, () => [
                  generateSimpleDirective(INACCESSIBLE),
                ]);
              }
            }
          }
      }
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
        federatedGraphSchema: buildASTSchema(newRouterAST),
        federatedGraphClientSchema: this.getFederatedClientSchema(),
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
  return {
    federationFactory: new FederationFactory(
      authorizationDataByParentTypeName,
      concreteTypeNamesByAbstractTypeName,
      entityContainerByTypeName,
      entityInterfaceFederationDataByTypeName,
      graph,
      internalSubgraphBySubgraphName,
      warnings,
    ),
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
