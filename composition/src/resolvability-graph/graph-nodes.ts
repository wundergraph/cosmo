import { getEntriesNotInHashSet, getValueOrDefault, add, GraphFieldData } from '../utils/utils';

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
  fieldDataByFieldName = new Map<string, GraphFieldData>();
  headToTailEdges = new Map<string, Edge>();
  entityEdges: Array<Edge> = [];
  nodeName: string;
  hasEntitySiblings = false;
  isAbstract: boolean;
  isInaccessible = false;
  isLeaf = false;
  isRootNode = false;
  satisfiedFieldSets = new Set<string>();
  subgraphName: string;
  typeName: string;

  constructor(subgraphName: string, typeName: string, options?: GraphNodeOptions) {
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
    const inaccessibleFieldNames = getEntriesNotInHashSet(this.headToTailEdges.keys(), this.fieldDataByFieldName);
    for (const fieldName of inaccessibleFieldNames) {
      const headToTailEdge = this.headToTailEdges.get(fieldName);
      if (!headToTailEdge) {
        continue;
      }
      headToTailEdge.isInaccessible = true;
    }
  }

  getAllAccessibleEntityNodeNames(): Set<string> {
    const accessibleEntityNodeNames = new Set<string>([this.nodeName]);
    this.getAccessibleEntityNodeNames(this, accessibleEntityNodeNames);
    accessibleEntityNodeNames.delete(this.nodeName);
    return accessibleEntityNodeNames;
  }

  getAccessibleEntityNodeNames(node: GraphNode, accessibleEntityNodeNames: Set<string>) {
    for (const edge of node.entityEdges) {
      if (!add(accessibleEntityNodeNames, edge.node.nodeName)) {
        continue;
      }
      this.getAccessibleEntityNodeNames(edge.node, accessibleEntityNodeNames);
    }
  }
}

export class RootNode {
  fieldDataByFieldName = new Map<string, GraphFieldData>();
  headToShareableTailEdges = new Map<string, Array<Edge>>();
  // It is used
  isAbstract = false;
  isRootNode = true;
  typeName: string;

  constructor(typeName: string) {
    this.typeName = typeName;
  }

  removeInaccessibleEdges(fieldDataByFieldName: Map<string, GraphFieldData>) {
    for (const [fieldName, edges] of this.headToShareableTailEdges) {
      if (fieldDataByFieldName.has(fieldName)) {
        continue;
      }
      for (const edge of edges) {
        edge.isInaccessible = true;
      }
    }
  }
}

export class EntityDataNode {
  fieldSetsByTargetSubgraphName = new Map<string, Set<string>>();
  targetSubgraphNamesByFieldSet = new Map<string, Set<string>>();
  typeName: string;

  constructor(typeName: string) {
    this.typeName = typeName;
  }

  addTargetSubgraphByFieldSet(fieldSet: string, targetSubgraphName: string) {
    getValueOrDefault(this.targetSubgraphNamesByFieldSet, fieldSet, () => new Set<string>()).add(targetSubgraphName);
    getValueOrDefault(this.fieldSetsByTargetSubgraphName, targetSubgraphName, () => new Set<string>()).add(fieldSet);
  }
}
