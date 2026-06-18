import { add } from '../utils/utils';
import { type GraphFieldData } from '../utils/types';
import { type FieldName, type NodeName, type SubgraphName, type TypeName } from './types/types';

export class Edge {
  edgeName: string;
  id: number;
  isAbstractEdge: boolean;
  isExternal = false;
  isInaccessible = false;
  // The index of the last walker to visit the edge; walker indices only ever increase.
  lastVisitedIndex = -1;
  node: GraphNode;

  constructor(id: number, node: GraphNode, edgeName: string, isAbstractEdge = false) {
    this.edgeName = isAbstractEdge ? `... on ${edgeName}` : edgeName;
    this.id = id;
    this.isAbstractEdge = isAbstractEdge;
    this.node = node;
  }

  isEdgeInaccessible(): boolean {
    return this.isInaccessible || this.node.isInaccessible;
  }
}

export type GraphNodeOptions = {
  isAbstract?: boolean;
  isLeaf?: boolean;
};

export class GraphNode {
  // Lazily allocated on first write because most nodes never populate it.
  externalFieldSets?: Set<string>;
  fieldDataByName = new Map<FieldName, GraphFieldData>();
  headToTailEdges = new Map<string, Edge>();
  // Lazily allocated on first write because most nodes never populate it.
  entityEdges?: Array<Edge>;
  nodeName: NodeName;
  hasEntitySiblings = false;
  isAbstract: boolean;
  isInaccessible = false;
  isLeaf = false;
  isRootNode = false;
  // Lazily allocated on first write because most nodes never populate it.
  satisfiedFieldSets?: Set<string>;
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
    for (const [fieldName, headToTailEdge] of this.headToTailEdges) {
      if (!this.fieldDataByName.has(fieldName)) {
        headToTailEdge.isInaccessible = true;
      }
    }
  }

  getAllAccessibleEntityNodeNames(): Set<NodeName> {
    const accessibleEntityNodeNames = new Set<NodeName>([this.nodeName]);
    this.getAccessibleEntityNodeNames(this, accessibleEntityNodeNames);
    accessibleEntityNodeNames.delete(this.nodeName);
    return accessibleEntityNodeNames;
  }

  getAccessibleEntityNodeNames(node: GraphNode, accessibleEntityNodeNames: Set<NodeName>) {
    if (!node.entityEdges) {
      return;
    }
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
    let targetSubgraphNames = this.targetSubgraphNamesByFieldSet.get(fieldSet);
    if (!targetSubgraphNames) {
      targetSubgraphNames = new Set<SubgraphName>();
      this.targetSubgraphNamesByFieldSet.set(fieldSet, targetSubgraphNames);
    }
    targetSubgraphNames.add(targetSubgraphName);
    let fieldSets = this.fieldSetsByTargetSubgraphName.get(targetSubgraphName);
    if (!fieldSets) {
      fieldSets = new Set<string>();
      this.fieldSetsByTargetSubgraphName.set(targetSubgraphName, fieldSets);
    }
    fieldSets.add(fieldSet);
  }
}
