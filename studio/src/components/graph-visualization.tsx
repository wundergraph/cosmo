import dagre from 'dagre';
import {
  FederatedGraphMetrics,
  Subgraph,
  SubgraphMetrics,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  ConnectionLineType,
  Edge,
  Node,
  Panel,
  Position,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from 'reactflow';

import { cn } from '@/lib/utils';
import { ArrowsPointingInIcon } from '@heroicons/react/24/outline';
import 'reactflow/dist/style.css';
import { GraphContext } from './layout/graph-layout';
import ReactFlowGraphNode from './reactflow-graph-node';
import { Button, buttonVariants } from './ui/button';
import SubgraphMetricsEdge from '@/components/reactflow-metrics-edge';
import { useDateRangeQueryState } from '@/components/analytics/useAnalyticsQueryState';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './ui/select';
import { sentenceCase } from 'change-case';
import { useQuery } from '@connectrpc/connect-query';
import { getSubgraphMetricsErrorRate } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useRouter } from 'next/router';
import { useWorkspace } from '@/hooks/use-workspace';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { Badge } from './ui/badge';
import { Cross2Icon } from '@radix-ui/react-icons';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

export interface Graph {
  id: string;
  kind: 'graph' | 'subgraph';
  name: string;
  parentId: string;
  subgraphId?: string;
  requestRate?: number;
  errorRate?: number;
}

const nodeWidth = 120;
const nodeHeight = 80;
const nodeTypes = { span: ReactFlowGraphNode };
const edgeTypes = { metricsEdge: SubgraphMetricsEdge };
const defaultZoom = {
  minZoom: 0.7,
  maxZoom: 2,
  padding: 0.4,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getBounds = (nodes: Node[]) => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const n of nodes) {
    const w = n.width ?? nodeWidth;
    const h = n.height ?? nodeHeight;
    const x = n.position?.x ?? 0;
    const y = n.position?.y ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
};

const viewportForBounds = ({
  bounds,
  width,
  height,
  minZoom,
  maxZoom,
  padding,
}: {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  width: number;
  height: number;
  minZoom: number;
  maxZoom: number;
  padding: number;
}) => {
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const pad = 1 + padding * 2;
  const zoom = clamp(Math.min(width / (bw * pad), height / (bh * pad)), minZoom, maxZoom);
  const x = (width - bw * zoom) / 2 - bounds.minX * zoom;
  const y = (height - bh * zoom) / 2 - bounds.minY * zoom;
  return { x, y, zoom };
};

const Sparkline = ({ values }: { values: number[] }) => {
  const width = 180;
  const height = 36;
  const px = 2;
  const py = 2;

  if (!values.length) {
    return <div className="h-10 w-full rounded-md bg-muted/30" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-9, max - min);

  const toX = (i: number) => px + (i * (width - px * 2)) / Math.max(1, values.length - 1);
  const toY = (v: number) => py + (height - py * 2) - ((v - min) / span) * (height - py * 2);

  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(2)} ${toY(v).toFixed(2)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-10 w-full">
      <path d={d} fill="none" stroke="hsl(var(--destructive))" strokeWidth="1.75" opacity="0.9" />
    </svg>
  );
};

const getLayoutedElements = (dagreGraph: dagre.graphlib.Graph, nodes: Node[], edges: Edge[]) => {
  dagreGraph.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 20 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node: Node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.targetPosition = Position.Top;
    node.sourcePosition = Position.Bottom;
    node.position = {
      x: nodeWithPosition.x - nodeWidth / 2,
      y: nodeWithPosition.y - nodeHeight / 2,
    };
    return node;
  });

  return { nodes, edges };
};

