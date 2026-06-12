import { NodeResolutionData } from '../../node-resolution-data/node-resolution-data';
import type { NodeName, SelectionPath, SubgraphName, VisitNodeResult } from '../../types/types';
import {
  type AddUnresolvablePathsParams,
  type EntityWalkerParams,
  type GetNodeResolutionDataParams,
  type PropagateVisitedFieldParams,
  type RemoveUnresolvablePathsParams,
  type VisitEntityDescendantEdgeParams,
  type VisitEntityDescendantNodeParams,
} from './types/params';
import { getValueOrDefault } from '../../../utils/utils';

export class EntityWalker {
  // Prevents registering the same entity node before there has been a chance to validate it.
  encounteredEntityNodeNames: Set<NodeName>;
  index: number;
  resDataByNodeName: Map<NodeName, NodeResolutionData>;
  resDataByRelativeOriginPath: Map<SelectionPath, NodeResolutionData>;
  resolvedPaths: Set<SelectionPath>;
  selectionPathByEntityNodeName = new Map<NodeName, SelectionPath>();
  // The subgraph name is so the propagated errors accurately reflect which subgraph cannot reach the node.
  subgraphNameByUnresolvablePath: Map<SelectionPath, SubgraphName>;
  visitedEntities: Set<NodeName>;
  relativeOriginPaths?: Set<SelectionPath>;

  constructor({
    encounteredEntityNodeNames,
    index,
    relativeOriginPaths,
    resDataByNodeName,
    resDataByRelativeOriginPath,
    resolvedPaths,
    subgraphNameByUnresolvablePath,
    visitedEntities,
  }: EntityWalkerParams) {
    this.encounteredEntityNodeNames = encounteredEntityNodeNames;
    this.index = index;
    this.relativeOriginPaths = relativeOriginPaths;
    this.resDataByNodeName = resDataByNodeName;
    this.resDataByRelativeOriginPath = resDataByRelativeOriginPath;
    this.resolvedPaths = resolvedPaths;
    this.subgraphNameByUnresolvablePath = subgraphNameByUnresolvablePath;
    this.visitedEntities = visitedEntities;
  }

  getNodeResolutionData({
    node: { fieldDataByName, nodeName, typeName },
    selectionPath,
  }: GetNodeResolutionDataParams): NodeResolutionData {
    let dataByNodeName = this.resDataByNodeName.get(nodeName);
    if (!dataByNodeName) {
      dataByNodeName = new NodeResolutionData({ fieldDataByName, typeName });
      this.resDataByNodeName.set(nodeName, dataByNodeName);
    }
    if (!this.relativeOriginPaths || this.relativeOriginPaths.size < 1) {
      let data = this.resDataByRelativeOriginPath.get(selectionPath);
      if (!data) {
        data = dataByNodeName.copy();
        this.resDataByRelativeOriginPath.set(selectionPath, data);
      }
      return data;
    }
    let returnData: NodeResolutionData | undefined = undefined;
    for (const path of this.relativeOriginPaths) {
      const fullPath = `${path}${selectionPath}`;
      let data = this.resDataByRelativeOriginPath.get(fullPath);
      if (!data) {
        data = dataByNodeName.copy();
        this.resDataByRelativeOriginPath.set(fullPath, data);
      }
      returnData ??= data;
    }
    return returnData!;
  }

  visitEntityDescendantEdge({ edge, selectionPath }: VisitEntityDescendantEdgeParams): VisitNodeResult {
    if (edge.isEdgeInaccessible()) {
      return { visited: false, areDescendantsResolved: false };
    }
    if (edge.isExternal) {
      return { visited: false, areDescendantsResolved: false, isExternal: true };
    }
    if (edge.node.isLeaf) {
      return { visited: true, areDescendantsResolved: true };
    }
    const edgeSelectionPath = `${selectionPath}.${edge.edgeName}`;

    // If the edge and all its descendants are already resolved, there is nothing further to check.
    const data = this.getNodeResolutionData({
      node: edge.node,
      selectionPath: edgeSelectionPath,
    });
    if (data.areDescendantsResolved()) {
      return { visited: true, areDescendantsResolved: true };
    }
    if (edge.lastVisitedIndex === this.index) {
      /* This check is necessary to avoid infinite loops inexpensively.
       * If the edge has been visited before, any unresolvable will be propagated by the first instance.
       * Descendant paths need to be cleaned up to avoid false positives.
       */
      this.removeUnresolvablePaths({
        selectionPath: edgeSelectionPath,
        removeDescendantPaths: true,
      });
      return { visited: true, areDescendantsResolved: true, isRevisitedNode: true };
    }
    edge.lastVisitedIndex = this.index;
    if (edge.node.hasEntitySiblings) {
      /* This check prevents infinite loops.
       * The entity is only propagated into this map after it has been assessed for resolvability.
       * Consequently, only a valid node would appear here.
       *  */
      if (this.visitedEntities.has(edge.node.nodeName) || this.encounteredEntityNodeNames.has(edge.node.nodeName)) {
        return { visited: true, areDescendantsResolved: true };
      }
      this.encounteredEntityNodeNames.add(edge.node.nodeName);
      getValueOrDefault(this.selectionPathByEntityNodeName, edge.node.nodeName, () => edgeSelectionPath);
      return { visited: true, areDescendantsResolved: false };
    }
    if (edge.node.isAbstract) {
      return this.visitEntityDescendantAbstractNode({
        node: edge.node,
        selectionPath: edgeSelectionPath,
      });
    }
    return this.visitEntityDescendantConcreteNode({
      node: edge.node,
      selectionPath: edgeSelectionPath,
    });
  }

