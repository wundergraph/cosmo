import { nsToTime } from "@/lib/insights-helpers";
import { cn } from "@/lib/utils";
import { ArrowsPointingInIcon } from "@heroicons/react/24/outline";
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
  Panel,
  Position,
  addEdge,
  getBezierPath,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import { Badge } from "../ui/badge";
import { buttonVariants } from "../ui/button";
import { Separator } from "../ui/separator";
import { FetchNode } from "./types";
import { ViewHeaders } from "./view-headers";
import { ViewInput } from "./view-input";
import { ViewOutput } from "./view-output";
import { ViewLoadStats } from "./view-load-stats";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

const nodeWidth = 400;
const nodeHeight = 400;

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(function () {
    return { minlen: 4, weight: 1 };
  });

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

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {data?.durationLoad && Number.isInteger(data?.durationLoad) && (
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
              {nsToTime(BigInt(data.durationLoad))}
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
      <div className="flex flex-col rounded-full bg-primary/50 px-6 py-2 text-lg text-primary-foreground backdrop-blur-lg">
        <p>{sentenceCase(data.type)}</p>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
};

const ReactFlowFetchNode = ({ data }: Node<FetchNode>) => {
  const statusCode = data.outputTrace?.response?.statusCode;
  const isFailure = (statusCode ?? 0) >= 400;

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
          "relative flex flex-col  rounded-md border py-4 text-secondary-foreground",
          {
            "!border-destructive": isFailure,
          },
        )}
      >
        <div className="absolute inset-0 -z-10 bg-secondary/30 backdrop-blur-lg" />
        <div className="flex items-start justify-between gap-x-4 border-b px-4 pb-4">
          <p className="flex flex-col gap-y-2 text-base font-medium subpixel-antialiased">
            <span>Fetch from {data.dataSourceName}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {data.dataSourceId}
            </span>
          </p>
          {data.outputTrace && (
            <Badge variant={isFailure ? "destructive" : "success"}>
              {data.outputTrace?.response?.statusCode}
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-y-1 px-4 py-4 text-sm">
          <p>Fetch Type: {sentenceCase(data.type)}</p>
          {data.outputTrace && (
            <>
              <p>Method: {data.outputTrace?.request?.method}</p>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <p className="max-w-sm truncate text-left">
                      URL: {data.outputTrace?.request?.url}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent>
                    {data.outputTrace?.request?.url}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
          <Separator className="mb-4" />
        )}
        <div
          className={cn("flex gap-2 px-4", {
            "grid grid-cols-2":
              data.outputTrace &&
              (data.input || data.rawInput) &&
              data.output &&
              data.loadStats,
          })}
        >
          {data.outputTrace && (
            <ViewHeaders
              requestHeaders={JSON.stringify(data.outputTrace.request.headers)}
              responseHeaders={JSON.stringify(
                data.outputTrace.response.headers,
              )}
              asChild
            />
          )}
          {(data.input || data.rawInput) && (
            <ViewInput input={data.input} rawInput={data.rawInput} asChild />
          )}
          {data.output && <ViewOutput output={data.output} asChild />}
          {data.loadStats && (
            <ViewLoadStats loadStats={data.loadStats} asChild />
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
};

const defaultZoom = { minZoom: 0.1, maxZoom: 1 };

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

  const reactFlowInstance = useReactFlow();
  const nodesInitialized = useNodesInitialized();

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

  useEffect(() => {
    if (nodesInitialized) {
      reactFlowInstance.fitView(defaultZoom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesInitialized]);

  const nodeTypes = useMemo<any>(
    () => ({
      fetch: ReactFlowFetchNode,
      multi: ReactFlowMultiFetchNode,
    }),
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
      fitViewOptions={defaultZoom}
      minZoom={0.1}
      maxZoom={2}
      connectionLineType={ConnectionLineType.SmoothStep}
      proOptions={{ hideAttribution: true }}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
    >
      <Background />
      <Panel
        position="bottom-left"
        onClick={() => reactFlowInstance.fitView(defaultZoom)}
      >
        <ArrowsPointingInIcon
          className={cn(
            buttonVariants({ variant: "secondary", size: "icon" }),
            "h-8 w-8 shrink-0 cursor-pointer select-none p-1.5",
          )}
          title="Center"
        />
      </Panel>
    </ReactFlow>
  );
}
