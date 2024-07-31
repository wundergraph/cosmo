import { add, getOrThrowError, getValueOrDefault, GraphFieldData } from '../utils/utils';
import { N_A, ROOT_TYPE_NAMES, RootTypeName } from '../utils/string-constants';
import { Edge, EntityDataNode, GraphNode, GraphNodeOptions, RootNode } from './graph-nodes';
import {
  EntityResolvabilityFailure,
  EntityResolvabilityResult,
  generateResolvabilityErrors,
  newRootFieldData,
  NodeResolutionData,
  RootFieldData,
} from './utils';

export class Graph {
  edgeId = -1;
  entityDataNodes = new Map<string, EntityDataNode>();
  entityNodeNamesBySharedFieldPath = new Map<string, Set<string>>();
  nodeByNodeName = new Map<string, GraphNode>();
  nodesByTypeName = new Map<string, Array<GraphNode>>();
  rootNodeByRootTypeName = new Map<RootTypeName, RootNode>();
  subgraphName = N_A;
  resolvableFieldNamesByRelativeFieldPathByEntityNodeName = new Map<string, Map<string, NodeResolutionData>>();
  nodeResolutionDataByFieldPath = new Map<string, NodeResolutionData>();
  unresolvableFieldPaths = new Set<string>();
  failureResultByEntityNodeName = new Map<string, EntityResolvabilityFailure>();
  walkerIndex = -1;

  constructor() {}

  getRootNode(typeName: RootTypeName): RootNode {
    return getValueOrDefault(this.rootNodeByRootTypeName, typeName, () => new RootNode(typeName));
  }

