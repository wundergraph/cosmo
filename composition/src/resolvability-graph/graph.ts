import { Kind, type SelectionSetNode } from 'graphql';
import { Edge, EntityDataNode, GraphNode, type GraphNodeOptions, RootNode } from './graph-nodes';
import {
  generateEntityResolvabilityErrors,
  generateRootResolvabilityErrors,
  generateSharedEntityResolvabilityErrors,
  getMultipliedRelativeOriginPaths,
  newRootFieldData,
} from './utils/utils';
import { safeParse } from '../ast/utils';
import { type GraphFieldData, type RootTypeName } from '../utils/types';
import { getFirstEntry, getOrThrowError, getValueOrDefault } from '../utils/utils';
import {
  type FieldName,
  type NodeName,
  type SelectionPath,
  type SubgraphName,
  type TypeName,
  type ValidationResult,
} from './types/types';
import {
  type ConsolidateUnresolvablePathsParams,
  type ValidateEntitiesParams,
  type VisitEntityParams,
} from './types/params';
import { type NodeResolutionData } from './node-resolution-data/node-resolution-data';
import { LITERAL_PERIOD, NOT_APPLICABLE, ROOT_TYPE_NAMES } from './constants/string-constants';
import { EntityWalker } from './walker/entity-walker/entity-walker';
import { RootFieldWalker } from './walker/root-field-walkers/root-field-walker';
import {
  type EntityResolvabilityErrorsParams,
  type EntitySharedRootFieldResolvabilityErrorsParams,
} from './utils/types/params';
import { type EntityAncestorCollection } from './utils/types/types';

type FieldSetSelectionTree = Map<FieldName, FieldSetSelectionTree>;

function newSelectionTree(): FieldSetSelectionTree {
  return new Map<FieldName, FieldSetSelectionTree>();
}

function selectionSetToTree(selectionSet: SelectionSetNode): FieldSetSelectionTree {
  const tree = newSelectionTree();
  for (const selection of selectionSet.selections) {
    if (selection.kind !== Kind.FIELD) {
      continue;
    }
    tree.set(
      selection.name.value,
      selection.selectionSet ? selectionSetToTree(selection.selectionSet) : newSelectionTree(),
    );
  }
  return tree;
}

function cloneSelectionTree(source: FieldSetSelectionTree): FieldSetSelectionTree {
  const clone = newSelectionTree();
  for (const [fieldName, sourceChild] of source) {
    clone.set(fieldName, cloneSelectionTree(sourceChild));
  }
  return clone;
}

function mergeSelectionTree(target: FieldSetSelectionTree, source: FieldSetSelectionTree) {
  for (const [fieldName, sourceChild] of source) {
    const targetChild = target.get(fieldName);
    if (targetChild) {
      mergeSelectionTree(targetChild, sourceChild);
      continue;
    }
    target.set(fieldName, cloneSelectionTree(sourceChild));
  }
}

function selectionTreeContains(source: FieldSetSelectionTree, required: FieldSetSelectionTree): boolean {
  for (const [fieldName, requiredChild] of required) {
    const sourceChild = source.get(fieldName);
    if (!sourceChild) {
      return false;
    }
    if (requiredChild.size > 0 && !selectionTreeContains(sourceChild, requiredChild)) {
      return false;
    }
  }
  return true;
}

export class Graph {
  edgeId = -1;
  entityDataNodeByTypeName = new Map<TypeName, EntityDataNode>();
  nodeByNodeName = new Map<NodeName, GraphNode>();
  nodesByTypeName = new Map<TypeName, Array<GraphNode>>();
  parsedSelectionTreeByFieldSet = new Map<string, FieldSetSelectionTree | undefined>();
  resolvedRootFieldNodeNames = new Set<NodeName>();
  rootNodeByTypeName = new Map<RootTypeName, RootNode>();
  subgraphName: SubgraphName = NOT_APPLICABLE;
  resDataByNodeName = new Map<NodeName, NodeResolutionData>();
  resDataByRelativePathByEntity = new Map<NodeName, Map<SelectionPath, NodeResolutionData>>();
  visitedEntitiesByOriginEntity = new Map<NodeName, Set<NodeName>>();
  walkerIndex = -1;

