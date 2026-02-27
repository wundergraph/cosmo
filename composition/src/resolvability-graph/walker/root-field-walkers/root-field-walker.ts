import {
  GetNodeResolutionDataParams,
  PropagateVisitedFieldParams,
  PropagateVisitedSharedFieldParams,
  RootFieldWalkerParams,
  VisitEdgeParams,
  VisitNodeParams,
  VisitRootFieldEdgesParams,
} from './types/params';
import { add, getValueOrDefault } from '../../../utils/utils';
import { NodeName, SelectionPath, VisitNodeResult } from '../../types/types';
import { NodeResolutionData } from '../../node-resolution-data/node-resolution-data';

export class RootFieldWalker {
  index: number;
  resDataByNodeName: Map<NodeName, NodeResolutionData>;
  resDataByPath = new Map<SelectionPath, NodeResolutionData>();
  // Used by shared root fields.
  entityNodeNamesByPath = new Map<SelectionPath, Set<NodeName>>();
  // Used by unshared root fields.
  pathsByEntityNodeName = new Map<NodeName, Set<SelectionPath>>();
  unresolvablePaths = new Set<SelectionPath>();

  constructor({ index, nodeResolutionDataByNodeName }: RootFieldWalkerParams) {
    this.index = index;
    this.resDataByNodeName = nodeResolutionDataByNodeName;
  }

  visitEdge({ edge, selectionPath }: VisitEdgeParams): VisitNodeResult {
    if (edge.isEdgeInaccessible()) {
      return { visited: false, areDescendantsResolved: false };
    }
    if (edge.isExternal) {
      return { visited: false, areDescendantsResolved: false, isExternal: true };
    }
    if (edge.node.isLeaf) {
      return { visited: true, areDescendantsResolved: true };
    }
    if (!add(edge.visitedIndices, this.index)) {
      return { visited: true, areDescendantsResolved: true };
    }
    /* Check for siblings rather than entity edges.
     * This is because resolvable: false and unsatisfied edges are not propagated.
     * In these cases, the error message explains the specific reason the jump cannot happen.
     */
    if (edge.node.hasEntitySiblings) {
      /* This check prevents infinite loops.
       * The entity is only propagated into this map after it has been assessed for resolvability.
       * Consequently, only a valid node would appear here.
       *  */
      if (this.resDataByNodeName.has(edge.node.nodeName)) {
        return { visited: true, areDescendantsResolved: true };
      }
      getValueOrDefault(this.pathsByEntityNodeName, edge.node.nodeName, () => new Set<SelectionPath>()).add(
        `${selectionPath}.${edge.edgeName}`,
      );
      return { visited: true, areDescendantsResolved: false };
    }
    if (edge.node.isAbstract) {
      return this.visitAbstractNode({
        node: edge.node,
        selectionPath: `${selectionPath}.${edge.edgeName}`,
      });
    }
    return this.visitConcreteNode({
      node: edge.node,
      selectionPath: `${selectionPath}.${edge.edgeName}`,
    });
  }

  visitAbstractNode({ node, selectionPath }: VisitNodeParams): VisitNodeResult {
    if (node.headToTailEdges.size < 1) {
      return { visited: true, areDescendantsResolved: true };
    }
    let resolvedDescendants = 0;
    for (const edge of node.headToTailEdges.values()) {
      // Propagate any one of the abstract path failures.
      if (this.visitEdge({ edge, selectionPath }).areDescendantsResolved) {
        resolvedDescendants += 1;
      }
    }
    return {
      visited: true,
      areDescendantsResolved: resolvedDescendants === node.headToTailEdges.size,
    };
  }

  visitConcreteNode({ node, selectionPath }: VisitNodeParams): VisitNodeResult {
    if (node.headToTailEdges.size < 1) {
      node.isLeaf = true;
      return { visited: true, areDescendantsResolved: true };
    }
    const existingData = this.resDataByNodeName.get(node.nodeName);
    if (existingData) {
      return { visited: true, areDescendantsResolved: existingData.areDescendantsResolved() };
    }
    const data = this.getNodeResolutionData({ node, selectionPath });
    if (data.isResolved() && data.areDescendantsResolved()) {
      return {
        visited: true,
        areDescendantsResolved: true,
      };
    }
    for (const [fieldName, edge] of node.headToTailEdges) {
      const { areDescendantsResolved, isExternal, visited } = this.visitEdge({ edge, selectionPath });
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
      this.unresolvablePaths.delete(selectionPath);
    } else {
      this.unresolvablePaths.add(selectionPath);
    }
    return {
      visited: true,
      areDescendantsResolved: data.areDescendantsResolved(),
    };
  }

