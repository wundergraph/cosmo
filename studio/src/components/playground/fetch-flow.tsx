import React, { useCallback, useEffect, useMemo } from "react";
import ReactFlow, {
  addEdge,
  Background,
  ConnectionLineType,
  Edge,
  Handle,
  Node,
  Position,
  useEdgesState,
  useNodesState,
} from "reactflow";
import dagre from "dagre";
import "reactflow/dist/style.css";

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(function () {
  return { minlen: 4, weight: 1 };
});

const nodeWidth = 160;
const nodeHeight = 100;

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  dagreGraph.setGraph({ rankdir: "LR", nodesep: 15 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node: Node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.targetPosition = Position.Left;
    node.sourcePosition = Position.Right;

    // We are shifting the dagre node position (anchor=center center) to the top left
    // so it matches the React Flow node anchor point (top left).
    node.position = {
      x: nodeWithPosition.x - nodeWidth / 2,
      y: nodeWithPosition.y - nodeHeight / 2,
    };

    return node;
  });

  return { nodes, edges };
};

const ReactFlowFetchNode = ({ data }: Node) => {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="bg-secondary px-4 py-2 text-secondary-foreground">
        {data.id} \ {data.parentId}{" "}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
};

export function FetchFlow({
  initialNodes,
  initialEdges,
}: {
  initialNodes: Node[];
  initialEdges: Edge[];
}) {
  const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
    initialNodes,
    initialEdges,
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  const onConnect = useCallback(
    (params: Edge) =>
      setEdges((eds) =>
        addEdge(
          { ...params, type: ConnectionLineType.SmoothStep, animated: true },
          eds,
        ),
      ),
    [setEdges],
  );

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const nodeTypes = useMemo<any>(() => ({ fetch: ReactFlowFetchNode }), []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect as any}
      fitView
      fitViewOptions={{ minZoom: 0.1, maxZoom: 11 }}
      minZoom={0.1}
      maxZoom={11}
      connectionLineType={ConnectionLineType.SmoothStep}
      proOptions={{ hideAttribution: true }}
      attributionPosition="top-right"
      nodeTypes={nodeTypes}
    >
      <Background />
    </ReactFlow>
  );
}
