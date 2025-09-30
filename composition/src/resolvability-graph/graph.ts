import { Edge, EntityDataNode, GraphNode, GraphNodeOptions, RootNode } from './graph-nodes';
import {
  generateEntityResolvabilityErrors,
  generateRootResolvabilityErrors,
  generateSharedEntityResolvabilityErrors,
  getMultipliedRelativeOriginPaths,
  newRootFieldData,
} from './utils/utils';
import { GraphFieldData, RootTypeName } from '../utils/types';
import { getFirstEntry, getOrThrowError, getValueOrDefault } from '../utils/utils';
import { NodeName, SelectionPath, SubgraphName, TypeName, ValidationResult } from './types/types';
import { ConsolidateUnresolvablePathsParams, ValidateEntitiesParams, VisitEntityParams } from './types/params';
import { NodeResolutionData } from './node-resolution-data/node-resolution-data';
import { LITERAL_PERIOD, NOT_APPLICABLE, ROOT_TYPE_NAMES } from './constants/string-constants';
import { EntityWalker } from './walker/entity-walker/entity-walker';
import { RootFieldWalker } from './walker/root-field-walkers/root-field-walker';
import { EntityResolvabilityErrorsParams, EntitySharedRootFieldResolvabilityErrorsParams } from './utils/types/params';

export class Graph {
  edgeId = -1;
  entityDataNodeByTypeName = new Map<TypeName, EntityDataNode>();
  nodeByNodeName = new Map<NodeName, GraphNode>();
  nodesByTypeName = new Map<TypeName, Array<GraphNode>>();
  resolvedRootFieldNodeNames = new Set<NodeName>();
  rootNodeByTypeName = new Map<RootTypeName, RootNode>();
  subgraphName = NOT_APPLICABLE;
  resDataByNodeName = new Map<NodeName, NodeResolutionData>();
  resDataByRelativePathByEntity = new Map<NodeName, Map<SelectionPath, NodeResolutionData>>();
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
      const relativePath = unresolvableRootPath.split(pathFromRoot)[1];
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
      const rootResData = getOrThrowError(walker.resDataByPath, fullPath, `rootFieldWalker.resDataByPath`);
      entityResData.addData(rootResData);
      rootResData.addData(entityResData);
      if (!entityResData.isResolved()) {
        continue;
      }
      subgraphNameByUnresolvablePath.delete(unresolvableEntityPath);
    }
  }

  validateSharedRootFieldEntities({ rootFieldData, walker }: ValidateEntitiesParams): ValidationResult {
    for (const [pathFromRoot, entityNodeNames] of walker.entityNodeNamesByPath) {
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
          subgraphNameByUnresolvablePath,
          visitedEntities: new Set<NodeName>(),
        });
      }
      if (subgraphNameByUnresolvablePath.size < 1) {
        continue;
      }
      this.consolidateUnresolvableRootWithEntityPaths({
        pathFromRoot,
        resDataByRelativeOriginPath,
        subgraphNameByUnresolvablePath,
        walker,
      });
      this.consolidateUnresolvableEntityWithRootPaths({
        pathFromRoot,
        resDataByRelativeOriginPath,
        subgraphNameByUnresolvablePath,
        walker,
      });
      const errors = new Array<Error>();
      if (subgraphNameByUnresolvablePath.size > 0) {
        errors.push(
          ...this.getSharedEntityResolvabilityErrors({
            entityNodeNames,
            resDataByPath: resDataByRelativeOriginPath,
            pathFromRoot,
            rootFieldData,
            subgraphNameByUnresolvablePath,
          }),
        );
      }
      if (walker.unresolvablePaths.size > 0) {
        errors.push(
          ...generateRootResolvabilityErrors({
            unresolvablePaths: walker.unresolvablePaths,
            resDataByPath: walker.resDataByPath,
            rootFieldData,
          }),
        );
      }
      if (errors.length < 1) {
        continue;
      }
      return {
        errors,
        success: false,
      };
    }
    return {
      success: true,
    };
  }

  validateRootFieldEntities({ rootFieldData, walker }: ValidateEntitiesParams): ValidationResult {
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

  getSharedEntityResolvabilityErrors({
    entityNodeNames,
    pathFromRoot,
    rootFieldData,
    resDataByPath,
    subgraphNameByUnresolvablePath,
  }: EntitySharedRootFieldResolvabilityErrorsParams): Array<Error> {
    let entityTypeName: string | undefined = undefined;
    const subgraphNames = new Array<SubgraphName>();
    for (const entityNodeName of entityNodeNames) {
      const segments = entityNodeName.split(LITERAL_PERIOD);
      entityTypeName ??= segments[1];
      subgraphNames.push(segments[0]);
    }
    const { fieldSetsByTargetSubgraphName } = getOrThrowError(
      this.entityDataNodeByTypeName,
      entityTypeName,
      'entityDataNodeByTypeName',
    );
    return generateSharedEntityResolvabilityErrors({
      entityAncestors: {
        fieldSetsByTargetSubgraphName,
        subgraphNames,
        typeName: entityTypeName!,
      },
      pathFromRoot,
      resDataByPath,
      rootFieldData: rootFieldData,
      subgraphNameByUnresolvablePath,
    });
  }
}
