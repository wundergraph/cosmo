import { NodeResolutionData } from '../../node-resolution-data/node-resolution-data';
import type { NodeName, SelectionPath, SubgraphName, VisitNodeResult } from '../../types/types';
import {
  AddUnresolvablePathsParams,
  EntityWalkerParams,
  GetNodeResolutionDataParams,
  PropagateVisitedFieldParams,
  RemoveUnresolvablePathsParams,
  VisitEntityDescendantEdgeParams,
  VisitEntityDescendantNodeParams,
} from './types/params';
import { add, getValueOrDefault } from '../../../utils/utils';

export class EntityWalker {
  // Prevents registering the same entity node before there has been a chance to validate it.
  encounteredEntityNodeNames: Set<NodeName>;
  index: number;
  resDataByNodeName: Map<NodeName, NodeResolutionData>;
  resDataByRelativeOriginPath: Map<SelectionPath, NodeResolutionData>;
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
    subgraphNameByUnresolvablePath,
    visitedEntities,
  }: EntityWalkerParams) {
    this.encounteredEntityNodeNames = encounteredEntityNodeNames;
    this.index = index;
    this.relativeOriginPaths = relativeOriginPaths;
    this.resDataByNodeName = resDataByNodeName;
    this.resDataByRelativeOriginPath = resDataByRelativeOriginPath;
    this.visitedEntities = visitedEntities;
    this.subgraphNameByUnresolvablePath = subgraphNameByUnresolvablePath;
  }

  getNodeResolutionData({
    node: { fieldDataByName, nodeName, typeName },
    selectionPath,
  }: GetNodeResolutionDataParams): NodeResolutionData {
    const dataByNodeName = getValueOrDefault(
      this.resDataByNodeName,
      nodeName,
      () => new NodeResolutionData({ fieldDataByName, typeName }),
    );
    if (!this.relativeOriginPaths || this.relativeOriginPaths.size < 1) {
      return getValueOrDefault(this.resDataByRelativeOriginPath, selectionPath, () => dataByNodeName.copy());
    }
    let returnData: NodeResolutionData | undefined = undefined;
    for (const path of this.relativeOriginPaths) {
      const data = getValueOrDefault(this.resDataByRelativeOriginPath, `${path}${selectionPath}`, () =>
        dataByNodeName.copy(),
      );
      returnData ??= data;
    }
    return returnData!;
  }

  visitEntityDescendantEdge({ edge, selectionPath }: VisitEntityDescendantEdgeParams): VisitNodeResult {
    if (edge.isInaccessible || edge.node.isInaccessible) {
      return { visited: false, areDescendantsResolved: false };
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
    if (!add(edge.visitedIndices, this.index)) {
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
      const { visited, areDescendantsResolved, isRevisitedNode } = this.visitEntityDescendantEdge({
        edge,
        selectionPath,
      });
      removeDescendantPaths ??= isRevisitedNode;
      this.propagateVisitedField({
        areDescendantsResolved,
        fieldName,
        data,
        nodeName: node.nodeName,
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
    nodeName,
    selectionPath,
    visited,
  }: PropagateVisitedFieldParams) {
    if (!visited) {
      return;
    }
    const dataByNodeName = getValueOrDefault(this.resDataByNodeName, nodeName, () => data.copy());
    data.addResolvedFieldName(fieldName);
    dataByNodeName.addResolvedFieldName(fieldName);
    if (areDescendantsResolved) {
      /* Cannot propagate`areDescendantsResolved` to `dataByNodeName` because the context
       * of `data` is not isolated to the graph being walked only.
       */
      data.resolvedDescendantNames.add(fieldName);
    }
    if (this.relativeOriginPaths) {
      for (const originPath of this.relativeOriginPaths) {
        const originData = getValueOrDefault(this.resDataByRelativeOriginPath, `${originPath}${selectionPath}`, () =>
          data.copy(),
        );
        originData.addResolvedFieldName(fieldName);
        if (areDescendantsResolved) {
          originData.resolvedDescendantNames.add(fieldName);
          this.removeUnresolvablePaths({ selectionPath: `.${fieldName}`, removeDescendantPaths: true });
        }
      }
      return;
    }
    const originData = getValueOrDefault(this.resDataByRelativeOriginPath, selectionPath, () => data.copy());
    originData.addResolvedFieldName(fieldName);
    if (areDescendantsResolved) {
      originData.resolvedDescendantNames.add(fieldName);
    }
  }

  addUnresolvablePaths({ selectionPath, subgraphName }: AddUnresolvablePathsParams) {
    if (!this.relativeOriginPaths) {
      getValueOrDefault(this.subgraphNameByUnresolvablePath, selectionPath, () => subgraphName);
      return;
    }
    for (const path of this.relativeOriginPaths) {
      getValueOrDefault(this.subgraphNameByUnresolvablePath, `${path}${selectionPath}`, () => subgraphName);
    }
  }

  removeUnresolvablePaths({ selectionPath, removeDescendantPaths }: RemoveUnresolvablePathsParams) {
    if (!this.relativeOriginPaths) {
      this.subgraphNameByUnresolvablePath.delete(selectionPath);
      if (removeDescendantPaths) {
        for (const unresolvablePath of this.subgraphNameByUnresolvablePath.keys()) {
          if (unresolvablePath.startsWith(selectionPath)) {
            this.subgraphNameByUnresolvablePath.delete(unresolvablePath);
          }
        }
      }
      return;
    }
    for (const originPath of this.relativeOriginPaths) {
      const fullPath = `${originPath}${selectionPath}`;
      this.subgraphNameByUnresolvablePath.delete(fullPath);
      if (removeDescendantPaths) {
        for (const unresolvablePath of this.subgraphNameByUnresolvablePath.keys()) {
          if (unresolvablePath.startsWith(fullPath)) {
            this.subgraphNameByUnresolvablePath.delete(unresolvablePath);
          }
        }
      }
    }
  }
}
