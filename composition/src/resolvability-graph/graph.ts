import { Edge, EntityDataNode, GraphNode, GraphNodeOptions, RootNode } from './graph-nodes';
import {
  EntityResolvabilityFailure,
  EntityResolvabilityResult,
  generateResolvabilityErrors,
  newRootFieldData,
  RootFieldData,
} from './utils';
import { GraphFieldData, RootTypeName } from '../utils/types';
import { add, getOrThrowError, getValueOrDefault } from '../utils/utils';
import type { FieldPath, NodeName, RootCoords, TypeName, ValidateNodeResult } from './types/types';
import {
  ValidateEntityDescendantEdgeParams,
  ValidateEntityDescendantNodeParams,
  VisitEdgeParams,
  VisitNodeParams,
  WalkerParams
} from './types/params';
import { NodeResolutionData } from './node-resolution-data/node-resolution-data';
import { NOT_APPLICABLE, ROOT_TYPE_NAMES } from './constants/string-constants';

export class Graph {
  edgeId = -1;
  entityDataNodes = new Map<string, EntityDataNode>();
  entityNodeNamesBySharedFieldPath = new Map<FieldPath, Set<NodeName>>();
  nodeByNodeName = new Map<NodeName, GraphNode>();
  nodesByTypeName = new Map<TypeName, Array<GraphNode>>();
  rootNodeByTypeName = new Map<RootTypeName, RootNode>();
  subgraphName = NOT_APPLICABLE;
  resolvableFieldNamesByRelativeFieldPathByEntityNodeName = new Map<string, Map<string, NodeResolutionData>>();
  nodeResolutionDataByFieldPath = new Map<FieldPath, NodeResolutionData>();
  nodeResolutionDataByNodeName = new Map<NodeName, NodeResolutionData>();
  // Consolidate shared root fields.
  nodeResolutionDataByTypeNameAndRootCoords = new Map<TypeName, Map<RootCoords, NodeResolutionData>>();
  nodeResolutionDataByTypeNameByEntityNodeName = new Map<NodeName, Map<TypeName, NodeResolutionData>>();
  unresolvableFieldPaths = new Set<FieldPath>();
  failureResultByEntityNodeName = new Map<NodeName, EntityResolvabilityFailure>();
  walkerIndex = -1;

  constructor() {}

  getRootNode(typeName: RootTypeName): RootNode {
    return getValueOrDefault(this.rootNodeByTypeName, typeName, () => new RootNode(typeName));
  }