  constructor() {}

  getRootNode(typeName: RootTypeName): RootNode {
    return getValueOrDefault(this.rootNodeByTypeName, typeName, () => new RootNode(typeName));
  }

  addOrUpdateNode(typeName: TypeName, options?: GraphNodeOptions): GraphNode {
    const nodeName: NodeName = `${this.subgraphName}.${typeName}`;
    const node = this.nodeByNodeName.get(nodeName);
    if (node) {
      node.isAbstract ||= !!options?.isAbstract;
      if (!node.isLeaf && options?.isLeaf) {
        node.isLeaf = true;
      }
      return node;
    }
    const newNode = new GraphNode(this.subgraphName, typeName, options);
    this.nodeByNodeName.set(nodeName, newNode);
    getValueOrDefault(this.nodesByTypeName, typeName, () => []).push(newNode);
    return newNode;
  }

  addEdge(headNode: GraphNode | RootNode, tailNode: GraphNode, fieldName: string, isAbstractEdge = false): Edge {
    if (headNode.isRootNode) {
      const edge = new Edge(this.getNextEdgeId(), tailNode, fieldName);
      getValueOrDefault((headNode as RootNode).headToSharedTailEdges, fieldName, () => []).push(edge);
      return edge;
    }
    const headGraphNode = headNode as GraphNode;
    const headToTailEdge = new Edge(
      this.getNextEdgeId(),
      tailNode,
      isAbstractEdge ? tailNode.typeName : fieldName,
      isAbstractEdge,
    );
    headGraphNode.headToTailEdges.set(fieldName, headToTailEdge);
    return headToTailEdge;
  }

  addEntityDataNode(typeName: TypeName): EntityDataNode {
    const node = this.entityDataNodeByTypeName.get(typeName);
    if (node) {
      return node;
    }
    const newNode = new EntityDataNode(typeName);
    this.entityDataNodeByTypeName.set(typeName, newNode);
    return newNode;
  }

  getNextEdgeId() {
    return (this.edgeId += 1);
  }

  getNextWalkerIndex() {
    return (this.walkerIndex += 1);
  }

  getSelectionTreeForFieldSet(fieldSet: string): FieldSetSelectionTree | undefined {
    if (this.parsedSelectionTreeByFieldSet.has(fieldSet)) {
      return this.parsedSelectionTreeByFieldSet.get(fieldSet);
    }
    const { documentNode, error } = safeParse(`{ ${fieldSet} }`);
    if (error || !documentNode) {
      this.parsedSelectionTreeByFieldSet.set(fieldSet, undefined);
      return undefined;
    }
    const operationDefinition = documentNode.definitions[0];
    const tree =
      operationDefinition?.kind === Kind.OPERATION_DEFINITION
        ? selectionSetToTree(operationDefinition.selectionSet)
        : undefined;
    this.parsedSelectionTreeByFieldSet.set(fieldSet, tree);
    return tree;
  }

  getSatisfiedSelectionTree(node: GraphNode): FieldSetSelectionTree {
    const tree = newSelectionTree();
    for (const fieldSet of node.satisfiedFieldSets) {
      if (node.externalFieldSets.has(fieldSet)) {
        continue;
      }
      const selectionTree = this.getSelectionTreeForFieldSet(fieldSet);
      if (selectionTree) {
        mergeSelectionTree(tree, selectionTree);
      }
    }
    return tree;
  }

  addEntityEdgeIfAbsent(node: GraphNode, subgraphName: SubgraphName): boolean {
    if (subgraphName === node.subgraphName) {
      return false;
    }
    const siblingNode = this.nodeByNodeName.get(`${subgraphName}.${node.typeName}`);
    if (!siblingNode || node.entityEdges.some((edge) => edge.node.nodeName === siblingNode.nodeName)) {
      return false;
    }
    node.entityEdges.push(new Edge(this.getNextEdgeId(), siblingNode, ''));
    return true;
  }