function GraphVisualization({
  subgraphMetrics,
  federatedGraphMetrics,
  supportsFederation,
}: {
  subgraphMetrics?: SubgraphMetrics[];
  federatedGraphMetrics?: FederatedGraphMetrics;
  supportsFederation: boolean;
}) {
  const graphData = useContext(GraphContext);
  const reactFlowInstance = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const dr = useDateRangeQueryState();
  const router = useRouter();
  const {
    namespace: { name: namespace },
  } = useWorkspace();
  const organizationSlug = useCurrentOrganization()?.slug;
  const graphSlug = router.query.slug as string | undefined;

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [topCategory, setTopCategory] = useState('latency');
  const [selectedSubgraphName, setSelectedSubgraphName] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const graphWrapperRef = useRef<HTMLDivElement | null>(null);

  const subgraphs = useMemo(() => {
    let tempSubgraphs = [...(graphData?.subgraphs ?? [])];

    tempSubgraphs.sort((a, b) => {
      const metricA = subgraphMetrics?.find((x) => x.subgraphID === a.id);
      const metricB = subgraphMetrics?.find((x) => x.subgraphID === b.id);
      if (!metricA || !metricB) return 0;
      if (topCategory === 'latency') return metricB.latency - metricA.latency;
      if (topCategory === 'errorRate') return metricB.errorRate - metricA.errorRate;
      return metricB.requestRate - metricA.requestRate;
    });

    if (!showAll) tempSubgraphs = tempSubgraphs.slice(0, 5);
    return tempSubgraphs;
  }, [showAll, topCategory, graphData?.subgraphs, subgraphMetrics]);

  useEffect(() => {
    if (!graphData?.graph) return;

    const buildGraphs = (subgraphs: Subgraph[]): Graph[] => {
      const rootName = supportsFederation ? graphData.graph?.name : 'router';
      const graphs: Graph[] = [
        {
          id: `root-${rootName}`,
          kind: 'graph',
          name: rootName!,
          parentId: '',
          errorRate: federatedGraphMetrics?.errorRate,
          requestRate: federatedGraphMetrics?.requestRate,
        },
      ];
      for (const subgraph of subgraphs) {
        graphs.push({
          id: `root-${graphData.graph?.name}-${subgraph.name}}`,
          subgraphId: subgraph.id,
          kind: 'subgraph',
          name: subgraph.name,
          parentId: graphs[0].id,
        });
      }
      return graphs;
    };

    const graphs = buildGraphs(subgraphs);

    const buildNodes = (spans: Graph[]): Node[] =>
      spans.map((span) => {
        if (span.kind === 'graph') {
          return {
            id: span.id,
            type: 'span',
            data: {
              label: span.name,
              kind: span.kind,
              parentId: span.parentId,
              errorRate: federatedGraphMetrics?.errorRate,
              requestRate: federatedGraphMetrics?.requestRate,
            },
            connectable: false,
            deletable: false,
            position: { x: 0, y: 0 },
          };
        }
        const sm = subgraphMetrics?.find((x) => x.subgraphID === span.subgraphId);
        return {
          id: span.id,
          type: 'span',
          data: {
            label: span.name,
            kind: span.kind,
            parentId: span.parentId,
            errorRate: sm?.errorRate,
            requestRate: sm?.requestRate,
          },
          connectable: false,
          deletable: false,
          position: { x: 0, y: 0 },
        };
      });

    const buildEdges = (spans: Graph[]): Edge[] =>
      spans
        .filter((s) => !!s.parentId)
        .map((span) => {
          const sm = subgraphMetrics?.find((x) => x.subgraphID === span.subgraphId);
          return {
            id: span.id,
            source: span.parentId,
            animated: true,
            target: span.id,
            type: 'metricsEdge',
            data: { latency: sm?.latency },
          };
        });

    if (!graphs.length) return;

    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({ minlen: 5, weight: 1 }));

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(dagreGraph, buildNodes(graphs), buildEdges(graphs));
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [graphData?.graph, subgraphs, subgraphMetrics, federatedGraphMetrics, supportsFederation]);

  const [nodeStates, setNodeStates, onNodesChange] = useNodesState(nodes);
  const [edgeStates, setEdgeStates, onEdgesChange] = useEdgesState(edges);

  const onConnect = useCallback(
    (params: Edge) =>
      setEdges((eds) => addEdge({ ...params, type: ConnectionLineType.SmoothStep, animated: true }, eds)),
    [],
  );

  // Sync selected state onto nodes
  useEffect(() => {
    setNodeStates((prev) =>
      prev.map((n) => ({ ...n, selected: selectedNodeId ? n.id === selectedNodeId : false })),
    );
  }, [selectedNodeId, setNodeStates]);

  // Animate viewport when drawer opens/closes
  useEffect(() => {
    if (!nodesInitialized) return;
    if (!graphWrapperRef.current) return;

    const duration = 500;
    const padding = 0.45;
    const wrapperWidth = graphWrapperRef.current.clientWidth;
    const wrapperHeight = graphWrapperRef.current.clientHeight;
    const drawerWidth = Math.min(wrapperWidth * 0.4, 460);

    const bounds = getBounds(nodeStates);
    const baseVp = viewportForBounds({
      bounds,
      width: wrapperWidth,
      height: wrapperHeight,
      minZoom: defaultZoom.minZoom,
      maxZoom: defaultZoom.maxZoom,
      padding,
    });

    const targetVp = isDrawerOpen ? { ...baseVp, x: baseVp.x - drawerWidth / 2 } : baseVp;
    reactFlowInstance.setViewport(targetVp, { duration });
  }, [isDrawerOpen, nodesInitialized, reactFlowInstance, nodeStates]);

  // Close on Esc
  useEffect(() => {
    if (!isDrawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDrawerOpen]);

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

  // Drawer data
  const selectedSubgraph = useMemo(
    () => graphData?.subgraphs?.find((s) => s.name === selectedSubgraphName),
    [graphData?.subgraphs, selectedSubgraphName],
  );

  const selectedSubgraphMetrics = useMemo(
    () => subgraphMetrics?.find((m) => m.subgraphID === selectedSubgraph?.id),
    [selectedSubgraph?.id, subgraphMetrics],
  );

  const { data: errorRateSeriesData } = useQuery(
    getSubgraphMetricsErrorRate,
    { subgraphName: selectedSubgraph?.name ?? '', namespace, range: 1, filters: [] },
    { enabled: Boolean(isDrawerOpen && selectedSubgraph?.name) },
  );

  const last1hErrorRateValues = useMemo(
    () => (errorRateSeriesData?.series ?? []).map((p) => Number(p.errorRate ?? 0)),
    [errorRateSeriesData?.series],
  );

  const compositionLabel = useMemo(() => {
    const compositionId = graphData?.graph?.compositionId;
    const lastUpdatedAt = graphData?.graph?.lastUpdatedAt;
    if (!compositionId) return undefined;
    const short = compositionId.split('-')[0];
    const ago = lastUpdatedAt ? formatDistanceToNow(new Date(lastUpdatedAt), { addSuffix: true }) : undefined;
    return ago ? `${short} · ${ago}` : short;
  }, [graphData?.graph?.compositionId, graphData?.graph?.lastUpdatedAt]);

  const isHealthy = Number(selectedSubgraphMetrics?.errorRate ?? 0) === 0;

  const analyticsHref =
    organizationSlug && namespace && selectedSubgraph?.name && graphSlug
      ? `/${organizationSlug}/${namespace}/subgraph/${encodeURIComponent(selectedSubgraph.name)}/analytics?graph=${encodeURIComponent(graphSlug)}`
      : '#';

  const schemaHref =
    organizationSlug && namespace && selectedSubgraph?.name && graphSlug
      ? `/${organizationSlug}/${namespace}/subgraph/${encodeURIComponent(selectedSubgraph.name)}/schema?graph=${encodeURIComponent(graphSlug)}`
      : '#';

  const canNavigate = Boolean(organizationSlug && namespace && selectedSubgraph?.name && graphSlug);

  return (
    <>
      <div ref={graphWrapperRef} className="relative h-full overflow-hidden rounded-lg">
        <ReactFlow
          nodes={nodeStates}
          edges={edgeStates}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => {
            if (node?.data?.kind !== 'subgraph') return;
            const subgraphName = node.data.label as string | undefined;
            if (!subgraphName) return;
            setSelectedNodeId(node.id);
            setSelectedSubgraphName(subgraphName);
            setIsDrawerOpen(true);
          }}
          onConnect={onConnect as any}
          fitView={true}
          fitViewOptions={defaultZoom}
          connectionLineType={ConnectionLineType.SmoothStep}
          proOptions={{ hideAttribution: true }}
          attributionPosition="top-right"
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          className="h-full"
        >
          <Background />

          {/* Top gradient scrim */}
          <div className="pointer-events-none absolute left-0 top-0 z-[4] h-16 w-full">
            <div className="h-full w-full rounded-t-lg bg-gradient-to-b from-background/90 via-background/60 to-transparent backdrop-blur-sm" />
          </div>

          {/* Header */}
          <Panel position="top-left" className="relative !z-20 flex w-full flex-wrap items-center justify-between gap-2 pr-8">
            <div>
              <h2 className="flex items-center gap-x-2">
                <span className="font-semibold leading-none tracking-tight">Graph Metrics</span>
              </h2>
              <span className="text-xs text-muted-foreground">Latency & Request Per Minute (RPM)</span>
            </div>
            <div className="flex items-center gap-x-2">
              <Tabs
                defaultValue="top"
                onValueChange={(v) => setShowAll(v === 'all')}
              >
                <TabsList>
                  <TabsTrigger value="top">Top 5</TabsTrigger>
                  <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
              </Tabs>
              <Select onValueChange={(v) => setTopCategory(v)}>
                <SelectTrigger className="w-[180px] bg-background">
                  <SelectValue>{sentenceCase(topCategory)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Sort by</SelectLabel>
                    <SelectItem value="latency">Latency</SelectItem>
                    <SelectItem value="requestRate">Request Rate</SelectItem>
                    <SelectItem value="errorRate">Error Rate</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </Panel>

          {/* Re-center */}
          <Panel position="bottom-left" className="space-y-4">
            <button
              type="button"
              onClick={() => reactFlowInstance.fitView(defaultZoom)}
              className={cn(buttonVariants({ variant: 'secondary' }), 'h-8 px-2 text-xs')}
              aria-label="Re-center"
              title="Re-center"
            >
              <ArrowsPointingInIcon className="h-4 w-4" />
              <span className="ml-2 hidden sm:inline">Re-center</span>
            </button>
          </Panel>
        </ReactFlow>

        {/* In-card drawer */}
        <div
          aria-hidden={!isDrawerOpen}
          className={cn(
            'absolute inset-y-0 right-0 z-30 w-2/5 min-w-[280px] max-w-[460px] border-l bg-card/95 p-5 backdrop-blur-sm',
            'transition-transform duration-500 ease-in-out',
            isDrawerOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none',
          )}
        >
          <div className="flex h-full flex-col gap-4">

            {/* Drawer header */}
            <div className="flex items-start justify-between gap-3">
              <h3 className="truncate text-lg font-semibold text-foreground">
                {selectedSubgraph?.name ?? 'Subgraph'}
              </h3>
              <div className="flex shrink-0 items-center gap-2">
                <Badge
                  className="tracking-[0.44px]"
                  variant={isHealthy ? 'success' : 'destructive'}
                >
                  {isHealthy ? 'Healthy' : 'Degraded'}
                </Badge>
                <button
                  type="button"
                  onClick={() => setIsDrawerOpen(false)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  aria-label="Close"
                >
                  <Cross2Icon className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto pr-1">

              {/* Last 1h error rate + sparkline */}
              <div className="flex h-[68px] items-center gap-5 self-stretch rounded-lg bg-muted/30 p-3.5">
                <div className="flex w-[97px] flex-col gap-[3px]">
                  <div className="text-xs text-muted-foreground">Last 1h error rate</div>
                  <div className="text-base font-medium text-foreground">
                    {last1hErrorRateValues.length
                      ? `${last1hErrorRateValues[last1hErrorRateValues.length - 1]!.toFixed(4)} RPM`
                      : '—'}
                  </div>
                </div>
                <div className="flex flex-1 items-center self-stretch">
                  <Sparkline values={last1hErrorRateValues} />
                </div>
              </div>

              {/* 2×2 metrics */}
              <div className="relative self-stretch rounded-lg bg-muted/30 p-3.5 text-sm">
                <div className="absolute inset-x-3.5 top-1/2 h-px bg-border" />
                <div className="absolute inset-y-3.5 left-1/2 w-px bg-border" />
                <div className="grid grid-cols-2 gap-y-2.5">
                  <div className="flex flex-col gap-[3px]">
                    <div className="text-xs text-muted-foreground">Success RPM</div>
                    <div className="text-base font-medium text-foreground">
                      {Math.max(
                        0,
                        Number(selectedSubgraphMetrics?.requestRate ?? 0) - Number(selectedSubgraphMetrics?.errorRate ?? 0),
                      ).toFixed(3)}
                    </div>
                  </div>
                  <div className="flex flex-col gap-[3px] pl-3.5">
                    <div className="text-xs text-muted-foreground">Error RPM</div>
                    <div className="text-base font-medium text-foreground">
                      {Number(selectedSubgraphMetrics?.errorRate ?? 0).toFixed(3)}
                    </div>
                  </div>
                  <div className="flex flex-col gap-[3px] pt-2.5">
                    <div className="text-xs text-muted-foreground">p95 Latency</div>
                    <div className="text-base font-medium text-foreground">
                      {selectedSubgraphMetrics?.latency
                        ? `${Number(selectedSubgraphMetrics.latency).toFixed(2)} ms`
                        : '—'}
                    </div>
                  </div>
                  <div className="flex flex-col gap-[3px] pl-3.5 pt-2.5">
                    <div className="text-xs text-muted-foreground">Error %</div>
                    <div className="text-base font-medium text-foreground">
                      {(() => {
                        const req = Number(selectedSubgraphMetrics?.requestRate ?? 0);
                        const err = Number(selectedSubgraphMetrics?.errorRate ?? 0);
                        if (!req) return '0.00%';
                        return `${((err / req) * 100).toFixed(2)}%`;
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Metadata */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">ID</span>
                  <span className="font-mono text-foreground">
                    {selectedSubgraph?.id ? `…${selectedSubgraph.id.slice(-9)}` : '—'}
                  </span>
                </div>
                <div className="h-px w-full bg-border" />
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">Routing URL</span>
                  <span className="truncate text-foreground">{selectedSubgraph?.routingURL ?? '—'}</span>
                </div>
                <div className="h-px w-full bg-border" />
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">Last composition</span>
                  {compositionLabel ? (
                    <span className="flex items-center gap-1 text-foreground">
                      <span className="font-mono">{compositionLabel.split(' · ')[0]}</span>
                      <span>•</span>
                      <span>{compositionLabel.split(' · ')[1] ?? ''}</span>
                    </span>
                  ) : (
                    <span className="text-foreground">—</span>
                  )}
                </div>
                <div className="h-px w-full bg-border" />
              </div>

              {/* Action buttons */}
              <div className="mt-auto flex flex-col gap-2 pb-1">
                <Button asChild variant="default" disabled={!canNavigate}>
                  <Link href={analyticsHref}>View full Analytics</Link>
                </Button>
                <Button asChild variant="secondary" disabled={!canNavigate}>
                  <Link href={schemaHref}>View Schema</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default GraphVisualization;
