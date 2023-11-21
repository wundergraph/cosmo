import { GraphiQLPlugin, useEditorState } from "@graphiql/react";
import { useEffect, useState } from "react";
import { LuNetwork } from "react-icons/lu";
import { Edge, Node } from "reactflow";
import { FetchFlow } from "./fetch-flow";

type TraceInfo = {
  startUnixSeconds: number;
};

type FetchNode = {
  id: number;
  parentId?: number;
  type: string;
  dataSourceId: string;
  children: FetchNode[];
};

const TraceTree = ({ headers, response }: { headers: any; response: any }) => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    let id = -1;

    const n: Node[] = [];
    const e: Edge[] = [];

    const parseFetch = (
      fetch: any,
      level: number,
      parentId?: number,
    ): FetchNode => {
      id += 1;

      const fetchNode: FetchNode = {
        id,
        parentId,
        type: fetch.type,
        dataSourceId: fetch.data_source_id,
        children: [],
      };

      if (fetch.fetches) {
        fetch.fetches.forEach((f: any) => {
          fetchNode.children.push(
            parseFetch(f, level, (parentId ?? 0) + level + 1),
          );
        });
      }

      n.push({
        id: `${fetchNode.id}`,
        type: "fetch",
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

      e.push({
        id: `edge-${fetchNode.id}-${fetchNode.parentId}`,
        source: `${fetchNode.parentId}`,
        animated: true,
        target: `${fetchNode.id}`,
        type: "default",
      });

      return fetchNode;
    };

    const parseJson = (json: any, parentId?: number): FetchNode | undefined => {
      if (!json.fetch) return;

      const fetchNode = parseFetch(json.fetch, 0, parentId);

      json.fields.forEach((field: any) => {
        if (field.value && field.value.node_type === "array") {
          field.value.items.forEach((fieldItem: any) => {
            if (fieldItem.node_type === "object") {
              const node = parseJson(fieldItem, id);
              if (node) {
                fetchNode.children.push(node);
              }
            }
          });
        }

        if (field.value && field.value.node_type === "object") {
          const node = parseJson(field.value, id);
          if (node) {
            fetchNode.children.push(node);
          }
        }
      });

      return fetchNode;
    };

    const parsedResponse = JSON.parse(response);
    if (!parsedResponse?.extensions?.trace) {
      return;
    }

    parseJson(parsedResponse.extensions.trace);
    setNodes(n);
    setEdges(e);
  }, [response]);

  return <FetchFlow initialEdges={edges} initialNodes={nodes} />;
};

const TracePlugin = () => {
  const [response] = useEditorState(
    // @ts-expect-error
    "response",
  );

  const [headers] = useEditorState("header");

  if (!response || !headers) {
    return null;
  }

  return (
    <div className="flex h-full flex-1 flex-col">
      <div className="doc-explorer-title">Request Trace</div>
      <TraceTree headers={headers} response={response} />
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