  isLocallyResolvableField(node: GraphNode, fieldData: GraphFieldData): boolean {
    return fieldData.subgraphNames.has(node.subgraphName) && !fieldData.externalSubgraphNames.has(node.subgraphName);
  }

  canResolveSelectionTree(
    node: GraphNode,
    requiredTree: FieldSetSelectionTree,
    availableTree: FieldSetSelectionTree,
    remainingGatherHops: number,
    visitedEntityKeyChecks = new Set<string>(),
  ): boolean {
    if (node.fieldDataByName.size < 1) {
      return false;
    }
    for (const [fieldName, requiredChildTree] of requiredTree) {
      const availableChildTree = availableTree.get(fieldName);
      if (
        availableChildTree &&
        (requiredChildTree.size < 1 || selectionTreeContains(availableChildTree, requiredChildTree))
      ) {
        continue;
      }
      const fieldData = node.fieldDataByName.get(fieldName);
      if (fieldData && this.isLocallyResolvableField(node, fieldData)) {
        if (requiredChildTree.size < 1 || fieldData.isLeaf) {
          continue;
        }
        const edge = node.headToTailEdges.get(fieldName);
        if (
          edge &&
          !edge.isEdgeInaccessible() &&
          !edge.isExternal &&
          this.canResolveSelectionTree(
            edge.node,
            requiredChildTree,
            availableChildTree ?? newSelectionTree(),
            remainingGatherHops,
            visitedEntityKeyChecks,
          )
        ) {
          continue;
        }
      }
      if (
        this.canResolveFieldThroughEntitySibling({
          availableTree,
          fieldName,
          node,
          remainingGatherHops,
          requiredChildTree,
          visitedEntityKeyChecks,
        })
      ) {
        continue;
      }
      return false;
    }
    return true;
  }

  canResolveFieldThroughEntitySibling({
    availableTree,
    fieldName,
    node,
    remainingGatherHops,
    requiredChildTree,
    visitedEntityKeyChecks,
  }: {
    availableTree: FieldSetSelectionTree;
    fieldName: FieldName;
    node: GraphNode;
    remainingGatherHops: number;
    requiredChildTree: FieldSetSelectionTree;
    visitedEntityKeyChecks: Set<string>;
  }): boolean {
    if (remainingGatherHops < 1) {
      return false;
    }
    const fieldCheck = `field:${node.nodeName}.${fieldName}`;
    if (visitedEntityKeyChecks.has(fieldCheck)) {
      return false;
    }
    const entityDataNode = this.entityDataNodeByTypeName.get(node.typeName);
    if (!entityDataNode) {
      return false;
    }
    visitedEntityKeyChecks.add(fieldCheck);
    const fieldSets = [...entityDataNode.targetSubgraphNamesByFieldSet.keys()].sort();
    for (const fieldSet of fieldSets) {
      const keyCheck = `${node.nodeName}.${fieldSet}`;
      if (visitedEntityKeyChecks.has(keyCheck)) {
        continue;
      }
      const keyTree = this.getSelectionTreeForFieldSet(fieldSet);
      if (!keyTree) {
        continue;
      }
      visitedEntityKeyChecks.add(keyCheck);
      const canSatisfyKey = this.canResolveSelectionTree(node, keyTree, availableTree, 0, visitedEntityKeyChecks);
      visitedEntityKeyChecks.delete(keyCheck);
      if (!canSatisfyKey) {
        continue;
      }
      const subgraphNames = [...(entityDataNode.targetSubgraphNamesByFieldSet.get(fieldSet) ?? [])].sort();
      for (const subgraphName of subgraphNames) {
        if (subgraphName === node.subgraphName) {
          continue;
        }
        const siblingNode = this.nodeByNodeName.get(`${subgraphName}.${node.typeName}`);
        if (!siblingNode) {
          continue;
        }
        const siblingAvailableTree = this.getSatisfiedSelectionTree(siblingNode);
        mergeSelectionTree(siblingAvailableTree, keyTree);
        if (
          this.canResolveSelectionTree(
            siblingNode,
            new Map([[fieldName, requiredChildTree]]),
            siblingAvailableTree,
            remainingGatherHops - 1,
            visitedEntityKeyChecks,
          )
        ) {
          visitedEntityKeyChecks.delete(fieldCheck);
          return true;
        }
      }
    }
    visitedEntityKeyChecks.delete(fieldCheck);
    return false;
  }