  visitSharedEdge({ edge, selectionPath }: VisitEdgeParams): VisitNodeResult {
    if (edge.isEdgeInaccessible()) {
      return { visited: false, areDescendantsResolved: false };
    }
    // if (edge.isExternal) {
    //   return { visited: false, areDescendantsResolved: false, isExternal: true };
    // }
    if (edge.node.isLeaf) {
      return { visited: true, areDescendantsResolved: true };
    }
    if (!add(edge.visitedIndices, this.index)) {
      return { visited: true, areDescendantsResolved: true };
    }
    /* Check for siblings rather than entity edges.
     * This is because resolvable: false and unsatisfied edges are not propagated.
     * In these cases, the error message explains the specific reason the jump cannot happen.
     */
    if (edge.node.hasEntitySiblings) {
      getValueOrDefault(
        this.entityNodeNamesByPath,
        `${selectionPath}.${edge.edgeName}`,
        () => new Set<SelectionPath>(),
      ).add(edge.node.nodeName);
    }
    if (edge.node.isAbstract) {
      return this.visitSharedAbstractNode({
        node: edge.node,
        selectionPath: `${selectionPath}.${edge.edgeName}`,
      });
    }
    return this.visitSharedConcreteNode({
      node: edge.node,
      selectionPath: `${selectionPath}.${edge.edgeName}`,
    });
  }

  visitSharedAbstractNode({ node, selectionPath }: VisitNodeParams): VisitNodeResult {
    if (node.headToTailEdges.size < 1) {
      return { visited: true, areDescendantsResolved: true };
    }
    let resolvedDescendants = 0;
    for (const edge of node.headToTailEdges.values()) {
      // Propagate any one of the abstract path failures.
      if (this.visitSharedEdge({ edge, selectionPath }).areDescendantsResolved) {
        resolvedDescendants += 1;
      }
    }
    return {
      visited: true,
      areDescendantsResolved: resolvedDescendants === node.headToTailEdges.size,
    };
  }

  visitSharedConcreteNode({ node, selectionPath }: VisitNodeParams): VisitNodeResult {
    if (node.headToTailEdges.size < 1) {
      node.isLeaf = true;
      return { visited: true, areDescendantsResolved: true };
    }
    const data = this.getSharedNodeResolutionData({ node, selectionPath });
    if (data.isResolved() && data.areDescendantsResolved()) {
      return {
        visited: true,
        areDescendantsResolved: true,
      };
    }
    for (const [fieldName, edge] of node.headToTailEdges) {
      const { visited, areDescendantsResolved } = this.visitSharedEdge({ edge, selectionPath });
      this.propagateSharedVisitedField({
        areDescendantsResolved,
        data,
        fieldName,
        node,
        visited,
      });
    }
    if (data.isResolved()) {
      this.unresolvablePaths.delete(selectionPath);
    } else {
      this.unresolvablePaths.add(selectionPath);
    }
    return {
      visited: true,
      areDescendantsResolved: data.areDescendantsResolved(),
    };
  }
  getNodeResolutionData({ node, selectionPath }: GetNodeResolutionDataParams): NodeResolutionData {
    const data = getValueOrDefault(
      this.resDataByNodeName,
      node.nodeName,
      () =>
        new NodeResolutionData({
          fieldDataByName: node.fieldDataByName,
          typeName: node.typeName,
        }),
    );
    getValueOrDefault(this.resDataByPath, selectionPath, () => data.copy());
    return data;
  }

  getSharedNodeResolutionData({ node, selectionPath }: GetNodeResolutionDataParams): NodeResolutionData {
    const dataByNodeName = getValueOrDefault(
      this.resDataByNodeName,
      node.nodeName,
      () =>
        new NodeResolutionData({
          fieldDataByName: node.fieldDataByName,
          typeName: node.typeName,
        }),
    );
    return getValueOrDefault(this.resDataByPath, selectionPath, () => dataByNodeName.copy());
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
    data.addResolvedFieldName(fieldName);
    const dataBySelectionPath = getValueOrDefault(
      this.resDataByPath,
      selectionPath,
      () =>
        new NodeResolutionData({
          fieldDataByName: node.fieldDataByName,
          typeName: node.typeName,
        }),
    );
    dataBySelectionPath.addResolvedFieldName(fieldName);
    if (!areDescendantsResolved) {
      return;
    }
    data.resolvedDescendantNames.add(fieldName);
    dataBySelectionPath.resolvedDescendantNames.add(fieldName);
  }

  propagateSharedVisitedField({
    areDescendantsResolved,
    data,
    fieldName,
    node,
    visited,
  }: PropagateVisitedSharedFieldParams) {
    if (!visited) {
      return;
    }
    data.addResolvedFieldName(fieldName);
    const dataByNodeName = getValueOrDefault(
      this.resDataByNodeName,
      node.nodeName,
      () =>
        new NodeResolutionData({
          fieldDataByName: node.fieldDataByName,
          typeName: node.typeName,
        }),
    );
    dataByNodeName.addResolvedFieldName(fieldName);
    if (!areDescendantsResolved) {
      return;
    }
    data.resolvedDescendantNames.add(fieldName);
    dataByNodeName.resolvedDescendantNames.add(fieldName);
  }

  visitRootFieldEdges({ edges, rootTypeName }: VisitRootFieldEdgesParams): VisitNodeResult {
    const isShared = edges.length > 1;
    for (const edge of edges) {
      if (edge.isInaccessible) {
        return { visited: false, areDescendantsResolved: false };
      }
      const result = isShared
        ? this.visitSharedEdge({ edge, selectionPath: rootTypeName })
        : this.visitEdge({ edge, selectionPath: rootTypeName });
      if (result.areDescendantsResolved) {
        return result;
      }
    }
    return { visited: true, areDescendantsResolved: false };
  }
}
