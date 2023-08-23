import dagre from "dagre";
import { Subgraph } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useCallback, useContext, useEffect, useState } from "react";
import ReactFlow, {
  Background,
  ConnectionLineType,
  Edge,
  Node,
  Panel,
  Position,
  addEdge,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from "reactflow";

import { cn } from "@/lib/utils";
import { ArrowsPointingInIcon } from "@heroicons/react/24/outline";
import "reactflow/dist/style.css";
import { GraphContext } from "./layout/graph-layout";
import ReactFlowGraphNode from "./reactflow-graph-node";
import { buttonVariants } from "./ui/button";

export interface Graph {
  id: string;
  kind: "graph" | "subgraph";
  name: string;
  parentId: string;
}

const nodeWidth = 110;
const nodeHeight = 45;
const nodeTypes = { span: ReactFlowGraphNode };
const defaultZoom = {
  minZoom: 0.7,
  maxZoom: 1.6,
  padding: 0.5,
};

const getLayoutedElements = (
  dagreGraph: dagre.graphlib.Graph,
  nodes: Node[],
  edges: Edge[]
) => {
  dagreGraph.setGraph({
    rankdir: "TB",
    nodesep: 15,
    ranksep: 10,
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: nodeWidth,
      height: nodeHeight,
    });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node: Node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.targetPosition = Position.Top;
    node.sourcePosition = Position.Bottom;

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

function GraphVisualization() {
  const graphData = useContext(GraphContext);
  const reactFlowInstance = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    if (!graphData?.graph) return;

    const buildGraphs = (subgraphs: Subgraph[]): Graph[] => {
      const graphs: Graph[] = [
        {
          id: `root-${graphData.graph?.name}`,
          kind: "graph",
          name: graphData.graph?.name!,
          parentId: "",
        },
      ];
      for (const subgraph of subgraphs) {
        graphs.push({
          id: `root-${graphData.graph?.name}-${subgraph.name}}`,
          kind: "subgraph",
          name: subgraph.name,
          parentId: graphs[0].id,
        });
      }
      return graphs;
    };

    let graphs = buildGraphs(graphData.subgraphs);

    const buildNodes = (spans: Graph[]): Node[] => {
      return spans.map((span, index) => {
        return {
          id: span.id,
          type: "span",
          data: {
            label: span.name,
            kind: span.kind,
            parentId: span.parentId,
          },
          connectable: false,
          deletable: false,
          position: {
            x: 0,
            y: 0,
          },
        };
      });
    };

    const buildEdges = (spans: Graph[]): Edge[] => {
      return spans
        .filter((s) => !!s.parentId)
        .map((span, index) => {
          return {
            id: span.id,
            source: span.parentId,
            animated: true,
            target: span.id,
            type: "default",
          };
        });
    };

    if (!graphs.length) {
      return;
    }

    const n = buildNodes(graphs);
    const e = buildEdges(graphs);

    // Create a new directed graph per graph
    // otherwise a single graph will contain all nodes and edges from all graphs
    // this will cause the layout to be incorrect when not all nodes and edges have unique ids
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(function () {
      return { minlen: 5, weight: 1 };
    });

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      dagreGraph,
      n,
      e
    );

    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [graphData?.graph, graphData?.subgraphs]);

  const [nodeStates, setNodeStates, onNodesChange] = useNodesState(nodes);
  const [edgeStates, setEdgeStates, onEdgesChange] = useEdgesState(edges);

  const onConnect = useCallback(
    (params: Edge) =>
      setEdges((eds) =>
        addEdge(
          { ...params, type: ConnectionLineType.SmoothStep, animated: true },
          eds
        )
      ),
    []
  );

  useEffect(() => {
    setNodeStates(nodes);
    setEdgeStates(edges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  useEffect(() => {
    if (nodesInitialized) {
      reactFlowInstance.fitView(defaultZoom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesInitialized]);

  return (
    <ReactFlow
      nodes={nodeStates}
      edges={edgeStates}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect as any}
      fitView={true}
      fitViewOptions={defaultZoom}
      connectionLineType={ConnectionLineType.SmoothStep}
      proOptions={{ hideAttribution: true }}
      attributionPosition="top-right"
      nodeTypes={nodeTypes as any}
    >
      <Background />
      <Panel
        position="bottom-left"
        onClick={() => reactFlowInstance.fitView(defaultZoom)}
      >
        <ArrowsPointingInIcon
          className={cn(
            buttonVariants({ variant: "secondary", size: "icon" }),
            "h-8 w-8 shrink-0 cursor-pointer select-none p-1.5"
          )}
          title="Center"
        />
      </Panel>
    </ReactFlow>
  );
}

export default GraphVisualization;