  updateEntityEdges(): boolean {
    let wasUpdated = false;
    for (const [typeName, nodes] of this.nodesByTypeName) {
      const entityDataNode = this.entityDataNodeByTypeName.get(typeName);
      if (!entityDataNode) {
        continue;
      }
      for (const node of nodes) {
        if (node.fieldDataByName.size < 1) {
          continue;
        }
        node.hasEntitySiblings = true;
        for (const fieldSet of node.satisfiedFieldSets) {
          // If the field set is unresolvable in the entity's own subgraph, it cannot be used to jump to other subgraphs.
          if (node.externalFieldSets.has(fieldSet)) {
            continue;
          }
          for (const subgraphName of entityDataNode.targetSubgraphNamesByFieldSet.get(fieldSet) ?? []) {
            wasUpdated = this.addEntityEdgeIfAbsent(node, subgraphName) || wasUpdated;
          }
        }
        const availableTree = this.getSatisfiedSelectionTree(node);
        for (const [fieldSet, subgraphNames] of entityDataNode.targetSubgraphNamesByFieldSet) {
          if (node.satisfiedFieldSets.has(fieldSet)) {
            continue;
          }
          const targetTree = this.getSelectionTreeForFieldSet(fieldSet);
          if (!targetTree || !this.canResolveSelectionTree(node, targetTree, availableTree, 1)) {
            continue;
          }
          for (const subgraphName of subgraphNames) {
            wasUpdated = this.addEntityEdgeIfAbsent(node, subgraphName) || wasUpdated;
          }
        }
      }
    }
    return wasUpdated;
  }

  setNodeInaccessible(typeName: TypeName) {
    const nodes = this.nodesByTypeName.get(typeName);
    if (!nodes) {
      return;
    }
    for (const node of nodes) {
      node.isInaccessible = true;
    }
  }

  initializeNode(typeName: TypeName, fieldDataByName: Map<FieldName, GraphFieldData>) {
    if (ROOT_TYPE_NAMES.has(typeName)) {
      const rootNode = this.getRootNode(typeName as RootTypeName);
      rootNode.removeInaccessibleEdges(fieldDataByName);
      rootNode.fieldDataByName = fieldDataByName;
      return;
    }
    const nodes = this.nodesByTypeName.get(typeName);
    if (!nodes) {
      return;
    }
    for (const node of nodes) {
      node.fieldDataByName = fieldDataByName;
      node.handleInaccessibleEdges();
      node.isLeaf = false;
    }
    while (this.updateEntityEdges()) {
      // Updating a child entity can make an ancestor compound key satisfiable.
    }
  }

  setSubgraphName(subgraphName: SubgraphName) {
    this.subgraphName = subgraphName;
  }

