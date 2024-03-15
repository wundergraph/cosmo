import { MultiGraph } from 'graphology';
import { BREAK, buildASTSchema, DirectiveDefinitionNode, DocumentNode, Kind, NamedTypeNode, visit } from 'graphql';
import {
  getTypeNodeNamedTypeName,
  MutableEnumValueNode,
  MutableFieldNode,
  MutableInputValueNode,
  MutableTypeDefinitionNode,
} from '../schema-building/ast';
import { isKindAbstract, safeParse, stringToNamedTypeNode } from '../ast/utils';
import {
  allFieldDefinitionsAreInaccessibleError,
  incompatibleParentKindFatalError,
  incompatibleSharedEnumError,
  invalidFieldShareabilityError,
  invalidImplementedTypeError,
  invalidRequiredInputValueError,
  minimumSubgraphRequirementError,
  noConcreteTypesForAbstractTypeError,
  noQueryRootTypeError,
  orScopesLimitError,
  undefinedEntityInterfaceImplementationsError,
  undefinedTypeError,
  unexpectedObjectResponseType,
  unexpectedParentKindErrorMessage,
  unimplementedInterfaceFieldsError,
  unresolvableFieldError,
} from '../errors/errors';
import { FederationResultContainer, RootTypeFieldData } from './utils';
import { InternalSubgraph, Subgraph, SubgraphConfig } from '../subgraph/subgraph';
import {
  AUTHENTICATED,
  DEFAULT_MUTATION,
  DEFAULT_QUERY,
  DEFAULT_SUBSCRIPTION,
  DEPRECATED,
  ENTITIES,
  INACCESSIBLE,
  INPUT_OBJECT,
  PARENT_DEFINITION_DATA,
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
  EntityData,
  EntityDataByTypeName,
  EntityInterfaceFederationData,
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
  isTypeValidImplementation,
  MergeMethod,
  pushAuthorizationDirectives,
  upsertObjectExtensionData,
  upsertParentDefinitionData,
  upsertPersistedDirectiveDefinitionData,
  upsertValidObjectExtensionData,
} from '../schema-building/utils';
import { ObjectExtensionData } from '../schema-building/type-extension-data';

import { createMultiGraphAndRenameRootTypes } from './walkers';

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
  entityContainersByTypeName: EntityDataByTypeName;
  errors: Error[] = [];
  evaluatedObjectLikesBySubgraph = new Map<string, Set<string>>();
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
  outputFieldTypeNames = new Set<string>();
  parentDefinitionDataByTypeName = new Map<string, ParentDefinitionData>();
  objectExtensionDataByTypeName = new Map<string, ObjectExtensionData>();
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
    this.entityContainersByTypeName = entityContainersByTypeName;
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
        unimplementedInterfaceFieldsError(data.node.name.value, kindToTypeString(data.kind), implementationErrorsMap),
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

  validateKeyFieldSetsForImplicitEntity(entityData: EntityData) {
    const internalSubgraph = getOrThrowError(
      this.internalSubgraphBySubgraphName,
      this.currentSubgraphName,
      'internalSubgraphBySubgraphName',
    );
    const parentContainerByTypeName = internalSubgraph.parentDefinitionDataByTypeName;
    const extensionContainerByTypeName = internalSubgraph.parentExtensionDataByTypeName;
    const implicitEntityContainer =
      parentContainerByTypeName.get(entityData.typeName) || extensionContainerByTypeName.get(entityData.typeName);
    if (
      !implicitEntityContainer ||
      (implicitEntityContainer.kind !== Kind.OBJECT_TYPE_DEFINITION &&
        implicitEntityContainer.kind !== Kind.OBJECT_TYPE_EXTENSION)
    ) {
      throw incompatibleParentKindFatalError(
        entityData.typeName,
        Kind.OBJECT_TYPE_DEFINITION,
        implicitEntityContainer?.kind || Kind.NULL,
      );
    }
    const configurationData = getOrThrowError(
      internalSubgraph.configurationDataByParentTypeName,
      entityData.typeName,
      'internalSubgraph.configurationDataMap',
    );
    const keyFieldNames = new Set<string>();
    const keys: RequiredFieldConfiguration[] = [];
    // Any errors in the field sets would be caught when evaluating the explicit entities, so they are ignored here
    for (const fieldSet of entityData.keyFieldSets) {
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
            // If an object-like was just visited, a selection set should have been entered
            if (shouldDefineSelectionSet) {
              shouldAddKeyFieldSet = false;
              return BREAK;
            }
            const fieldName = node.name.value;
            const fieldData = parentContainer.fieldDataByFieldName.get(fieldName);
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
          TAG_DEFINITION,
          SCOPE_SCALAR_DEFINITION,
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
          const invalidRequiredInputs: InvalidRequiredInputValueData[] = [];
          const inputValueNodes: MutableInputValueNode[] = [];
          for (const [inputValueName, inputValueData] of parentDefinitionData.inputValueDataByValueName) {
            if (parentDefinitionData.subgraphNames.size === inputValueData.subgraphNames.size) {
              inputValueNodes.push(
                getNodeWithPersistedDirectivesByInputValueData(
                  inputValueData,
                  this.persistedDirectiveDefinitionByDirectiveName,
                  this.errors,
                ),
              );
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
