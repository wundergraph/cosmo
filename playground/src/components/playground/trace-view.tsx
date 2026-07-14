import { cn } from '@/lib/utils';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { parse } from 'graphql';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BiRename } from 'react-icons/bi';
import { LuNetwork } from 'react-icons/lu';
import { useMovable } from 'react-move-hook';
import { Edge, Node, ReactFlowProvider } from 'reactflow';
import { EmptyState } from '../empty-state';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { CLI, CLISteps } from '../ui/cli';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { ARTCustomEdge, FetchFlow, ReactFlowARTFetchNode, ReactFlowARTMultiFetchNode } from './fetch-flow';
import { FetchWaterfall } from './fetch-waterfall';
import { getTraceDeliveryNotice } from './trace-delivery';
import { getTraceHeader, isSelectedSubscription, traceHeaderIncludes } from './trace-metadata';
import {
  traceDurationNanoseconds,
  traceNodeChildren,
  traceNodeIsPlannedOnly,
  tracePhaseEndNanoseconds,
} from './trace-rendering';
import { ARTFetchNode, LoadStats, QueryPlan } from './types';
import type { RequestTiming } from './use-playground-execution';

const initialPaneWidth = 360;

export const TraceContext = createContext<{
  query?: string;
  operationName?: string | null;
  subgraphs: { id: string; name: string }[];
  headers: string;
  response: string;
  requestTiming?: RequestTiming;
  plan?: QueryPlan;
  planError?: string;
  clientValidationEnabled: boolean;
  setClientValidationEnabled: (val: boolean) => void;
  forcedTheme?: 'light' | 'dark' | undefined;
}>({
  query: undefined,
  operationName: undefined,
  subgraphs: [],
  headers: '',
  response: '',
  requestTiming: undefined,
  plan: undefined,
  planError: '',
  clientValidationEnabled: true,
  setClientValidationEnabled: () => {},
  forcedTheme: undefined,
});

