import { useContext, useEffect, useMemo, useState } from 'react';
import { LuLayoutDashboard, LuNetwork } from 'react-icons/lu';
import { Edge, Node, ReactFlowProvider } from 'reactflow';
import { EmptyState } from '../empty-state';
import { CLI } from '../ui/cli';
import { FetchFlow, ReactFlowQueryPlanFetchNode } from './fetch-flow';
import { TraceContext } from './trace-view';
import { QueryPlan, QueryPlanFetchTypeNode } from './types';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

const PlanTree = ({ queryPlan }: { queryPlan: QueryPlan }) => {
  const [initialNodes, setInitialNodes] = useState<Node[]>([]);
  const [initialEdges, setInitialEdges] = useState<Edge[]>([]);

  useEffect(() => {
    const tempNodes: Node[] = [];
    const tempEdges: Edge[] = [];

    tempNodes.push({
      id: 'root',
      type: 'fetch',
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
          type: 'fetch',
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

    parseNodes(queryPlan, 'root');

    setInitialNodes(tempNodes);
    setInitialEdges(tempEdges);
  }, [queryPlan]);

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
  const { plan, planError } = useContext(TraceContext);

  if (planError) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon className="h-12 w-12" />}
        title="Error fetching plan"
        description={planError}
      />
    );
  }

  if (!plan) {
    return (
      <EmptyState
        icon={<LuLayoutDashboard />}
        title="No query plan found"
        description="Include the below header before executing your queries. Router version 0.104.0 or above is required."
        actions={<CLI command={`"X-WG-Include-Query-Plan" : "true"`} />}
      />
    );
  }

  return (
    <div className="relative flex h-full w-full flex-1 flex-col font-sans">
      <PlanTree queryPlan={plan} />
    </div>
  );
};
