import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn, nsToTime } from '@/lib/utils';
import { ArrowsPointingInIcon } from '@heroicons/react/24/outline';
import { sentenceCase } from 'change-case';
import { LuClock, LuGitFork, LuListOrdered, LuNetwork, LuServer } from 'react-icons/lu';
import dagre from 'dagre';
import { useCallback, useEffect, useId } from 'react';
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
} from 'reactflow';
import 'reactflow/dist/style.css';
import { CodeViewer } from '../code-viewer';
import { Badge } from '../ui/badge';
import { Button, buttonVariants } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { ARTFetchNode, DeferExecutionStatus, QueryPlanFetchTypeNode } from './types';
import { ViewHeaders } from './view-headers';
import { ViewInput } from './view-input';
import { ViewLoadStats } from './view-load-stats';
import { ViewOutput } from './view-output';

const getLayoutedElements = (
  nodes: Node[],
  edges: Edge[],
  direction: 'LR' | 'TB',
  nodeWidth: number,
  nodeHeight: number,
) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(function () {
    return { minlen: 4, weight: 1 };
  });

  dagreGraph.setGraph({ rankdir: direction, nodesep: 15 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node: Node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.targetPosition = direction === 'LR' ? Position.Left : Position.Top;
    node.sourcePosition = direction === 'LR' ? Position.Right : Position.Bottom;

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

// Map a fetch duration (nanoseconds) to a 0..1 weight on a log scale so that
// ~1ms reads as light and ~1s reads as heavy. The ART graph's whole point is to
// show where time goes, so slow hops get thicker, warmer edges.
const durationToWeight = (durationNanoseconds?: number) => {
  if (!durationNanoseconds || durationNanoseconds <= 0) {
    return 0;
  }
  const ms = durationNanoseconds / 1e6;
  return Math.max(0, Math.min(1, Math.log10(ms + 1) / 3));
};

export function ARTCustomEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps<ARTFetchNode>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const weight = durationToWeight(data?.durationLoad);
  const isSlow = weight >= 0.67;
  const isMedium = weight >= 0.34 && weight < 0.67;

  // Every edge stays clearly visible; latency only adds emphasis (thicker, and pink
  // for the slowest hops). Do NOT use the inline `hsl(var(--x) / a)` alpha-slash form
  // for the stroke — it is not honored as an inline SVG stroke and silently resolves
  // to `none`, hiding the edge. Use solid theme colors only.
  const edgeStyle = {
    ...style,
    strokeWidth: isSlow ? 4 : isMedium ? 2.75 : 1.5,
    stroke: isSlow ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
  };

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={edgeStyle} />
      {data?.durationLoad && Number.isInteger(data?.durationLoad) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <div
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-medium tabular-nums',
                isSlow
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : isMedium
                    ? 'bg-primary/20 text-foreground'
                    : 'bg-secondary text-secondary-foreground',
              )}
            >
              {nsToTime(BigInt(data.durationLoad))}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const deferStatusVariant = (status: DeferExecutionStatus) => {
  switch (status) {
    case 'completed':
      return 'success' as const;
    case 'error':
      return 'destructive' as const;
    case 'skipped':
      return 'muted' as const;
    default:
      return 'secondary' as const;
  }
};

const deferLabel = (defer: NonNullable<ARTFetchNode['defer']>) =>
  defer.label ? `Defer · ${defer.label}` : `Defer #${defer.id}`;

// Structural nodes describe how fetches are scheduled. They are scaffolding, not
// content, so they stay quiet and carry an icon that names the scheduling shape.
const structuralMeta = (type: string) => {
  switch (type) {
    case 'Sequence':
      return { Icon: LuListOrdered, label: 'Sequence', hint: 'Steps run one after another' };
    case 'Parallel':
      return { Icon: LuGitFork, label: 'Parallel', hint: 'Branches run at the same time' };
    case 'ParallelList':
      return { Icon: LuGitFork, label: 'Parallel list', hint: 'List items resolved concurrently' };
    default:
      return { Icon: LuNetwork, label: sentenceCase(type), hint: '' };
  }
};

export const ReactFlowARTMultiFetchNode = ({ data }: Node<Pick<ARTFetchNode, 'id' | 'type' | 'defer'>>) => {
  if (data.defer) {
    return (
      <>
        <Handle type="target" position={Position.Left} isConnectable={false} />
        <div className="flex flex-col gap-1 rounded-2xl border border-primary/40 bg-primary/15 px-5 py-3 backdrop-blur-lg">
          <div className="flex items-center gap-2">
            <LuClock className="h-5 w-5 shrink-0 text-primary" />
            <p className="text-base font-medium text-foreground">{deferLabel(data.defer)}</p>
            {data.defer.status && <Badge variant={deferStatusVariant(data.defer.status)}>{data.defer.status}</Badge>}
          </div>
          <p className="pl-7 text-xs text-muted-foreground">
            {data.defer.path.length ? data.defer.path.join('.') : 'response root'}
          </p>
        </div>
        <Handle type="source" position={Position.Right} isConnectable={false} />
      </>
    );
  }

  const { Icon, label, hint } = structuralMeta(data.type);

  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-4 py-2 text-base font-medium text-muted-foreground backdrop-blur-lg">
              <Icon className="h-5 w-5 shrink-0" />
              <span>{label}</span>
            </div>
          </TooltipTrigger>
          {hint && <TooltipContent>{hint}</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
};

const FlagChip = ({ active, label }: { active?: boolean; label: string }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium',
      active ? 'bg-primary/15 text-primary' : 'bg-muted/60 text-muted-foreground/70',
    )}
  >
    <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-primary' : 'bg-muted-foreground/40')} />
    {label}
  </span>
);