  addOrUpdateNode(typeName: string, options?: GraphNodeOptions): GraphNode {
    const nodeName = `${this.subgraphName}.${typeName}`;
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
      getValueOrDefault((headNode as RootNode).headToShareableTailEdges, fieldName, () => []).push(edge);
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

  addEntityDataNode(typeName: string): EntityDataNode {
    const node = this.entityDataNodes.get(typeName);
    if (node) {
      return node;
    }
    const newNode = new EntityDataNode(typeName);
    this.entityDataNodes.set(typeName, newNode);
    return newNode;
  }

  getNextEdgeId() {
    return (this.edgeId += 1);
  }

  setNodeInaccessible(typeName: string) {
    const nodes = this.nodesByTypeName.get(typeName);
    if (!nodes) {
      return;
    }
    for (const node of nodes) {
      node.isInaccessible = true;
    }
  }

  initializeNode(typeName: string, fieldDataByFieldName: Map<string, GraphFieldData>) {
    const entityDataNode = this.entityDataNodes.get(typeName);
    if (ROOT_TYPE_NAMES.has(typeName)) {
      const rootNode = this.getRootNode(typeName as RootTypeName);
      rootNode.removeInaccessibleEdges(fieldDataByFieldName);
      rootNode.fieldDataByFieldName = fieldDataByFieldName;
      return;
    }
    const nodes = this.nodesByTypeName.get(typeName);
    if (!nodes) {
      return;
    }
    for (const node of nodes) {
      node.fieldDataByFieldName = fieldDataByFieldName;
      node.handleInaccessibleEdges();
      node.isLeaf = false;
      if (!entityDataNode) {
        continue;
      }
      node.hasEntitySiblings = true;
      for (const fieldSet of node.satisfiedFieldSets) {
        const subgraphNames = entityDataNode.targetSubgraphNamesByFieldSet.get(fieldSet);
        for (const subgraphName of subgraphNames || []) {
          // A subgraph should not jump to itself
          if (subgraphName === node.subgraphName) {
            continue;
          }
          const siblingNode = this.nodeByNodeName.get(`${subgraphName}.${node.typeName}`);
          if (siblingNode) {
            node.entityEdges.push(new Edge(this.getNextEdgeId(), siblingNode, ''));
          }
        }
      }
    }
  }

  setSubgraphName(subgraphName: string) {
    this.subgraphName = subgraphName;
  }

  validateEntities(
    entityNodeNamesBySharedFieldPath: Map<string, Set<string>>,
    rootFieldData: RootFieldData,
  ): EntityResolvabilityResult {
    const nestedEntityNodeNamesBySharedFieldPathByParentNodeName = new Map<string, Map<string, Set<string>>>();
    for (const [sharedFieldPath, entityNodeNames] of entityNodeNamesBySharedFieldPath) {
      const isFieldShared = entityNodeNames.size > 1;
      let failureResult: EntityResolvabilityFailure | undefined;
      /* In the event of a shared entity field, the validation changes slightly.
       * The fields are linked through a mutual entity ancestor, and may/may not have additional routing through a key.
       * In this case, the following must occur:
       * 1. sharedResolvableFieldNamesByRelativeFieldPath will be created and passed to ensure the resolvability of
       * paths are assessed collectively, rather than by a single instance of the shared fields
       * */
      const sharedResolvableFieldNamesByRelativeFieldPath = isFieldShared
        ? new Map<string, NodeResolutionData>()
        : undefined;
      /*
       * 2. unresolvableSharedFieldPaths is used to determine whether there are still unresolvable paths even after
       * all shared fields have been analysed.
       * */
      const unresolvableSharedFieldPaths = new Set<string>();
      /*
       * 3. nestedEntityNodeNamesBySharedFieldPath should be a reference to the same set, to ensure nested shared fields
       * are analysed as shared fields when moving deeper.
       * */
      const sharedNestedEntityNodeNamesBySharedFieldPath = new Map<string, Set<string>>();
      for (const entityNodeName of entityNodeNames) {
        const entityNode = this.nodeByNodeName.get(entityNodeName);
        if (!entityNode) {
          throw new Error(`Fatal: Could not find entity node for "${entityNodeName}".`);
        }
        const resolvableFieldNamesByRelativeFieldPath =
          this.resolvableFieldNamesByRelativeFieldPathByEntityNodeName.get(entityNodeName);
        if (resolvableFieldNamesByRelativeFieldPath) {
          // If at least one of the referenced entities is always fully resolvable, the path is resolvable.
          const entityFailureResult = this.failureResultByEntityNodeName.get(entityNodeName);
          if (!entityFailureResult) {
            failureResult = undefined;
            break;
          }
          // If the path is shared, it must be assessed collectively
          if (!isFieldShared) {
            return entityFailureResult;
          }
        }
        const interSubgraphNodes = this.nodesByTypeName.get(entityNode.typeName) || [];
        const nestedEntityNodeNamesBySharedFieldPath = getValueOrDefault(
          nestedEntityNodeNamesBySharedFieldPathByParentNodeName,
          entityNodeName,
          () => (isFieldShared ? sharedNestedEntityNodeNamesBySharedFieldPath : new Map<string, Set<string>>()),
        );
        const walker = new Walker({
          interSubgraphNodes,
          entityNodeNamesBySharedFieldPath: nestedEntityNodeNamesBySharedFieldPath,
          originNode: entityNode,
          resolvableFieldNamesByRelativeFieldPathByEntityNodeName:
            this.resolvableFieldNamesByRelativeFieldPathByEntityNodeName,
          walkerIndex: (this.walkerIndex += 1),
          sharedResolvableFieldNamesByRelativeFieldPath,
          unresolvableSharedFieldPaths,
        });
        walker.visitEntityNode(entityNode);
        if (walker.unresolvableFieldPaths.size > 0) {
          if (isFieldShared && unresolvableSharedFieldPaths.size < 1) {
            failureResult = undefined;
            break;
          }
          failureResult = {
            entityAncestorData: {
              fieldSetsByTargetSubgraphName: getOrThrowError(
                this.entityDataNodes,
                entityNode.typeName,
                'entityDataNodes',
              ).fieldSetsByTargetSubgraphName,
              subgraphName: entityNode.subgraphName,
              typeName: entityNode.typeName,
            },
            nodeName: entityNodeName,
            parentFieldPathForEntityReference: [sharedFieldPath],
            success: false,
            typeName: entityNode.typeName,
            unresolvableFieldPaths: isFieldShared ? unresolvableSharedFieldPaths : walker.unresolvableFieldPaths,
          };
          this.failureResultByEntityNodeName.set(entityNodeName, failureResult);
          continue;
        }
        // In a shared path, only a single instance need succeed
        failureResult = undefined;
        break;
      }
      if (failureResult) {
        if (isFieldShared && sharedResolvableFieldNamesByRelativeFieldPath) {
          this.resolvableFieldNamesByRelativeFieldPathByEntityNodeName.set(
            failureResult.nodeName,
            sharedResolvableFieldNamesByRelativeFieldPath,
          );
        }
        return failureResult;
      }
    }
    if (nestedEntityNodeNamesBySharedFieldPathByParentNodeName.size > 0) {
      for (const [
        parentNodeName,
        fieldPathsByNestedNodeName,
      ] of nestedEntityNodeNamesBySharedFieldPathByParentNodeName) {
        const result = this.validateEntities(fieldPathsByNestedNodeName, rootFieldData);
        if (result.success) {
          continue;
        }
        for (const [sharedFieldPath, entityNodeNames] of entityNodeNamesBySharedFieldPath) {
          if (!entityNodeNames.has(parentNodeName)) {
            continue;
          }
          result.parentFieldPathForEntityReference.push(sharedFieldPath);
          break;
        }
        return result;
      }
    }
    return { success: true };
  }

  validate(): Array<Error> {
    const errors: Array<Error> = [];
    for (const rootNode of this.rootNodeByRootTypeName.values()) {
      shareableRootFieldLoop: for (const [
        rootFieldName,
        shareableRootFieldEdges,
      ] of rootNode.headToShareableTailEdges) {
        for (const rootFieldEdge of shareableRootFieldEdges) {
          if (rootFieldEdge.isInaccessible) {
            continue shareableRootFieldLoop;
          }
          this.walkerIndex += 1;
          this.visitEdge(rootFieldEdge, `${rootNode.typeName.toLowerCase()}`);
        }
        const fieldData = getOrThrowError(rootNode.fieldDataByFieldName, rootFieldName, 'fieldDataByFieldName');
        const rootFieldData = newRootFieldData(rootNode.typeName, rootFieldName, fieldData.subgraphNames);
        if (this.unresolvableFieldPaths.size > 0) {
          generateResolvabilityErrors({
            unresolvableFieldPaths: this.unresolvableFieldPaths,
            nodeResolutionDataByFieldPath: this.nodeResolutionDataByFieldPath,
            rootFieldData,
            errors,
          });
        }
        if (this.entityNodeNamesBySharedFieldPath.size > 0) {
          const result = this.validateEntities(this.entityNodeNamesBySharedFieldPath, rootFieldData);
          if (!result.success) {
            this.generateEntityResolvabilityErrors(result, rootFieldData, errors);
          }
        }
        if (errors.length > 0) {
          return errors;
        }
        this.entityNodeNamesBySharedFieldPath = new Map<string, Set<string>>();
      }
    }
    return [];
  }

  // Returns true if the edge is visited and false otherwise (e.g., inaccessible)
  visitEdge(edge: Edge, fieldPath: string): boolean {
    if (edge.isInaccessible || edge.node.isInaccessible) {
      return false;
    }
    if (!add(edge.visitedIndices, this.walkerIndex) || edge.node.isLeaf) {
      return true;
    }
    if (edge.node.isAbstract) {
      this.validateAbstractNode(edge.node, `${fieldPath}.${edge.edgeName}`);
    } else {
      this.validateConcreteNode(edge.node, `${fieldPath}.${edge.edgeName}`);
    }
    return true;
  }

  validateConcreteNode(node: GraphNode, fieldPath: string) {
    if (node.headToTailEdges.size < 1) {
      return;
    }
    if (node.hasEntitySiblings) {
      getValueOrDefault(this.entityNodeNamesBySharedFieldPath, fieldPath, () => new Set<string>()).add(node.nodeName);
      return;
    }

    const resolvedFieldNames = getValueOrDefault(
      this.nodeResolutionDataByFieldPath,
      fieldPath,
      () => new NodeResolutionData(node.typeName, node.fieldDataByFieldName),
    );
    for (const [fieldName, edge] of node.headToTailEdges) {
      // Returns true if the edge was visited
      if (this.visitEdge(edge, fieldPath)) {
        resolvedFieldNames.add(fieldName);
      }
    }
    if (resolvedFieldNames.isResolved) {
      this.unresolvableFieldPaths.delete(fieldPath);
    } else {
      this.unresolvableFieldPaths.add(fieldPath);
    }
  }

  validateAbstractNode(node: GraphNode, fieldPath: string) {
    if (node.headToTailEdges.size < 1) {
      return;
    }
    for (const edge of node.headToTailEdges.values()) {
      this.visitEdge(edge, fieldPath);
    }
  }

  generateEntityResolvabilityErrors(
    result: EntityResolvabilityFailure,
    rootFieldData: RootFieldData,
    errors: Array<Error>,
  ) {
    const nodeResolutionDataByFieldPath = getOrThrowError(
      this.resolvableFieldNamesByRelativeFieldPathByEntityNodeName,
      result.nodeName,
      'resolvableFieldNamesByRelativeFieldPathByEntityNodeName',
    );
    let pathFromRoot = '';
    // Reconstruct the path
    for (const fieldPath of result.parentFieldPathForEntityReference) {
      pathFromRoot = fieldPath + pathFromRoot;
    }
    generateResolvabilityErrors({
      unresolvableFieldPaths: result.unresolvableFieldPaths,
      nodeResolutionDataByFieldPath,
      rootFieldData: rootFieldData,
      errors,
      pathFromRoot,
      entityAncestorData: result.entityAncestorData,
    });
  }
}

type WalkerOptions = {
  entityNodeNamesBySharedFieldPath: Map<string, Set<string>>;
  interSubgraphNodes: Array<GraphNode>;
  originNode: GraphNode;
  resolvableFieldNamesByRelativeFieldPathByEntityNodeName: Map<string, Map<string, NodeResolutionData>>;
  unresolvableSharedFieldPaths: Set<string>;
  walkerIndex: number;
  sharedResolvableFieldNamesByRelativeFieldPath?: Map<string, NodeResolutionData>;
};

class Walker {
  entityNodeNamesBySharedFieldPath: Map<string, Set<string>>;
  interSubgraphNodes: Array<GraphNode>;
  originNode: GraphNode;
  resolvableFieldNamesByRelativeFieldPath: Map<string, NodeResolutionData>;
  resolvableFieldNamesByRelativeFieldPathByEntityNodeName: Map<string, Map<string, NodeResolutionData>>;
  unresolvableFieldPaths = new Set<string>();
  unresolvableSharedFieldPaths: Set<string>;
  walkerIndex: number;
  sharedResolvableFieldNamesByRelativeFieldPath?: Map<string, NodeResolutionData>;

