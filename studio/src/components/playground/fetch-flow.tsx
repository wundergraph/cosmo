import { cn } from "@/lib/utils";
import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";
import { sentenceCase } from "change-case";
import dagre from "dagre";
import { useCallback, useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  BaseEdge,
  ConnectionLineType,
  Edge,
  EdgeLabelRenderer,
  EdgeProps,
  Handle,
  Node,
  Position,
  addEdge,
  getBezierPath,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";

export type TraceInfo = {
  startUnixSeconds: number;
};

export type FetchNode = {
  id: string;
  parentId?: string;
  type: string;
  dataSourceId?: string;
  dataSourceName?: string;
  children: FetchNode[];
  input?: any;
  rawInput?: any;
  output?: any;
  outputTrace?: {
    request: {
      method: string;
      url: string;
      headers: Record<string, Array<string>>;
    };
    response: {
      statusCode: number;
      headers: Record<string, Array<string>>;
    };
  };
  durationSinceStart?: number;
  durationSinceStartPretty?: string;
  durationLoad?: number;
  durationLoadPretty?: string;
  singleFlightUsed: boolean;
  singleFlightSharedResponse: boolean;
  loadSkipped: boolean;
};

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(function () {
  return { minlen: 4, weight: 1 };
});

const nodeWidth = 400;
const nodeHeight = 400;

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

function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps<FetchNode>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const formatDuration = (duration: string) => {
    const units = duration.slice(-2);
    const value = duration.slice(0, -2);

    const decimals = value.split(".")[1].slice(0, 3);
    return duration.split(".")[0] + "." + decimals + " " + units;
  };

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {data?.durationLoadPretty && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan"
          >
            <div className="rounded-full bg-secondary px-3 py-1.5 text-xs text-secondary-foreground">
              {formatDuration(data.durationLoadPretty)}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const ReactFlowMultiFetchNode = ({
  data,
}: Node<Pick<FetchNode, "id" | "type">>) => {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="flex flex-col rounded-full bg-primary/30 px-4 py-2 text-primary-foreground backdrop-blur-[2px]">
        <p>{sentenceCase(data.type)} Fetch</p>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
};

const ReactFlowFetchNode = ({ data }: Node<FetchNode>) => {
  const statusCode = data.outputTrace?.response?.statusCode;
  const isSuccess = statusCode?.toString().startsWith("2");

  const getIcon = (val: boolean) => {
    if (val) {
      return <CheckCircledIcon />;
    } else {
      return <CrossCircledIcon />;
    }
  };

  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div
        className={cn(
          "relative flex flex-col  border py-2 text-secondary-foreground",
          {
            "!border-destructive": !isSuccess,
          },
        )}
      >
        <div className="absolute inset-0 -z-10 bg-secondary/30 backdrop-blur-[2px]" />
        <div className="mb-2 flex items-center justify-between gap-x-4 border-b px-4 pb-2">
          <p className="text-base font-medium subpixel-antialiased">
            Fetch from {data.dataSourceName}
          </p>
          {data.outputTrace && (
            <Badge variant={isSuccess ? "success" : "destructive"}>
              {data.outputTrace?.response?.statusCode}
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-y-1 px-4 py-2 text-sm">
          <p>Fetch Type: {sentenceCase(data.type)}</p>
          {data.outputTrace && (
            <>
              <p>Method: {data.outputTrace?.request?.method}</p>
              <p>URL: {data.outputTrace?.request?.url}</p>
            </>
          )}
          <p className="flex items-center gap-x-2">
            Single Flight: {getIcon(data.singleFlightUsed)}
          </p>
          <p className="flex items-center gap-x-2">
            Single Flight Shared Response:{" "}
            {getIcon(data.singleFlightSharedResponse)}
          </p>
          <p className="flex items-center gap-x-2">
            Load Skipped: {getIcon(data.loadSkipped)}
          </p>
        </div>
        {(data.outputTrace || data.input || data.rawInput || data.output) && (
          <Separator className="mb-2" />
        )}
        <div className="flex gap-2 px-4">
          {data.outputTrace && (
            <Button variant="secondary" size="sm" className="flex-1">
              <span className="flex-shrink-0">View Headers</span>
            </Button>
          )}
          {(data.input || data.rawInput) && (
            <Button variant="secondary" size="sm" className="flex-1">
              <span className="flex-shrink-0">View Input</span>
            </Button>
          )}
          {data.output && (
            <Button variant="secondary" size="sm" className="flex-1">
              <span className="flex-shrink-0">View Output</span>
            </Button>
          )}
        </div>
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

  const nodeTypes = useMemo<any>(
    () => ({ fetch: ReactFlowFetchNode, multi: ReactFlowMultiFetchNode }),
    [],
  );

  const edgeTypes = useMemo<any>(() => ({ fetch: CustomEdge }), []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect as any}
      fitView
      fitViewOptions={{ minZoom: 0.1, maxZoom: 1 }}
      minZoom={0.1}
      maxZoom={2}
      connectionLineType={ConnectionLineType.SmoothStep}
      proOptions={{ hideAttribution: true }}
      attributionPosition="top-right"
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
    >
      <Background />
    </ReactFlow>
  );
}
