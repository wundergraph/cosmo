import { add, getEntriesNotInHashSet, getValueOrDefault } from '../utils/utils';
import { GraphFieldData } from '../utils/types';
import { FieldName, NodeName, SubgraphName, TypeName } from './types/types';

export class Edge {
  edgeName: string;
  id: number;
  isAbstractEdge: boolean;
  isInaccessible = false;
  node: GraphNode;
  visitedIndices = new Set<number>();

  constructor(id: number, node: GraphNode, edgeName: string, isAbstractEdge = false) {
    this.edgeName = isAbstractEdge ? `... on ${edgeName}` : edgeName;
    this.id = id;
    this.isAbstractEdge = isAbstractEdge;
    this.node = node;
  }
}

export type GraphNodeOptions = {
  isAbstract?: boolean;
  isLeaf?: boolean;
};

export class GraphNode {
  fieldDataByName = new Map<FieldName, GraphFieldData>();
  headToTailEdges = new Map<string, Edge>();
  entityEdges = new Array<Edge>();
  nodeName: NodeName;
  hasEntitySiblings = false;
  isAbstract: boolean;
  isInaccessible = false;
  isLeaf = false;
  isRootNode = false;
  satisfiedFieldSets = new Set<string>();
  subgraphName: SubgraphName;
  typeName: TypeName;

  constructor(subgraphName: SubgraphName, typeName: TypeName, options?: GraphNodeOptions) {
    this.isAbstract = !!options?.isAbstract;
    this.isLeaf = !!options?.isLeaf;
    this.nodeName = `${subgraphName}.${typeName}`;
    this.subgraphName = subgraphName;
    this.typeName = typeName;
  }

  handleInaccessibleEdges() {
    if (this.isAbstract) {
      return;
    }
    const inaccessibleFieldNames = getEntriesNotInHashSet(this.headToTailEdges.keys(), this.fieldDataByName);
    for (const fieldName of inaccessibleFieldNames) {
      const headToTailEdge = this.headToTailEdges.get(fieldName);
      if (!headToTailEdge) {
        continue;
      }
      headToTailEdge.isInaccessible = true;
    }
  }

  getAllAccessibleEntityNodeNames(): Set<NodeName> {
    const accessibleEntityNodeNames = new Set<NodeName>([this.nodeName]);
    this.getAccessibleEntityNodeNames(this, accessibleEntityNodeNames);
    accessibleEntityNodeNames.delete(this.nodeName);
    return accessibleEntityNodeNames;
  }

  getAccessibleEntityNodeNames(node: GraphNode, accessibleEntityNodeNames: Set<NodeName>) {
    for (const edge of node.entityEdges) {
      if (!add(accessibleEntityNodeNames, edge.node.nodeName)) {
        continue;
      }
      this.getAccessibleEntityNodeNames(edge.node, accessibleEntityNodeNames);
    }
  }
}

export class RootNode {
  fieldDataByName = new Map<FieldName, GraphFieldData>();
  headToSharedTailEdges = new Map<string, Array<Edge>>();
  // It is used
  isAbstract = false;
  isRootNode = true;
  typeName: TypeName;

  constructor(typeName: TypeName) {
    this.typeName = typeName;
  }

  removeInaccessibleEdges(fieldDataByName: Map<FieldName, GraphFieldData>) {
    for (const [fieldName, edges] of this.headToSharedTailEdges) {
      if (fieldDataByName.has(fieldName)) {
        continue;
      }
      for (const edge of edges) {
        edge.isInaccessible = true;
      }
    }
  }
}

export class EntityDataNode {
  fieldSetsByTargetSubgraphName = new Map<SubgraphName, Set<string>>();
  targetSubgraphNamesByFieldSet = new Map<string, Set<SubgraphName>>();
  typeName: string;

  constructor(typeName: string) {
    this.typeName = typeName;
  }

  addTargetSubgraphByFieldSet(fieldSet: string, targetSubgraphName: SubgraphName) {
    getValueOrDefault(this.targetSubgraphNamesByFieldSet, fieldSet, () => new Set<SubgraphName>()).add(
      targetSubgraphName,
    );
    getValueOrDefault(this.fieldSetsByTargetSubgraphName, targetSubgraphName, () => new Set<string>()).add(fieldSet);
  }
}