const Trace = ({
  view,
  headers,
  response,
  subgraphs,
}: {
  headers: any;
  response: any;
  view: 'tree' | 'waterfall';
  subgraphs: { id: string; name: string }[];
}) => {
  const [tree, setTree] = useState<ARTFetchNode>();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const [globalDuration, setGlobalDuration] = useState(BigInt(0));
  const [globalStartTime, setGlobalStartTime] = useState(BigInt(0));

  const [paneWidth, setPaneWidth] = useState(initialPaneWidth);

  const [mouseState, setMouseState] = useState({
    moving: false,
    position: { x: initialPaneWidth, y: 0 },
    delta: { x: 0, y: 0 },
  });

  const handleChange = useCallback((moveData: any) => {
    setMouseState((state) => ({
      moving: moveData.moving,
      position: moveData.stoppedMoving
        ? {
            ...state.position,
            x: state.position.x + moveData.delta.x,
            y: state.position.y + moveData.delta.y,
          }
        : state.position,
      delta: moveData.moving ? moveData.delta : undefined,
    }));

    if (!moveData.moving) {
      setPaneWidth((width) => width + moveData.delta.x);
      document.body.classList.remove('select-none');
    } else {
      document.body.classList.add('select-none');
    }
  }, []);

  const ref = useMovable({
    onChange: handleChange,
    axis: 'x',
    bounds: 'parent',
  });

  const verticalResizeStyle = {
    left: mouseState.moving ? paneWidth + mouseState.delta?.x : mouseState.position.x,
  };

  useEffect(() => {
    const tempNodes: Node[] = [];
    const tempEdges: Edge[] = [];
    let gStartTimeNano = BigInt(Number.MAX_VALUE);
    let gEndTimeNano = BigInt(0);

    let executeDurationSinceStart: number | undefined;

    const fetchMap = new Map<string, ARTFetchNode>();

    const parseFetch = (fetch: any, parentId?: string): ARTFetchNode | undefined => {
      if (!fetch) return;

      const fetchNode: ARTFetchNode = {
        id: fetch.id,
        parentId,
        type: fetch.type,
        dataSourceId: fetch.data_source_id,
        dataSourceName: subgraphs?.find((s) => s.id === fetch.data_source_id)?.name ?? 'subgraph',
        input: fetch.datasource_load_trace?.input,
        rawInput: fetch.datasource_load_trace?.raw_input_data,
        output: fetch.datasource_load_trace?.output,
        durationSinceStart: fetch.datasource_load_trace?.duration_since_start_nanoseconds,
        durationSinceStartPretty: fetch.datasource_load_trace?.duration_since_start_pretty,
        durationLoad: fetch.datasource_load_trace?.duration_load_nanoseconds,
        durationLoadPretty: fetch.datasource_load_trace?.duration_load_pretty,
        singleFlightUsed: fetch.datasource_load_trace?.single_flight_used,
        singleFlightSharedResponse: fetch.datasource_load_trace?.single_flight_shared_response,
        loadSkipped: fetch.datasource_load_trace?.load_skipped,
        children: [],
      };

      if (fetch.datasource_load_trace?.load_stats) {
        const mappedData: LoadStats = Object.entries(fetch.datasource_load_trace.load_stats).map(([key, val]: any) => {
          const durationSinceStart = val.duration_since_start_pretty;
          const idleTime = val.idle_time_pretty;

          delete val.duration_since_start_pretty;
          delete val.duration_since_start_nanoseconds;
          delete val.idle_time_pretty;
          delete val.idle_time_nanoseconds;

          return {
            name: key,
            durationSinceStart,
            attributes: val,
            idleTime,
          };
        });

        fetchNode.loadStats = mappedData;
      }

      const fetchOutputTrace = fetch.datasource_load_trace?.output?.extensions?.trace;
      if (fetchOutputTrace) {
        fetchNode.outputTrace = {
          request: {
            ...fetchOutputTrace.request,
          },
          response: {
            statusCode: fetchOutputTrace.response.status_code,
            headers: fetchOutputTrace.response.headers,
          },
        };
      }

      if (fetchNode.durationLoad && fetchNode.durationSinceStart) {
        const endTime = gStartTimeNano + BigInt(fetchNode.durationSinceStart + fetchNode.durationLoad);
        if (endTime > gEndTimeNano) {
          gEndTimeNano = endTime;
        }
      }

      if (fetch.fetches || fetch.traces) {
        (fetch.fetches || fetch.traces).forEach((f: any) => {
          const node = parseFetch(f, fetch.id);
          if (node) {
            fetchMap.set(node.id, node);
          }
        });
      }

      tempNodes.push({
        id: fetchNode.id,
        type: ['parallel', 'serial', 'parallelListItem'].includes(fetch.type) ? 'multi' : 'fetch',
        data: {
          ...fetchNode,
        },
        connectable: false,
        deletable: false,
        position: {
          x: 0,
          y: 0,
        },
      });

      tempEdges.push({
        id: `edge-${fetchNode.id}-${fetchNode.parentId}`,
        source: `${fetchNode.parentId}`,
        animated: true,
        target: `${fetchNode.id}`,
        type: 'fetch',
        data: {
          ...fetchNode,
        },
      });

      return fetchNode;
    };
    const parseJsonOld = (json: any, parentId?: string): ARTFetchNode | undefined => {
      const fetchNode = parseFetch(json.fetch, parentId);

      json.fields?.forEach((field: any) => {
        if (field.value && field.value.node_type === 'array') {
          field.value.items.forEach((fieldItem: any) => {
            if (fieldItem.node_type === 'object') {
              const node = parseJsonOld(fieldItem, fetchNode?.id ?? parentId);
              if (node) {
                fetchMap.set(node.id, node);
              }
            }
          });
        }

        if (field.value && field.value.node_type === 'object') {
          const node = parseJsonOld(field.value, fetchNode?.id ?? parentId);
          if (node) {
            fetchMap.set(node.id, node);
          }
        }
      });

      return fetchNode;
    };

    // Grouping nodes (Sequence/Parallel/ParallelList) with a single child and no defer metadata
    // add a level of nesting without conveying anything, so collapse them into their child.
    const collapseTrivialGroup = (node: ARTFetchNode): ARTFetchNode => {
      while (
        ['Parallel', 'Sequence', 'ParallelList'].includes(node.type) &&
        !node.defer &&
        node.children.length === 1
      ) {
        node = node.children[0];
      }
      return node;
    };

    const parseFetchNew = (fetch: any, parentId?: string, inheritedPlannedOnly = false): ARTFetchNode | undefined => {
      if (!fetch) return;

      const plannedOnly = traceNodeIsPlannedOnly(fetch, inheritedPlannedOnly);

      let sourceName = fetch.source_name;

      if (!sourceName) {
        // Fallback when subgraphs is set on the context. Only need as a fallback for old routers
        const source = subgraphs?.find((s) => s.id === fetch.source_id);
        if (source) {
          sourceName = source.name;
        } else {
          // For old routers that didn't send the subgraph name and when subgraphs is not set on the context
          sourceName = 'subgraph';
        }
      }

      const fetchNode: ARTFetchNode = {
        id: crypto.randomUUID(),
        parentId,
        type: fetch.kind,
        dataSourceId: fetch.source_id,
        dataSourceName: sourceName,
        input: fetch.trace?.input,
        rawInput: fetch.trace?.raw_input_data,
        output: fetch.trace?.output,
        durationSinceStart: fetch.trace?.duration_since_start_nanoseconds,
        durationSinceStartPretty: fetch.trace?.duration_since_start_pretty,
        durationLoad: fetch.trace?.duration_load_nanoseconds,
        durationLoadPretty: fetch.trace?.duration_load_pretty,
        singleFlightUsed: fetch.trace?.single_flight_used,
        singleFlightSharedResponse: fetch.trace?.single_flight_shared_response,
        loadSkipped: fetch.trace?.load_skipped,
        defer: fetch.defer
          ? {
              ...fetch.defer,
              path: [...(fetch.defer.path ?? [])],
            }
          : undefined,
        plannedOnly,
        executionTracePresent: !!fetch.trace,
        children: [],
      };

      if (!plannedOnly && executeDurationSinceStart === undefined && fetchNode.durationSinceStart !== undefined) {
        executeDurationSinceStart = fetchNode.durationSinceStart;
      }

      if (fetch.trace?.load_stats) {
        const mappedData: LoadStats = Object.entries(fetch.trace.load_stats).map(([key, val]: any) => {
          const durationSinceStart = val.duration_since_start_pretty;
          const idleTime = val.idle_time_pretty;

          delete val.duration_since_start_pretty;
          delete val.duration_since_start_nanoseconds;
          delete val.idle_time_pretty;
          delete val.idle_time_nanoseconds;

          return {
            name: key,
            durationSinceStart,
            attributes: val,
            idleTime,
          };
        });

        fetchNode.loadStats = mappedData;
      }

      const fetchOutputTrace = fetch.trace?.output?.extensions?.trace;
      if (fetchOutputTrace) {
        fetchNode.outputTrace = {
          request: {
            ...fetchOutputTrace.request,
          },
          response: {
            statusCode: fetchOutputTrace.response.status_code,
            headers: fetchOutputTrace.response.headers,
          },
        };
      }

      if (fetchNode.durationLoad && fetchNode.durationSinceStart) {
        const endTime = gStartTimeNano + BigInt(fetchNode.durationSinceStart + fetchNode.durationLoad);
        if (endTime > gEndTimeNano) {
          gEndTimeNano = endTime;
        }
      }

      traceNodeChildren(fetch).forEach((f: any) => {
        const node = parseFetchNew(f.fetch || f, fetchNode.id, plannedOnly);
        if (node) {
          const collapsed = collapseTrivialGroup(node);
          if (fetchNode.type === 'ParallelList') {
            collapsed.dataSourceId = fetchNode.dataSourceId;
            collapsed.dataSourceName = fetchNode.dataSourceName;
          }
          fetchNode.children.push(collapsed);
        }
      });

      return fetchNode;
    };
    const parseJsonNew = (json: any, parentId?: string) => {
      return parseFetchNew(json.fetches?.fetch || json.fetches, parentId);
    };

    // Emit react-flow nodes/edges from the (already flattened) fetch tree, so the Tree view
    // renders the same structure as the Waterfall view.
    const emitFlowGraph = (node: ARTFetchNode) => {
      tempNodes.push({
        id: node.id,
        type: ['Parallel', 'Sequence', 'ParallelList'].includes(node.type) ? 'multi' : 'fetch',
        data: {
          ...node,
        },
        connectable: false,
        deletable: false,
        position: {
          x: 0,
          y: 0,
        },
      });

      node.children.forEach((childNode, index, children) => {
        let parent = node;
        if (node.type === 'Sequence') {
          const prevChild = children[index - 1];
          parent = prevChild || node;
        }

        tempEdges.push({
          id: `edge-${childNode.id}-${parent.id}`,
          source: `${parent.id}`,
          animated: true,
          target: `${childNode.id}`,
          type: 'fetch',
          data: {
            ...childNode,
          },
        });

        emitFlowGraph(childNode);
      });
    };

    try {
      const parsedResponse = JSON.parse(response);
      if (!parsedResponse?.extensions?.trace) {
        return;
      }

      gStartTimeNano = BigInt(parsedResponse.extensions.trace.info.trace_start_unix * 1e9);
      gEndTimeNano = gStartTimeNano;

      const parseStats = parsedResponse.extensions.trace.info.parse_stats;
      const normalizeStats = parsedResponse.extensions.trace.info.normalize_stats;
      const validateStats = parsedResponse.extensions.trace.info.validate_stats;
      const plannerStats = parsedResponse.extensions.trace.info.planner_stats;

      const parse = {
        id: 'parse',
        type: 'parse',
        durationSinceStart: parseStats.duration_since_start_nanoseconds,
        durationLoad: parseStats.duration_nanoseconds,
      } as ARTFetchNode;

      const normalize = {
        id: 'normalize',
        type: 'normalize',
        durationSinceStart: normalizeStats.duration_since_start_nanoseconds,
        durationLoad: normalizeStats.duration_nanoseconds,
      } as ARTFetchNode;

      const validate = {
        id: 'validate',
        type: 'validate',
        durationSinceStart: validateStats.duration_since_start_nanoseconds,
        durationLoad: validateStats.duration_nanoseconds,
      } as ARTFetchNode;

      const plan = {
        id: 'plan',
        type: 'plan',
        durationSinceStart: plannerStats.duration_since_start_nanoseconds,
        durationLoad: plannerStats.duration_nanoseconds,
      } as ARTFetchNode;

      const phaseEnd = tracePhaseEndNanoseconds(plannerStats);

      let traceTree: ARTFetchNode | undefined;
      if (parsedResponse.extensions.trace.version) {
        traceTree = parseJsonNew(parsedResponse.extensions.trace, plan.id);
        if (traceTree) {
          traceTree = collapseTrivialGroup(traceTree);
          emitFlowGraph(traceTree);
          tempEdges.push({
            id: `edge-${traceTree.id}-${plan.id}`,
            source: plan.id,
            animated: true,
            target: `${traceTree.id}`,
            type: 'fetch',
            data: {
              ...plan,
            },
          });
        }
      } else {
        traceTree = parseJsonOld(parsedResponse.extensions.trace, 'plan');
        if (traceTree) {
          fetchMap.set(traceTree.id, traceTree);
        }
        fetchMap.forEach((fetchNode) => {
          if (fetchNode.parentId) {
            const parent = fetchMap.get(fetchNode.parentId);
            if (parent) {
              parent.children.push(fetchNode);
            }
          }
        });
      }
      tempNodes.unshift({
        id: plan.id,
        type: 'multi',
        data: {
          ...plan,
        },
        connectable: false,
        deletable: false,
        position: {
          x: 0,
          y: 0,
        },
      });

      tempEdges.unshift({
        id: `edge-${plan.id}-${plan.parentId}`,
        source: `${plan.parentId}`,
        animated: true,
        target: `${plan.id}`,
        type: 'fetch',
        data: {
          ...plan,
        },
      });

      const traceDuration = Math.max(
        phaseEnd,
        traceDurationNanoseconds(parsedResponse.extensions.trace),
        Number(gEndTimeNano - gStartTimeNano),
      );
      const executeStart = executeDurationSinceStart ?? phaseEnd;
      const execute = {
        id: 'execute',
        type: 'execute',
        durationSinceStart: executeStart,
        durationLoad: Math.max(0, traceDuration - executeStart),
        children: traceTree ? [traceTree] : [],
      } as ARTFetchNode;

      const root = {
        id: 'root',
        type: 'graphql',
        durationLoad: traceDuration,
        children: [parse, normalize, validate, plan, execute],
      } as ARTFetchNode;

      setTree(root);
      setNodes(tempNodes);
      setEdges(tempEdges);
      setGlobalStartTime(gStartTimeNano);
      setGlobalDuration(BigInt(Math.max(0, traceDuration)));
    } catch (e) {
      console.error(e);
      return;
    }
  }, [response, subgraphs]);

  const nodeTypes = useMemo<any>(
    () => ({
      fetch: ReactFlowARTFetchNode,
      multi: ReactFlowARTMultiFetchNode,
    }),
    [],
  );

  const edgeTypes = useMemo<any>(() => ({ fetch: ARTCustomEdge }), []);

  if (view === 'waterfall' && tree) {
    if (traceHeaderIncludes(headers, 'exclude_load_stats')) {
      return (
        <EmptyState
          icon={<LuNetwork />}
          title="Cannot show waterfall view"
          description="Please omit exclude_load_stats from the header and retry"
        />
      );
    }

    return (
      <Card className="flex w-full flex-col overflow-hidden">
        <div className="scrollbar-custom relative w-full resize-none overflow-x-auto">
          <div className="flex items-center px-4 py-4">
            <span
              className="flex-shrink-0 pl-2"
              style={{
                width: `${paneWidth}px`,
              }}
            >
              Request
            </span>
            <span>Timing</span>
          </div>
          <hr className="w-full border-input" />

          <div className="absolute left-0 right-0 top-0 h-full">
            <div
              ref={ref}
              style={verticalResizeStyle}
              className={cn(
                mouseState.moving ? 'bg-primary' : 'bg-transparent',
                'absolute z-50 ml-[-9px] h-full w-[2px] cursor-col-resize border-l-2 border-transparent hover:bg-primary',
              )}
            ></div>
          </div>

          <div className="pb-4 pr-4">
            <FetchWaterfall
              fetch={tree}
              level={1}
              globalDuration={globalDuration}
              globalStartTime={globalStartTime}
              isParentDetailsOpen={false}
              paneWidth={paneWidth}
            />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <ReactFlowProvider>
      <FetchFlow initialEdges={edges} initialNodes={nodes} nodeTypes={nodeTypes} edgeTypes={edgeTypes} />
    </ReactFlowProvider>
  );
};

export const TraceView = () => {
  const { query, operationName, response, subgraphs, headers, requestTiming } = useContext(TraceContext);

  const { hasTraceInResponse, isNotIntrospection } = useMemo(() => {
    try {
      const parsedResponse = JSON.parse(response || '{}');
      return {
        hasTraceInResponse: !!parsedResponse?.extensions?.trace,
        isNotIntrospection: !parsedResponse?.data?.__schema,
      };
    } catch {
      return { hasTraceInResponse: false, isNotIntrospection: false };
    }
  }, [response]);

  const hasTraceHeader = !!getTraceHeader(headers);
  const hasTrace = hasTraceInResponse;
  const deliveryNotice = getTraceDeliveryNotice({
    phase: requestTiming?.state ?? 'idle',
    hasTrace,
    message: requestTiming?.message,
  });

  const [view, setView] = useState<'tree' | 'waterfall'>('tree');

  const isSubscription = useMemo(() => {
    try {
      return isSelectedSubscription(parse(query ?? ''), operationName);
    } catch {
      return false;
    }
  }, [operationName, query]);

  if (isSubscription) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Unsupported"
        description="Advanced Request Tracing is not supported for subscriptions"
      />
    );
  }

  if (response && !isNotIntrospection) {
    return (
      <EmptyState
        icon={<LuNetwork />}
        title="Execute a query"
        description="Include the below header to view the trace"
        actions={<CLI command={`"X-WG-TRACE" : "true"`} />}
      />
    );
  }

  if (!hasTrace && deliveryNotice?.kind === 'waiting' && hasTraceHeader) {
    return <EmptyState icon={<LuNetwork />} title={deliveryNotice.title} description={deliveryNotice.description} />;
  }

  if (!hasTrace && deliveryNotice?.kind === 'incomplete' && hasTraceHeader) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title={deliveryNotice.title}
        description={deliveryNotice.description}
      />
    );
  }

  if (!hasTrace) {
    return (
      <EmptyState
        icon={<LuNetwork />}
        title="No trace found"
        description="Please ensure the below are configured correctly"
        actions={
          <CLISteps
            steps={[
              {
                description: 'Add this environment variable to the router',
                command: `DEV_MODE=true`,
              },
              {
                description: 'Add the below header to your requests',
                command: `"X-WG-TRACE" : "true"`,
              },
            ]}
          />
        }
      />
    );
  }

  return (
    <div className="relative flex h-full w-full flex-1 flex-col font-sans">
      {deliveryNotice && deliveryNotice.kind !== 'waiting' && (
        <div className="absolute left-4 top-3 z-30 flex max-w-xl items-center gap-2 rounded-md border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
          <Badge variant={deliveryNotice.kind === 'incomplete' ? 'destructive' : 'secondary'}>
            {deliveryNotice.title}
          </Badge>
          <span className="text-xs text-muted-foreground">{deliveryNotice.description}</span>
          {!!requestTiming?.partCount && (
            <span className="text-xs text-muted-foreground">Part {requestTiming.partCount}</span>
          )}
        </div>
      )}
      <Tabs defaultValue="tree" className="absolute bottom-3 right-4 z-30 w-max" onValueChange={(v: any) => setView(v)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="tree">
            <div className="flex items-center gap-x-2">
              <LuNetwork />
              Tree View
            </div>
          </TabsTrigger>
          <TabsTrigger value="waterfall">
            <div className="flex items-center gap-x-2">
              <BiRename />
              Waterfall View
            </div>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {response && <Trace headers={headers} response={response} view={view} subgraphs={subgraphs} />}
    </div>
  );
};