  visitEntity({
    encounteredEntityNodeNames,
    entityNodeName,
    relativeOriginPaths,
    resDataByRelativeOriginPath,
    resolvedPaths,
    subgraphNameByUnresolvablePath,
    visitedEntities,
  }: VisitEntityParams) {
    const entityNode = this.nodeByNodeName.get(entityNodeName);
    if (!entityNode) {
      throw new Error(`Fatal: Could not find entity node for "${entityNodeName}".`);
    }
    visitedEntities.add(entityNodeName);
    const interSubgraphNodes = this.nodesByTypeName.get(entityNode.typeName);
    if (!interSubgraphNodes?.length) {
      throw new Error(`Fatal: Could not find any nodes for "${entityNodeName}".`);
    }
    const walker = new EntityWalker({
      encounteredEntityNodeNames,
      index: this.getNextWalkerIndex(),
      relativeOriginPaths,
      resDataByNodeName: this.resDataByNodeName,
      resDataByRelativeOriginPath,
      resolvedPaths,
      subgraphNameByUnresolvablePath,
      visitedEntities,
    });
    const accessibleEntityNodeNames = entityNode.getAllAccessibleEntityNodeNames();
    for (const siblingEntityNode of interSubgraphNodes) {
      if (
        siblingEntityNode.nodeName !== entityNode.nodeName &&
        !accessibleEntityNodeNames.has(siblingEntityNode.nodeName)
      ) {
        continue;
      }
      const { areDescendantsResolved } = walker.visitEntityDescendantConcreteNode({
        node: siblingEntityNode,
        selectionPath: '',
      });
      // All fields and descendent fields are resolved; nothing more to do for this entity.
      if (areDescendantsResolved) {
        return;
      }
    }
    // Because of shared entity descendant paths, we can only assess the errors after checking all nested entities.
    for (const [nestedEntityNodeName, selectionPath] of walker.selectionPathByEntityNodeName) {
      /* Short-circuiting on failures here can cause false positives.
       * For example, an Object that is an entity at least one graph and defines at least one unique (nested) field.
       * If that Object has no accessible keys but is accessible through an ancestor, short-circuiting here would
       * produce an error before that shared path has been visited.
       */
      this.visitEntity({
        encounteredEntityNodeNames,
        entityNodeName: nestedEntityNodeName,
        relativeOriginPaths: getMultipliedRelativeOriginPaths({
          relativeOriginPaths,
          selectionPath: selectionPath,
        }),
        resDataByRelativeOriginPath,
        resolvedPaths,
        subgraphNameByUnresolvablePath,
        visitedEntities,
      });
    }
  }

  validate(): ValidationResult {
    for (const rootNode of this.rootNodeByTypeName.values()) {
      for (const [rootFieldName, sharedRootFieldEdges] of rootNode.headToSharedTailEdges) {
        const isSharedRootField = sharedRootFieldEdges.length > 1;
        if (!isSharedRootField) {
          const namedTypeNodeName = sharedRootFieldEdges[0]!.node.nodeName;
          if (this.resolvedRootFieldNodeNames.has(namedTypeNodeName)) {
            continue;
          }
          this.resolvedRootFieldNodeNames.add(namedTypeNodeName);
        }
        const rootFieldWalker = new RootFieldWalker({
          index: this.getNextWalkerIndex(),
          nodeResolutionDataByNodeName: this.resDataByNodeName,
        });
        if (
          rootFieldWalker.visitRootFieldEdges({
            edges: sharedRootFieldEdges,
            rootTypeName: rootNode.typeName.toLowerCase(),
          }).areDescendantsResolved
        ) {
          continue;
        }
        const involvesEntities = isSharedRootField
          ? rootFieldWalker.entityNodeNamesByPath.size > 0
          : rootFieldWalker.pathsByEntityNodeName.size > 0;
        if (rootFieldWalker.unresolvablePaths.size < 1 && !involvesEntities) {
          continue;
        }

        const fieldData = getOrThrowError(rootNode.fieldDataByName, rootFieldName, 'fieldDataByName');
        const rootFieldData = newRootFieldData(rootNode.typeName, rootFieldName, fieldData.subgraphNames);
        // If there are no nested entities, then the unresolvable fields must be impossible to resolve.
        if (!involvesEntities) {
          return {
            errors: generateRootResolvabilityErrors({
              unresolvablePaths: rootFieldWalker.unresolvablePaths,
              resDataByPath: rootFieldWalker.resDataByPath,
              rootFieldData,
            }),
            success: false,
          };
        }

        const result = this.validateEntities({ isSharedRootField, rootFieldData, walker: rootFieldWalker });
        if (!result.success) {
          return result;
        }
      }
    }

    return {
      success: true,
    };
  }

