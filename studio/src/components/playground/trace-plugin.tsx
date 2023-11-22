import {
  GraphiQLPlugin,
  useEditorState,
  useExecutionContext,
} from "@graphiql/react";
import { useContext, useEffect, useState } from "react";
import { LuNetwork } from "react-icons/lu";
import { Edge, Node } from "reactflow";
import { EmptyState } from "../empty-state";
import { GraphContext } from "../layout/graph-layout";
import { CLI } from "../ui/cli";
import { Loader } from "../ui/loader";
import { FetchFlow, FetchNode } from "./fetch-flow";

const TraceTree = ({ headers, response }: { headers: any; response: any }) => {
  const [tree, setTree] = useState<FetchNode>();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const graph = useContext(GraphContext);

  useEffect(() => {
    const tempNodes: Node[] = [];
    const tempEdges: Edge[] = [];

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
        durationLoad: fetch.datasource_load_trace?.duration_load_nano_seconds,
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

      if (fetch.fetches || fetch.traces) {
        (fetch.fetches || fetch.traces).forEach((f: any) => {
          fetchNode.children.push(parseFetch(f, fetch.id));
        });
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

    const parsedResponse = JSON.parse(response);
    if (!parsedResponse?.extensions?.trace || !graph?.subgraphs) {
      return;
    }

    parseJson(parsedResponse.extensions.trace);
    setNodes(tempNodes);
    setEdges(tempEdges);
  }, [response, graph?.subgraphs]);

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
