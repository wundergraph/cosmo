import { useContext, useEffect, useMemo, useState } from "react";
import { LuLayoutDashboard, LuNetwork } from "react-icons/lu";
import { Edge, Node, ReactFlowProvider } from "reactflow";
import { EmptyState } from "../empty-state";
import { CLI } from "../ui/cli";
import { FetchFlow, ReactFlowQueryPlanFetchNode } from "./fetch-flow";
import { TraceContext } from "./trace-view";
import { QueryPlan, QueryPlanFetchTypeNode } from "./types";

const PlanTree = ({ response }: { response: any }) => {
  const [initialNodes, setInitialNodes] = useState<Node[]>([]);
  const [initialEdges, setInitialEdges] = useState<Edge[]>([]);

  useEffect(() => {
    const tempNodes: Node[] = [];
    const tempEdges: Edge[] = [];

    const parsedResponse = JSON.parse(response);
    if (!parsedResponse?.extensions?.queryPlan) {
      return;
    }

    const queryPlan: QueryPlan = parsedResponse.extensions.queryPlan;

    tempNodes.push({
      id: "root",
      type: "fetch",
      data: {
        ...queryPlan,
      },
      position: {
        x: 0,
        y: 0,
      },
    });

    const parseNodes = (node: QueryPlanFetchTypeNode, parentId: string) => {
      node.children?.forEach((child) => {
        const id = crypto.randomUUID();
        tempNodes.push({
          id,
          type: "fetch",
          data: {
            ...child,
          },
          position: {
            x: 0,
            y: 0,
          },
          connectable: false,
          deletable: false,
        });

        tempEdges.push({
          id: `${id}-${parentId}`,
          source: parentId,
          target: id,
          animated: true,
        });

        parseNodes(child, id);
      });
    };

    parseNodes(queryPlan, "root");

    setInitialNodes(tempNodes);
    setInitialEdges(tempEdges);
  }, [response]);

  const nodeTypes = useMemo<any>(
    () => ({
      fetch: ReactFlowQueryPlanFetchNode,
    }),
    [],
  );

  return (
    <ReactFlowProvider>
      <FetchFlow
        initialNodes={initialNodes}
        initialEdges={initialEdges}
        nodeTypes={nodeTypes}
        direction="TB"
        nodeWidth={400}
        nodeHeight={100}
      />
    </ReactFlowProvider>
  );
};

export const PlanView = () => {
  const {
    response: activeResponse,
    subgraphs,
    headers: activeHeader,
  } = useContext(TraceContext);

  const [headers, setHeaders] = useState<string>();
  const [response, setResponse] = useState<string>();

  const [isNotIntrospection, setIsNotIntrospection] = useState(false);

  useEffect(() => {
    try {
      const res = JSON.parse(activeResponse);
      if (!res.data || !res.data?.__schema) {
        setResponse(activeResponse);
        setIsNotIntrospection(true);
      }
    } catch {
      return;
    }
  }, [activeResponse]);

  useEffect(() => {
    if (!activeResponse) return;
    setHeaders(activeHeader);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeResponse]);

  const { hasPlanHeader, hasPlanInResponse } = useMemo(() => {
    try {
      const parsedHeaders = JSON.parse(headers || "{}");
      const parsedResponse = JSON.parse(activeResponse || "{}");

      return {
        hasPlanHeader: !!parsedHeaders["X-WG-Include-Query-Plan"],
        hasPlanInResponse: !!parsedResponse?.extensions?.queryPlan,
      };
    } catch {
      return { hasPlanHeader: false, hasPlanInResponse: false };
    }
  }, [headers, activeResponse]);

  const hasPlan = hasPlanHeader && hasPlanInResponse;

  if (!hasPlan) {
    return (
      <EmptyState
        icon={<LuNetwork />}
        title="No query plan found"
        description="Include the below header before executing your queries. Router version 0.104.0 or above is required."
        actions={<CLI command={`"X-WG-Include-Query-Plan" : "true"`} />}
      />
    );
  }

  if (!isNotIntrospection) {
    return (
      <EmptyState
        icon={<LuLayoutDashboard />}
        title="Execute a query"
        description="Include the below header to view the query plan"
        actions={<CLI command={`"X-WG-Include-Query-Plan" : "true"`} />}
      />
    );
  }

  if (!response || !headers) {
    return null;
  }

  return (
    <div className="relative flex h-full w-full flex-1 flex-col font-sans">
      <PlanTree response={response} />
    </div>
  );
};