  consolidateUnresolvableRootWithEntityPaths({
    pathFromRoot,
    resDataByRelativeOriginPath,
    subgraphNameByUnresolvablePath,
    walker,
  }: ConsolidateUnresolvablePathsParams) {
    for (const unresolvableRootPath of walker.unresolvablePaths) {
      if (!unresolvableRootPath.startsWith(pathFromRoot)) {
        continue;
      }
      const relativePath = unresolvableRootPath.slice(pathFromRoot.length);
      const rootResData = getOrThrowError(
        walker.resDataByPath,
        unresolvableRootPath,
        `rootFieldWalker.unresolvablePaths`,
      );
      const entityResData = resDataByRelativeOriginPath.get(relativePath);
      if (!entityResData) {
        continue;
      }
      rootResData.addData(entityResData);
      entityResData.addData(rootResData);
      if (!rootResData.isResolved()) {
        // Delete the root path so that the error only propagates once through the entity.
        walker.unresolvablePaths.delete(unresolvableRootPath);
        continue;
      }
      walker.unresolvablePaths.delete(unresolvableRootPath);
      subgraphNameByUnresolvablePath.delete(relativePath);
    }
  }

  consolidateUnresolvableEntityWithRootPaths({
    pathFromRoot,
    resDataByRelativeOriginPath,
    subgraphNameByUnresolvablePath,
    walker,
  }: ConsolidateUnresolvablePathsParams) {
    for (const unresolvableEntityPath of subgraphNameByUnresolvablePath.keys()) {
      const entityResData = getOrThrowError(
        resDataByRelativeOriginPath,
        unresolvableEntityPath,
        `resDataByRelativeOriginPath`,
      );
      const fullPath = `${pathFromRoot}${unresolvableEntityPath}`;
      const rootResData = walker.resDataByPath.get(fullPath);
      // The path may not exist from the root walker due to nested entities.
      if (rootResData) {
        entityResData.addData(rootResData);
        rootResData.addData(entityResData);
      }
      if (!entityResData.isResolved()) {
        continue;
      }
      subgraphNameByUnresolvablePath.delete(unresolvableEntityPath);
    }
  }

  validateSharedRootFieldEntities({ rootFieldData, walker }: ValidateEntitiesParams): ValidationResult {
    const resolvedPaths = new Set<SelectionPath>();
    for (const [pathFromRoot, entityNodeNames] of walker.entityNodeNamesByPath) {
      if (walker.unresolvablePaths.size < 1) {
        return {
          success: true,
        };
      }
      const subgraphNameByUnresolvablePath = new Map<SelectionPath, SubgraphName>();
      // Shared fields are unique contexts, so the resolution data cannot be reused.
      const resDataByRelativeOriginPath = new Map<SelectionPath, NodeResolutionData>();
      /* The entity nodes are connected through the root (and not necessarily through a key), so all origins must be
       * explored before an error can be propagated with certainty.
       * */
      for (const entityNodeName of entityNodeNames) {
        this.visitEntity({
          encounteredEntityNodeNames: new Set<NodeName>(),
          entityNodeName,
          resDataByRelativeOriginPath: resDataByRelativeOriginPath,
          resolvedPaths,
          subgraphNameByUnresolvablePath,
          visitedEntities: new Set<NodeName>(),
        });
      }
      /* There might be root errors that rely on entity data propagation.
       * Always propagate entity resolution data to the root data before moving on.
       * */
      this.consolidateUnresolvableRootWithEntityPaths({
        pathFromRoot,
        resDataByRelativeOriginPath,
        subgraphNameByUnresolvablePath,
        walker,
      });

      // Check nothing further needs to be done
      if (subgraphNameByUnresolvablePath.size < 1) {
        continue;
      }

      // Only do this if we have to
      this.consolidateUnresolvableEntityWithRootPaths({
        pathFromRoot,
        resDataByRelativeOriginPath,
        subgraphNameByUnresolvablePath,
        walker,
      });

      // Check again before returning an error
      if (subgraphNameByUnresolvablePath.size < 1) {
        continue;
      }

      return {
        errors: generateSharedEntityResolvabilityErrors({
          entityAncestors: this.getEntityAncestorCollection(entityNodeNames),
          pathFromRoot,
          resDataByPath: resDataByRelativeOriginPath,
          rootFieldData: rootFieldData,
          subgraphNameByUnresolvablePath,
        }),
        success: false,
      };
    }

    if (walker.unresolvablePaths.size > 0) {
      return {
        errors: generateRootResolvabilityErrors({
          resDataByPath: walker.resDataByPath,
          rootFieldData,
          unresolvablePaths: walker.unresolvablePaths,
        }),
        success: false,
      };
    }

    return {
      success: true,
    };
  }

