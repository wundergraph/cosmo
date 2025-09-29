import { Edge, EntityDataNode, GraphNode, GraphNodeOptions, RootNode } from './graph-nodes';
import {
  EntityResolvabilityFailure,
  generateResolvabilityErrors,
  generateRootResolvabilityErrors,
  getMultipliedRelativeOriginPaths,
  newRootFieldData,
} from './utils/utils';
import { GraphFieldData, RootTypeName } from '../utils/types';
import { getFirstEntry, getOrThrowError, getValueOrDefault } from '../utils/utils';
import { FieldPath, NodeName, SelectionPath, SubgraphName, TypeName, ValidationResult } from './types/types';
import { VisitEntityParams } from './types/params';
import { NodeResolutionData } from './node-resolution-data/node-resolution-data';
import { LITERAL_PERIOD, NOT_APPLICABLE, ROOT_TYPE_NAMES } from './constants/string-constants';
import { EntityWalker } from './walker/entity-walker/entity-walker';
import { RootFieldWalker } from './walker/root-field-walkers/root-field-walker';
import { EntityResolvabilityErrorsParams } from './utils/types/params';

export class Graph {
  edgeId = -1;
  entityDataNodeByTypeName = new Map<TypeName, EntityDataNode>();
  entityNodeNamesBySharedFieldPath = new Map<FieldPath, Set<NodeName>>();
  nodeByNodeName = new Map<NodeName, GraphNode>();
  nodesByTypeName = new Map<TypeName, Array<GraphNode>>();
  resolvedRootFieldNodeNames = new Set<NodeName>();
  rootNodeByTypeName = new Map<RootTypeName, RootNode>();
  subgraphName = NOT_APPLICABLE;
  resolvableFieldNamesByRelativeFieldPathByEntityNodeName = new Map<string, Map<string, NodeResolutionData>>();
  nodeResolutionDataByFieldPath = new Map<FieldPath, NodeResolutionData>();
  resDataByNodeName = new Map<NodeName, NodeResolutionData>();
  resDataByRelativePathByEntity = new Map<NodeName, Map<SelectionPath, NodeResolutionData>>();
  failureResultByEntityNodeName = new Map<NodeName, EntityResolvabilityFailure>();
  unresolvableFieldPaths = new Set<FieldPath>();
  visitedEntitiesByOriginEntity = new Map<NodeName, Set<NodeName>>();
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

  addEntityDataNode(typeName: string): EntityDataNode {
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
    const entityDataNode = this.entityDataNodeByTypeName.get(typeName);
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

  visitEntity({
    encounteredEntityNodeNames,
    entityNodeName,
    relativeOriginPaths,
    resDataByRelativeOriginPath,
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
      /* Short circuiting on failures here can cause false positives.
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
        subgraphNameByUnresolvablePath,
        visitedEntities,
      });
    }
  }

  validate(): ValidationResult {
    for (const rootNode of this.rootNodeByTypeName.values()) {
      for (const [rootFieldName, sharedRootFieldEdges] of rootNode.headToSharedTailEdges) {
        const isShared = sharedRootFieldEdges.length > 1;
        if (!isShared) {
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
        if (rootFieldWalker.selectionPathsByEntityNodeName.size < 1 && rootFieldWalker.unresolvablePaths.size < 1) {
          continue;
        }
        const fieldData = getOrThrowError(rootNode.fieldDataByName, rootFieldName, 'fieldDataByName');
        const rootFieldData = newRootFieldData(rootNode.typeName, rootFieldName, fieldData.subgraphNames);
        // If there are no nested entities, then the unresolvable fields must be impossible to resolve.
        if (rootFieldWalker.selectionPathsByEntityNodeName.size < 1) {
          return {
            errors: generateRootResolvabilityErrors({
              unresolvablePaths: rootFieldWalker.unresolvablePaths,
              resDataByPath: rootFieldWalker.resDataByPath,
              rootFieldData,
            }),
            success: false,
          };
        }
        for (const [entityNodeName, selectionPaths] of rootFieldWalker.selectionPathsByEntityNodeName) {
          if (!isShared && this.resDataByNodeName.has(entityNodeName)) {
            continue;
          }
          const resDataByRelativeOriginPath = getValueOrDefault(
            this.resDataByRelativePathByEntity,
            entityNodeName,
            () => new Map<SelectionPath, NodeResolutionData>(),
          );
          const subgraphNameByUnresolvablePath = new Map<SelectionPath, SubgraphName>();
          this.visitEntity({
            encounteredEntityNodeNames: new Set<NodeName>(),
            entityNodeName,
            resDataByRelativeOriginPath: resDataByRelativeOriginPath,
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
          if (isShared) {
            // TODO
            for (const path of rootFieldWalker.unresolvablePaths) {
            }
            return {
              errors: [new Error('Shared errors')],
              success: false,
            };
          }
          return {
            errors: this.generateEntityResolvabilityErrors({
              entityNodeName,
              // Propagate errors for the first encounter only.
              pathFromRoot: getFirstEntry(selectionPaths) ?? '',
              rootFieldData,
              subgraphNameByUnresolvablePath,
            }),
            success: false,
          };
        }
      }
    }
    return {
      success: true,
    };
  }

  generateEntityResolvabilityErrors({
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
    return generateResolvabilityErrors({
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
}