  constructor({
    entityNodeNamesBySharedFieldPath,
    interSubgraphNodes,
    originNode,
    resolvableFieldNamesByRelativeFieldPathByEntityNodeName,
    unresolvableSharedFieldPaths,
    walkerIndex,
    sharedResolvableFieldNamesByRelativeFieldPath,
  }: WalkerOptions) {
    this.entityNodeNamesBySharedFieldPath = entityNodeNamesBySharedFieldPath;
    this.interSubgraphNodes = interSubgraphNodes;
    this.originNode = originNode;
    this.resolvableFieldNamesByRelativeFieldPathByEntityNodeName =
      resolvableFieldNamesByRelativeFieldPathByEntityNodeName;
    this.resolvableFieldNamesByRelativeFieldPath = getValueOrDefault(
      this.resolvableFieldNamesByRelativeFieldPathByEntityNodeName,
      originNode.nodeName,
      () => new Map<string, NodeResolutionData>(),
    );
    this.unresolvableSharedFieldPaths = unresolvableSharedFieldPaths;
    this.walkerIndex = walkerIndex;
    this.sharedResolvableFieldNamesByRelativeFieldPath = sharedResolvableFieldNamesByRelativeFieldPath;
  }

  visitEntityNode(node: GraphNode) {
    this.validateEntityRelatedConcreteNode(node, '');
    const accessibleEntityNodeNames = node.getAllAccessibleEntityNodeNames();
    for (const sibling of this.interSubgraphNodes) {
      if (this.unresolvableFieldPaths.size < 0) {
        return;
      }
      if (!accessibleEntityNodeNames.has(sibling.nodeName)) {
        continue;
      }
      this.validateEntityRelatedConcreteNode(sibling, '');
    }
  }