  addOrUpdateNode(typeName: string, options?: GraphNodeOptions): GraphNode {
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
      rootNode.fieldDataByName = fieldDataByFieldName;
      return;
    }
    const nodes = this.nodesByTypeName.get(typeName);
    if (!nodes) {
      return;
    }
    for (const node of nodes) {
      node.fieldDataByName = fieldDataByFieldName;
      node.handleInaccessibleEdges();
      node.isLeaf = false;
      if (!entityDataNode) {
        continue;
      }
      node.hasEntitySiblings = true;
      for (const fieldSet of node.satisfiedFieldSets) {
        const subgraphNames = entityDataNode.targetSubgraphNamesByFieldSet.get(fieldSet);
        for (const subgraphName of subgraphNames ?? []) {
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
    entityNodeNamesBySharedFieldPath: Map<FieldPath, Set<NodeName>>,
    rootFieldData: RootFieldData,
  ): EntityResolvabilityResult {
    const nestedEntityNodeNamesBySharedFieldPathByParentNodeName = new Map<NodeName, Map<FieldPath, Set<NodeName>>>();
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
        ? new Map<FieldPath, NodeResolutionData>()
        : undefined;
      /*
       * 2. unresolvableSharedFieldPaths is used to determine whether there are still unresolvable paths even after
       * all shared fields have been analysed.
       * */
      const unresolvableSharedFieldPaths = new Set<FieldPath>();
      /*
       * 3. nestedEntityNodeNamesBySharedFieldPath should be a reference to the same set, to ensure nested shared fields
       * are analysed as shared fields when moving deeper.
       * */
      const sharedNestedEntityNodeNamesBySharedFieldPath = new Map<FieldPath, Set<NodeName>>();
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
          () => (isFieldShared ? sharedNestedEntityNodeNamesBySharedFieldPath : new Map<FieldPath, Set<NodeName>>()),
        );
        const walker = new Walker({
          interSubgraphNodes,
          entityNodeNamesBySharedFieldPath: nestedEntityNodeNamesBySharedFieldPath,
          nodeResolutionDataByNodeName: this.nodeResolutionDataByNodeName,
          nodeResolutionDataByTypeNameByEntityNodeName: this.nodeResolutionDataByTypeNameByEntityNodeName,
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
    for (const rootNode of this.rootNodeByTypeName.values()) {
      shareableRootFieldLoop: for (const [
        rootFieldName,
        shareableRootFieldEdges,
      ] of rootNode.headToShareableTailEdges) {
        for (const rootFieldEdge of shareableRootFieldEdges) {
          if (rootFieldEdge.isInaccessible) {
            continue shareableRootFieldLoop;
          }
          this.walkerIndex += 1;
          this.visitEdge({
            edge: rootFieldEdge,
            fieldPath: rootNode.typeName.toLowerCase(),
            rootCoords: `${rootNode.typeName}.${rootFieldName}`,
          });
        }
        const fieldData = getOrThrowError(rootNode.fieldDataByName, rootFieldName, 'fieldDataByName');
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
        this.entityNodeNamesBySharedFieldPath = new Map<FieldPath, Set<NodeName>>();
      }
    }
    return [];
  }

  // Returns true if the edge is visited and false otherwise (e.g., inaccessible)
  visitEdge({ edge, fieldPath, rootCoords }: VisitEdgeParams): ValidateNodeResult {
    if (edge.isInaccessible || edge.node.isInaccessible) {
      return { visited: false, areDescendentsResolved: true };
    }
    if (edge.node.isLeaf) {
      return { visited: true, areDescendentsResolved: true };
    }
    if (!add(edge.visitedIndices, this.walkerIndex)) {
      return { visited: false, areDescendentsResolved: false };
    }
    if (edge.node.isAbstract) {
      return this.validateAbstractNode({
        node: edge.node,
        fieldPath: `${fieldPath}.${edge.edgeName}`,
        rootCoords,
      });
    }
    return this.validateConcreteNode({
      node: edge.node,
      fieldPath: `${fieldPath}.${edge.edgeName}`,
      rootCoords,
    });
  }

  validateConcreteNode({ node, fieldPath, rootCoords }: VisitNodeParams): ValidateNodeResult {
    if (node.headToTailEdges.size < 1) {
      node.isLeaf = true;
      return { visited: true, areDescendentsResolved: true };
    }
    if (node.hasEntitySiblings) {
      getValueOrDefault(this.entityNodeNamesBySharedFieldPath, fieldPath, () => new Set<NodeName>()).add(node.nodeName);
      // return { visited: true, areDescendentsResolved: false };
    }

    const dataByRootCoords = getValueOrDefault(
      this.nodeResolutionDataByTypeNameAndRootCoords,
      node.typeName,
      () => new Map<RootCoords, NodeResolutionData>,
    );
    const rootCoordsData = getValueOrDefault(
      dataByRootCoords,
      rootCoords,
      () => new NodeResolutionData({
        fieldDataByName: node.fieldDataByName,
        typeName: node.typeName,
      }),
    );
    const existingData = this.nodeResolutionDataByNodeName.get(node.nodeName);
    if (existingData) {
      return {
        visited: true,
        areDescendentsResolved: existingData.areDescendentsResolved(),
      };
    }
    if (rootCoordsData.isResolved && rootCoordsData.areDescendentsResolved()) {
      return {
        visited: true,
        areDescendentsResolved: true,
      };
    }
    const nodeNameData = getValueOrDefault(
      this.nodeResolutionDataByNodeName,
      node.nodeName,
      () => new NodeResolutionData({
        fieldDataByName: node.fieldDataByName,
        typeName: node.typeName,
      }),
    );
    const fieldPathData = getValueOrDefault(
      this.nodeResolutionDataByFieldPath,
      fieldPath,
      () => new NodeResolutionData({
        fieldDataByName: node.fieldDataByName,
        typeName: node.typeName,
      }),
    );
    for (const [fieldName, edge] of node.headToTailEdges) {
      const { visited, areDescendentsResolved } = this.visitEdge({ edge, fieldPath, rootCoords });
      if (visited) {
        fieldPathData.add(fieldName);
        rootCoordsData.add(fieldName);
        nodeNameData.add(fieldName);
      }
      if (!areDescendentsResolved) {
        continue;
      }
      fieldPathData.resolvedDescendentNames.add(fieldName);
      nodeNameData.resolvedDescendentNames.add(fieldName);
      rootCoordsData.resolvedDescendentNames.add(fieldName);
    }
    if (rootCoordsData.isResolved || nodeNameData.isResolved) {
      this.nodeResolutionDataByFieldPath.delete(fieldPath);
      this.unresolvableFieldPaths.delete(fieldPath);
    } else {
      this.unresolvableFieldPaths.add(fieldPath);
    }
    return {
      visited: true,
      areDescendentsResolved:
        rootCoordsData.areDescendentsResolved() ||
        nodeNameData.areDescendentsResolved(),
    };
  }

  validateAbstractNode({ node, fieldPath, rootCoords }: VisitNodeParams): ValidateNodeResult {
    if (node.headToTailEdges.size < 1) {
      return { visited: true, areDescendentsResolved: true };
    }
    let resolvedDescendents = 0;
    for (const edge of node.headToTailEdges.values()) {
      /* Propagate any one of the abstract path failures.
       * Don't set value in-line so or it will short-circuit.
       * */
      if (this.visitEdge({ edge, fieldPath, rootCoords }).areDescendentsResolved) {
        resolvedDescendents += 1;
      }
    }
    return {
      visited: true,
      areDescendentsResolved: resolvedDescendents === node.headToTailEdges.size,
    };
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

class Walker {
  entityNodeNamesBySharedFieldPath: Map<string, Set<string>>;
  interSubgraphNodes: Array<GraphNode>;
  nodeResolutionDataByTypeNameByEntityNodeName: Map<NodeName, Map<TypeName, NodeResolutionData>>;
  nodeResolutionDataByNodeName: Map<NodeName, NodeResolutionData>;
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
    nodeResolutionDataByTypeNameByEntityNodeName,
    nodeResolutionDataByNodeName,
    originNode,
    resolvableFieldNamesByRelativeFieldPathByEntityNodeName,
    unresolvableSharedFieldPaths,
    walkerIndex,
    sharedResolvableFieldNamesByRelativeFieldPath,
  }: WalkerParams) {
    this.entityNodeNamesBySharedFieldPath = entityNodeNamesBySharedFieldPath;
    this.interSubgraphNodes = interSubgraphNodes;
    this.nodeResolutionDataByTypeNameByEntityNodeName = nodeResolutionDataByTypeNameByEntityNodeName;
    this.nodeResolutionDataByNodeName = nodeResolutionDataByNodeName;
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

  getNodeResolutionData({ fieldDataByName, nodeName, typeName }: GraphNode): NodeResolutionData {
    const nodeResolutionData = this.nodeResolutionDataByNodeName.get(nodeName);
    if (nodeResolutionData) {
      return nodeResolutionData.copy();
    }
    return new NodeResolutionData({ fieldDataByName, typeName });
  }

  visitEntityNode(node: GraphNode) {
    const nodeResolutionDataByTypeName = getValueOrDefault(
      this.nodeResolutionDataByTypeNameByEntityNodeName,
      node.nodeName,
      () => new Map<NodeName, NodeResolutionData>(),
    );
    this.validateEntityDescendantConcreteNode({ node, nodeResolutionDataByTypeName, fieldPath: '' });
    const accessibleEntityNodeNames = node.getAllAccessibleEntityNodeNames();
    for (const sibling of this.interSubgraphNodes) {
      if (this.unresolvableFieldPaths.size < 1) {
        return;
      }
      if (!accessibleEntityNodeNames.has(sibling.nodeName)) {
        continue;
      }
      this.validateEntityDescendantConcreteNode({
        node: sibling,
        nodeResolutionDataByTypeName,
        fieldPath: '',
      });
    }
  }

  // Returns true if the edge is visited and false if it's inaccessible
  visitEntityDescendentEdge({ edge, fieldPath, nodeResolutionDataByTypeName }: ValidateEntityDescendantEdgeParams): ValidateNodeResult {
    if (edge.isInaccessible || edge.node.isInaccessible) {
      return { visited: false, areDescendentsResolved: false };
    }
    if (edge.node.isLeaf) {
      return { visited: true, areDescendentsResolved: true };
    }
    if (!add(edge.visitedIndices, this.walkerIndex)) {
      return { visited: false, areDescendentsResolved: false };
    }
    if (edge.node.hasEntitySiblings) {
      getValueOrDefault(
        this.entityNodeNamesBySharedFieldPath,
        `${fieldPath}.${edge.edgeName}`,
        () => new Set<NodeName>(),
      ).add(edge.node.nodeName);
      return { visited: true, areDescendentsResolved: false };
    }
    if (edge.node.isAbstract) {
      return this.validateEntityDescendantAbstractNode({
        fieldPath: `${fieldPath}.${edge.edgeName}`,
        node: edge.node,
        nodeResolutionDataByTypeName,
      });
    }
    return this.validateEntityDescendantConcreteNode({
      fieldPath: `${fieldPath}.${edge.edgeName}`,
      node: edge.node,
      nodeResolutionDataByTypeName
    });
  }

  validateEntityDescendantConcreteNode({ node, nodeResolutionDataByTypeName, fieldPath }: ValidateEntityDescendantNodeParams): ValidateNodeResult {
    if (node.headToTailEdges.size < 1) {
      return { visited: true, areDescendentsResolved: true };
    }
    const nodeResolutionData = getValueOrDefault(
      nodeResolutionDataByTypeName,
      node.typeName,
      () => this.getNodeResolutionData(node),
    );
    if (nodeResolutionData.isResolved) {
      this.unresolvableFieldPaths.delete(fieldPath);
      if (nodeResolutionData.areDescendentsResolved()) {
        return { visited: true, areDescendentsResolved: true };
      }
    }
    const originResolvedFieldNames = getValueOrDefault(
      this.resolvableFieldNamesByRelativeFieldPath,
      fieldPath,
      () => this.getNodeResolutionData(node),
    );
    const sharedResolvedFieldNames = this.sharedResolvableFieldNamesByRelativeFieldPath
      ? getValueOrDefault(
          this.sharedResolvableFieldNamesByRelativeFieldPath,
          fieldPath,
          () => this.getNodeResolutionData(node),
        )
      : undefined;
    for (const [fieldName, edge] of node.headToTailEdges) {
      const { visited, areDescendentsResolved } =  this.visitEntityDescendentEdge({ edge, nodeResolutionDataByTypeName, fieldPath });
      if (visited) {
        nodeResolutionData.add(fieldName);
        originResolvedFieldNames.add(fieldName);
        sharedResolvedFieldNames?.add(fieldName);
      }
      if (!areDescendentsResolved) {
        continue;
      }
      nodeResolutionData.resolvedDescendentNames.add(fieldName);
      sharedResolvedFieldNames?.resolvedDescendentNames.add(fieldName);
      // Returns true if the edge is visited
      // if (this.visitEntityDescendentEdge({ edge, nodeResolutionDataByTypeName, fieldPath })) {
      //   originResolvedFieldNames.add(fieldName);
      //   sharedResolvedFieldNames?.add(fieldName);
      // }
    }
    if (nodeResolutionData.isResolved || sharedResolvedFieldNames?.isResolved) {
      this.unresolvableFieldPaths.delete(fieldPath);
    } else {
      this.unresolvableFieldPaths.add(fieldPath);
    }
    // if (originResolvedFieldNames.isResolved) {
    //   this.unresolvableFieldPaths.delete(fieldPath);
    // } else {
    //   this.unresolvableFieldPaths.add(fieldPath);
    // }
    // if (!sharedResolvedFieldNames) {
    //   return;
    // }
    // if (sharedResolvedFieldNames.isResolved) {
    //   this.unresolvableSharedFieldPaths.delete(fieldPath);
    // } else {
    //   this.unresolvableSharedFieldPaths.add(fieldPath);
    // }
    return {
      visited: true,
      areDescendentsResolved: nodeResolutionData.areDescendentsResolved(),
    };
  }

  validateEntityDescendantAbstractNode({ node, nodeResolutionDataByTypeName, fieldPath }: ValidateEntityDescendantNodeParams): ValidateNodeResult {
    if (node.headToTailEdges.size < 1) {
      return { visited: true, areDescendentsResolved: true };
    }
    let resolvedDescendents = 0;
    for (const edge of node.headToTailEdges.values()) {
      /* Propagate any one of the abstract path failures.
       * Don't set value in-line so or it will short-circuit.
       * */
      if (this.visitEntityDescendentEdge({ edge, nodeResolutionDataByTypeName, fieldPath }).areDescendentsResolved) {
        resolvedDescendents += 1;
      }
    }
    return { visited: true, areDescendentsResolved: resolvedDescendents === node.headToTailEdges.size };
  }
}
