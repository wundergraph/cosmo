import { cn } from "@/lib/utils";
import {
  GraphiQLPlugin,
  useEditorState,
  useExecutionContext,
} from "@graphiql/react";
import { useCallback, useContext, useEffect, useState } from "react";
import { LuNetwork } from "react-icons/lu";
import { useMovable } from "react-move-hook";
import { Edge, Node } from "reactflow";
import { EmptyState } from "../empty-state";
import { GraphContext } from "../layout/graph-layout";
import { Card } from "../ui/card";
import { CLI } from "../ui/cli";
import { Loader } from "../ui/loader";
import { FetchFlow } from "./fetch-flow";
import { FetchSpanNode } from "./fetch-waterfall";
import { FetchNode } from "./types";

const initialPaneWidth = 360;

const TraceTree = ({ headers, response }: { headers: any; response: any }) => {
  const [tree, setTree] = useState<FetchNode>();
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
      document.body.classList.remove("select-none");
    } else {
      document.body.classList.add("select-none");
    }
  }, []);

  const ref = useMovable({
    onChange: handleChange,
    axis: "x",
    bounds: "parent",
  });

  const verticalResizeStyle = {
    left: mouseState.moving
      ? paneWidth + mouseState.delta?.x
      : mouseState.position.x,
  };

  const graph = useContext(GraphContext);

  useEffect(() => {
    const tempNodes: Node[] = [];
    const tempEdges: Edge[] = [];
    let gStartTimeNano = BigInt(Number.MAX_VALUE);
    let gEndTimeNano = BigInt(0);

    const parseFetch = (fetch: any, parentId?: string): FetchNode => {
      const fetchNode: FetchNode = {
        id: fetch.id,
        parentId,
        type: fetch.type,
        dataSourceId: fetch.data_source_id,
        dataSourceName: graph?.subgraphs.find(
          (s) => s.id === fetch.data_source_id,
        )?.name,
        input: fetch.datasource_load_trace?.input,
        rawInput: fetch.datasource_load_trace?.raw_input_data,
        output: fetch.datasource_load_trace?.output,
        durationSinceStart:
          fetch.datasource_load_trace?.duration_since_start_nanoseconds,
        durationSinceStartPretty:
          fetch.datasource_load_trace?.duration_since_start_pretty,
        durationLoad: fetch.datasource_load_trace?.duration_load_nanoseconds,
        durationLoadPretty: fetch.datasource_load_trace?.duration_load_pretty,
        singleFlightUsed: fetch.datasource_load_trace?.single_flight_used,
        singleFlightSharedResponse:
          fetch.datasource_load_trace?.single_flight_shared_response,
        loadSkipped: fetch.datasource_load_trace?.load_skipped,
        children: [],
      };

      const fetchOutputTrace =
        fetch.datasource_load_trace?.output?.extensions?.trace;
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
        const endTime =
          gStartTimeNano +
          BigInt(fetchNode.durationSinceStart + fetchNode.durationLoad);
        if (endTime > gEndTimeNano) {
          gEndTimeNano = endTime;
        }
      }

      if (fetch.fetches || fetch.traces) {
        (fetch.fetches || fetch.traces).forEach((f: any) => {
          fetchNode.children.push(parseFetch(f, fetch.id));
        });
      }

      if (!fetchNode.durationSinceStart) {
        const durations = fetchNode.children
          .filter((c) => !!c.durationSinceStart)
          .map((c) => c.durationSinceStart!);
        fetchNode.durationSinceStart = Math.min(...durations);
      }

      if (!fetchNode.durationLoad) {
        const durations = fetchNode.children
          .filter((c) => !!c.durationSinceStart && !!c.durationLoad)
          .map((c) => c.durationSinceStart! + c.durationLoad!);

        fetchNode.durationLoad =
          Math.max(...durations) - fetchNode.durationSinceStart;
      }

      tempNodes.push({
        id: fetchNode.id,
        type: ["parallel", "serial", "parallelListItem"].includes(fetch.type)
          ? "multi"
          : "fetch",
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
        type: "fetch",
        data: {
          ...fetchNode,
        },
      });

      return fetchNode;
    };

    const parseJson = (json: any, parentId?: string): FetchNode | undefined => {
      if (!json.fetch) return;

      const fetchNode = parseFetch(json.fetch, parentId);

      json.fields.forEach((field: any) => {
        if (field.value && field.value.node_type === "array") {
          field.value.items.forEach((fieldItem: any) => {
            if (fieldItem.node_type === "object") {
              const node = parseJson(fieldItem, fetchNode.id);
              if (node) {
                fetchNode.children.push(node);
              }
            }
          });
        }

        if (field.value && field.value.node_type === "object") {
          const node = parseJson(field.value, fetchNode.id);
          if (node) {
            fetchNode.children.push(node);
          }
        }
      });

      return fetchNode;
    };

    try {
      const parsedResponse = JSON.parse(response);
      if (!parsedResponse?.extensions?.trace || !graph?.subgraphs) {
        return;
      }

      gStartTimeNano = BigInt(
        parsedResponse.extensions.trace.info.trace_start_unix * 1e9,
      );

      const traceTree = parseJson(parsedResponse.extensions.trace);
      console.log(traceTree);
      setTree(traceTree);
      setNodes(tempNodes);
      setEdges(tempEdges);
      setGlobalStartTime(gStartTimeNano);
      setGlobalDuration(gEndTimeNano - gStartTimeNano);
    } catch {
      return;
    }
  }, [response, graph?.subgraphs]);

  if (tree) {
    return (
      <Card className="flex w-full flex-col overflow-hidden">
        <div className="scrollbar-custom relative resize-none overflow-x-auto">
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
                mouseState.moving ? "bg-primary" : "bg-transparent",
                "absolute z-50 ml-[-9px] h-full w-[2px] cursor-col-resize border-l-2 border-transparent hover:bg-primary",
              )}
            ></div>
          </div>

          <div className="pb-4 pr-4">
            <FetchSpanNode
              span={tree}
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

  return <FetchFlow initialEdges={edges} initialNodes={nodes} />;
};

const TracePlugin = () => {
  const [response] = useEditorState(
    // @ts-expect-error
    "response",
  );

  const executionContext = useExecutionContext();

  const [headers] = useEditorState("header");

  return (
    <div className="flex h-full flex-1 flex-col font-sans">
      <div className="mb-4 text-2xl font-bold text-primary-foreground">
        Request Trace
      </div>
      {executionContext?.isFetching && <Loader fullscreen />}
      {response && headers && (
        <TraceTree headers={headers} response={response} />
      )}
      {(!response || !headers) && !executionContext?.isFetching && (
        <EmptyState
          icon={<LuNetwork />}
          title="No trace found"
          description="Include the below header before executing your queries"
          actions={<CLI command={`"X-WG-TRACE" : true"`} />}
        />
      )}
    </div>
  );
};

export const tracePlugin = (): GraphiQLPlugin => {
  return {
    title: "Request Trace",
    icon: LuNetwork,
    content: () => <TracePlugin />,
  };
};