  validateRootFieldEntities({ rootFieldData, walker }: ValidateEntitiesParams): ValidationResult {
    const resolvedPaths = new Set<SelectionPath>();
    for (const [entityNodeName, entityPaths] of walker.pathsByEntityNodeName) {
      const subgraphNameByUnresolvablePath = new Map<SelectionPath, SubgraphName>();
      if (this.resDataByNodeName.has(entityNodeName)) {
        continue;
      }
      const resDataByRelativeOriginPath = getValueOrDefault(
        this.resDataByRelativePathByEntity,
        entityNodeName,
        () => new Map<SelectionPath, NodeResolutionData>(),
      );
      this.visitEntity({
        encounteredEntityNodeNames: new Set<NodeName>(),
        entityNodeName,
        resDataByRelativeOriginPath: resDataByRelativeOriginPath,
        resolvedPaths,
        subgraphNameByUnresolvablePath,
        visitedEntities: getValueOrDefault(
          this.visitedEntitiesByOriginEntity,
          entityNodeName,
          () => new Set<NodeName>(),
        ),
      });

      if (subgraphNameByUnresolvablePath.size < 1) {
        continue;
      }

      return {
        errors: this.getEntityResolvabilityErrors({
          entityNodeName,
          // Propagate errors for the first encounter only.
          pathFromRoot: getFirstEntry(entityPaths) ?? '',
          rootFieldData,
          subgraphNameByUnresolvablePath,
        }),
        success: false,
      };
    }

    return {
      success: true,
    };
  }

  validateEntities(params: ValidateEntitiesParams): ValidationResult {
    if (params.isSharedRootField) {
      return this.validateSharedRootFieldEntities(params);
    }
    return this.validateRootFieldEntities(params);
  }

  getEntityResolvabilityErrors({
    entityNodeName,
    pathFromRoot,
    rootFieldData,
    subgraphNameByUnresolvablePath,
  }: EntityResolvabilityErrorsParams): Array<Error> {
    const nodeResolutionDataByFieldPath = getOrThrowError(
      this.resDataByRelativePathByEntity,
      entityNodeName,
      'resDataByRelativePathByEntity',
    );
    const entityTypeName = entityNodeName.split(LITERAL_PERIOD)[1];
    const { fieldSetsByTargetSubgraphName } = getOrThrowError(
      this.entityDataNodeByTypeName,
      entityTypeName,
      'entityDataNodeByTypeName',
    );
    return generateEntityResolvabilityErrors({
      entityAncestorData: {
        fieldSetsByTargetSubgraphName,
        subgraphName: '',
        typeName: entityTypeName,
      },
      pathFromRoot,
      resDataByPath: nodeResolutionDataByFieldPath,
      rootFieldData: rootFieldData,
      subgraphNameByUnresolvablePath,
    });
  }

  getEntityAncestorCollection(entityNodeNames: Set<NodeName>): EntityAncestorCollection {
    const typeName = getFirstEntry(entityNodeNames)!.split(LITERAL_PERIOD)[1];
    const { fieldSetsByTargetSubgraphName } = getOrThrowError(
      this.entityDataNodeByTypeName,
      typeName,
      'entityDataNodeByTypeName',
    );
    const subgraphNames = new Array<SubgraphName>();
    const sourceSubgraphNamesBySatisfiedFieldSet = new Map<string, Array<SubgraphName>>();
    for (const entityNodeName of entityNodeNames) {
      const { satisfiedFieldSets, subgraphName } = getOrThrowError(
        this.nodeByNodeName,
        entityNodeName,
        'nodeByNodeName',
      );
      for (const fieldSet of satisfiedFieldSets) {
        getValueOrDefault(sourceSubgraphNamesBySatisfiedFieldSet, fieldSet, () => []).push(subgraphName);
      }
      subgraphNames.push(subgraphName);
    }

    return {
      fieldSetsByTargetSubgraphName,
      sourceSubgraphNamesBySatisfiedFieldSet,
      subgraphNames,
      typeName,
    };
  }
}