export const ReactFlowARTFetchNode = ({ data }: Node<ARTFetchNode>) => {
  const statusCode = data.outputTrace?.response?.statusCode;
  const isFailure = (statusCode ?? 0) >= 400;
  const showFlags = !data.plannedOnly && data.executionTracePresent !== false;

  return (
    <TooltipProvider>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div
        className={cn('relative flex w-[340px] flex-col overflow-hidden rounded-xl border text-secondary-foreground', {
          '!border-destructive': isFailure,
        })}
      >
        <div className="absolute inset-0 -z-10 bg-secondary/30 backdrop-blur-lg" />
        <div className="flex items-start justify-between gap-x-3 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <LuServer className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium subpixel-antialiased">{data.dataSourceName}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {sentenceCase(data.type)} fetch
              </p>
            </div>
          </div>
          {data.outputTrace && <Badge variant={isFailure ? 'destructive' : 'success'}>{statusCode}</Badge>}
        </div>
        <div className="flex flex-col gap-2 px-4 py-3 text-sm">
          {data.plannedOnly && (
            <Badge variant="muted" className="w-fit">
              Not executed (defer skipped)
            </Badge>
          )}
          {!data.plannedOnly && data.executionTracePresent === false && (
            <Badge variant="muted" className="w-fit">
              Planned fetch (no execution data)
            </Badge>
          )}
          {data.outputTrace && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                {data.outputTrace.request.method}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="min-w-0 truncate font-mono">{data.outputTrace.request.url}</span>
                </TooltipTrigger>
                <TooltipContent>{data.outputTrace.request.url}</TooltipContent>
              </Tooltip>
            </div>
          )}
          {showFlags && (
            <div className="flex flex-wrap gap-1.5">
              <FlagChip active={data.singleFlightUsed} label="Single flight" />
              <FlagChip active={data.singleFlightSharedResponse} label="Shared response" />
              <FlagChip active={data.loadSkipped} label="Load skipped" />
            </div>
          )}
        </div>
        {(data.outputTrace || data.input || data.rawInput || data.output) && (
          <div className="grid grid-cols-2 gap-2 border-t px-4 py-3">
            {data.outputTrace && (
              <ViewHeaders
                requestHeaders={JSON.stringify(data.outputTrace.request.headers)}
                responseHeaders={JSON.stringify(data.outputTrace.response.headers)}
                asChild
              />
            )}
            {(data.input || data.rawInput) && <ViewInput input={data.input} rawInput={data.rawInput} asChild />}
            {data.output && <ViewOutput output={data.output} asChild />}
            {data.loadStats && <ViewLoadStats loadStats={data.loadStats} asChild />}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </TooltipProvider>
  );
};

export const ReactFlowQueryPlanFetchNode = ({ data }: Node<QueryPlanFetchTypeNode>) => {
  const title = data.defer
    ? data.defer.label
      ? `Defer · ${data.defer.label}`
      : `Defer #${data.defer.id}`
    : `${data.fetch?.kind || data.kind}${
        ['Parallel', 'Sequence', 'ParallelList', 'Trigger'].includes(data.fetch?.kind || data.kind) ? '' : ' Fetch'
      }${data.fetch?.subgraphName ? ` from ${data.fetch.subgraphName}` : ''}`;

  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="relative flex flex-col rounded-md border text-secondary-foreground">
        <div className="absolute inset-0 -z-10 bg-secondary/30 backdrop-blur-lg" />
        <div className="flex items-start justify-between gap-x-4 border-b px-8 py-4">
          <p className="flex flex-col gap-y-2 text-sm font-medium subpixel-antialiased">
            <span>{title}</span>
            {data.defer && (
              <span className="text-xs font-normal text-muted-foreground">
                {data.defer.path.length ? data.defer.path.join('.') : 'response root'}
              </span>
            )}
          </p>
        </div>
        {data.fetch && (
          <div className="flex flex-col gap-y-1 px-2 py-2 text-sm">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary" size="sm">
                  Show query details
                </Button>
              </DialogTrigger>

              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Query Details</DialogTitle>
                </DialogHeader>
                {data.fetch.query && data.fetch.representations && (
                  <Tabs defaultValue="query" className="w-full">
                    <TabsList className="w-full">
                      <TabsTrigger className="flex-1" value="query">
                        Query
                      </TabsTrigger>
                      <TabsTrigger className="flex-1" value="representations">
                        Representations
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="query">
                      <div className="scrollbar-custom h-96 max-w-[calc(42rem_-_3rem)] overflow-auto rounded border">
                        <CodeViewer code={data.fetch.query} language="graphql" />
                      </div>
                    </TabsContent>
                    <TabsContent value="representations">
                      <div className="scrollbar-custom h-96 max-w-[calc(42rem_-_3rem)] overflow-auto rounded border">
                        <CodeViewer code={JSON.stringify(data.fetch.representations)} language="json" />
                      </div>
                    </TabsContent>
                  </Tabs>
                )}
                {data.fetch.query && !data.fetch.representations && (
                  <div className="scrollbar-custom h-96 max-w-[calc(42rem_-_3rem)] overflow-auto rounded border">
                    <CodeViewer code={data.fetch.query} language="graphql" />
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </>
  );
};

const defaultZoom = { minZoom: 0.1, maxZoom: 1 };

export function FetchFlow({
  initialNodes,
  initialEdges,
  nodeTypes,
  edgeTypes,
  direction = 'LR',
  nodeWidth = 400,
  nodeHeight = 400,
}: {
  initialNodes: Node[];
  initialEdges: Edge[];
  nodeTypes?: any;
  edgeTypes?: any;
  direction?: 'LR' | 'TB';
  nodeWidth?: number;
  nodeHeight?: number;
}) {
  const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
    initialNodes,
    initialEdges,
    direction,
    nodeWidth,
    nodeHeight,
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  const reactFlowInstance = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  const onConnect = useCallback(
    (params: Edge) =>
      setEdges((eds) => addEdge({ ...params, type: ConnectionLineType.SmoothStep, animated: true }, eds)),
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

  const id = useId();

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
      <Background id={id} />
      <Panel position="bottom-left" onClick={() => reactFlowInstance.fitView(defaultZoom)}>
        <ArrowsPointingInIcon
          className={cn(
            buttonVariants({ variant: 'secondary', size: 'icon' }),
            'h-8 w-8 shrink-0 cursor-pointer select-none p-1.5',
          )}
          title="Center"
        />
      </Panel>
    </ReactFlow>
  );
}