  // Returns true if the edge is visited and false if it's inaccessible
  visitEntityRelatedEdge(edge: Edge, fieldPath: string) {
    if (edge.isInaccessible || edge.node.isInaccessible) {
      return false;
    }
    if (!add(edge.visitedIndices, this.walkerIndex) || edge.node.isLeaf) {
      return true;
    }
    if (edge.node.hasEntitySiblings) {
      getValueOrDefault(
        this.entityNodeNamesBySharedFieldPath,
        `${fieldPath}.${edge.edgeName}`,
        () => new Set<string>(),
      ).add(edge.node.nodeName);
      return true;
    }
    if (edge.node.isAbstract) {
      this.validateEntityRelatedAbstractNode(edge.node, `${fieldPath}.${edge.edgeName}`);
    } else {
      this.validateEntityRelatedConcreteNode(edge.node, `${fieldPath}.${edge.edgeName}`);
    }
    return true;
  }

  validateEntityRelatedConcreteNode(node: GraphNode, fieldPath: string) {
    if (node.headToTailEdges.size < 1) {
      return;
    }
    const originResolvedFieldNames = getValueOrDefault(
      this.resolvableFieldNamesByRelativeFieldPath,
      fieldPath,
      () => new NodeResolutionData(node.typeName, node.fieldDataByFieldName),
    );
    const sharedResolvedFieldNames = this.sharedResolvableFieldNamesByRelativeFieldPath
      ? getValueOrDefault(
          this.sharedResolvableFieldNamesByRelativeFieldPath,
          fieldPath,
          () => new NodeResolutionData(node.typeName, node.fieldDataByFieldName),
        )
      : undefined;
    for (const [fieldName, edge] of node.headToTailEdges) {
      // Returns true if the edge is visited
      if (this.visitEntityRelatedEdge(edge, fieldPath)) {
        originResolvedFieldNames.add(fieldName);
        sharedResolvedFieldNames?.add(fieldName);
      }
    }
    if (originResolvedFieldNames.isResolved) {
      this.unresolvableFieldPaths.delete(fieldPath);
    } else {
      this.unresolvableFieldPaths.add(fieldPath);
    }
    if (!sharedResolvedFieldNames) {
      return;
    }
    if (sharedResolvedFieldNames.isResolved) {
      this.unresolvableSharedFieldPaths.delete(fieldPath);
    } else {
      this.unresolvableSharedFieldPaths.add(fieldPath);
    }
  }

  validateEntityRelatedAbstractNode(node: GraphNode, fieldPath: string) {
    if (node.headToTailEdges.size < 1) {
      return;
    }
    for (const edge of node.headToTailEdges.values()) {
      this.visitEntityRelatedEdge(edge, fieldPath);
    }
  }
}