  visitEntityDescendantConcreteNode({ node, selectionPath }: VisitEntityDescendantNodeParams): VisitNodeResult {
    if (node.headToTailEdges.size < 1) {
      node.isLeaf = true;
      return { visited: true, areDescendantsResolved: true };
    }
    const data = this.getNodeResolutionData({ node, selectionPath });
    if (data.isResolved() && data.areDescendantsResolved()) {
      return { visited: true, areDescendantsResolved: true };
    }
    let removeDescendantPaths: true | undefined = undefined;
    for (const [fieldName, edge] of node.headToTailEdges) {
      const { areDescendantsResolved, isExternal, isRevisitedNode, visited } = this.visitEntityDescendantEdge({
        edge,
        selectionPath,
      });
      removeDescendantPaths ??= isRevisitedNode;
      this.propagateVisitedField({
        areDescendantsResolved,
        data,
        fieldName,
        isExternal,
        node,
        selectionPath,
        visited,
      });
    }
    if (data.isResolved()) {
      this.removeUnresolvablePaths({ removeDescendantPaths, selectionPath });
    } else {
      this.addUnresolvablePaths({ selectionPath, subgraphName: node.subgraphName });
    }
    return {
      visited: true,
      areDescendantsResolved: data.areDescendantsResolved(),
    };
  }

  visitEntityDescendantAbstractNode({ node, selectionPath }: VisitEntityDescendantNodeParams): VisitNodeResult {
    if (node.headToTailEdges.size < 1) {
      return { visited: true, areDescendantsResolved: true };
    }
    let resolvedDescendants = 0;
    for (const edge of node.headToTailEdges.values()) {
      // Propagate any one of the abstract path failures.
      if (this.visitEntityDescendantEdge({ edge, selectionPath }).areDescendantsResolved) {
        resolvedDescendants += 1;
      }
    }
    return { visited: true, areDescendantsResolved: resolvedDescendants === node.headToTailEdges.size };
  }

  propagateVisitedField({
    areDescendantsResolved,
    data,
    fieldName,
    isExternal,
    node,
    selectionPath,
    visited,
  }: PropagateVisitedFieldParams) {
    if (isExternal) {
      data.addExternalSubgraphName({ fieldName, subgraphName: node.subgraphName });
      return;
    }
    if (!visited) {
      return;
    }
    let dataByNodeName = this.resDataByNodeName.get(node.nodeName);
    if (!dataByNodeName) {
      dataByNodeName = data.copy();
      this.resDataByNodeName.set(node.nodeName, dataByNodeName);
    }
    data.addResolvedFieldName(fieldName);
    dataByNodeName.addResolvedFieldName(fieldName);
    if (areDescendantsResolved) {
      /* Cannot propagate`areDescendantsResolved` to `dataByNodeName` because the context
       * of `data` is not isolated to the graph being walked only.
       */
      data.addResolvedDescendantName(fieldName);
    }
    if (this.relativeOriginPaths) {
      for (const originPath of this.relativeOriginPaths) {
        const fullPath = `${originPath}${selectionPath}`;
        let originData = this.resDataByRelativeOriginPath.get(fullPath);
        if (!originData) {
          originData = data.copy();
          this.resDataByRelativeOriginPath.set(fullPath, originData);
        }
        originData.addResolvedFieldName(fieldName);
        if (areDescendantsResolved) {
          originData.addResolvedDescendantName(fieldName);
          this.removeUnresolvablePaths({ selectionPath: `.${fieldName}`, removeDescendantPaths: true });
        }
      }
      return;
    }
    let originData = this.resDataByRelativeOriginPath.get(selectionPath);
    if (!originData) {
      originData = data.copy();
      this.resDataByRelativeOriginPath.set(selectionPath, originData);
    }
    originData.addResolvedFieldName(fieldName);
    if (areDescendantsResolved) {
      originData.addResolvedDescendantName(fieldName);
    }
  }

  addUnresolvablePaths({ selectionPath, subgraphName }: AddUnresolvablePathsParams) {
    if (!this.relativeOriginPaths) {
      if (this.resolvedPaths.has(selectionPath)) {
        return;
      }
      getValueOrDefault(this.subgraphNameByUnresolvablePath, selectionPath, () => subgraphName);
      return;
    }
    for (const path of this.relativeOriginPaths) {
      const fullPath = `${path}${selectionPath}`;
      if (this.resolvedPaths.has(fullPath)) {
        continue;
      }
      getValueOrDefault(this.subgraphNameByUnresolvablePath, fullPath, () => subgraphName);
    }
  }

  removeUnresolvablePaths({ selectionPath, removeDescendantPaths }: RemoveUnresolvablePathsParams) {
    if (!this.relativeOriginPaths) {
      this.subgraphNameByUnresolvablePath.delete(selectionPath);
      if (removeDescendantPaths) {
        for (const unresolvablePath of this.subgraphNameByUnresolvablePath.keys()) {
          if (unresolvablePath.startsWith(selectionPath)) {
            this.subgraphNameByUnresolvablePath.delete(unresolvablePath);
            this.resolvedPaths.add(unresolvablePath);
          }
        }
      }
      return;
    }
    for (const originPath of this.relativeOriginPaths) {
      const fullPath = `${originPath}${selectionPath}`;
      this.subgraphNameByUnresolvablePath.delete(fullPath);
      this.resolvedPaths.add(fullPath);
      if (removeDescendantPaths) {
        for (const unresolvablePath of this.subgraphNameByUnresolvablePath.keys()) {
          if (unresolvablePath.startsWith(fullPath)) {
            this.subgraphNameByUnresolvablePath.delete(unresolvablePath);
            this.resolvedPaths.add(unresolvablePath);
          }
        }
      }
    }
  }
}
