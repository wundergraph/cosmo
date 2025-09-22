import * as React from "react";

import { NamespaceSelector } from "./namespace-selector";
import { GraphSelector } from "./graph-selector";
import { useSubgraph } from "@/hooks/use-subgraph";
import { useMemo } from "react";
import { useRouter } from "next/router";
import { useWorkspace } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";

export interface WorkspaceSelectorProps {
  children?: React.ReactNode;
  truncateNamespace?: boolean;
}

export function WorkspaceSelector({ children, truncateNamespace = true }: WorkspaceSelectorProps) {
  const router = useRouter();
  const subgraphContext = useSubgraph();
  const { namespace } = useWorkspace();

  const [activeGraph, activeSubgraph] = useMemo(
    () => {
      const routeSegment = router.pathname.split("/")[3]?.toLowerCase();
      const currentSlug = router.query.slug as string;
      return [
        routeSegment === "graph"
          ? namespace.graphs.find((graph) => graph.name.toLowerCase() === currentSlug)
          : undefined,
        !!subgraphContext?.subgraph?.id
          ? namespace.graphs
            .flatMap((graph) => graph.subgraphs)
            .find((subgraph) => subgraph.id === subgraphContext?.subgraph?.id)
          : undefined,
      ];
    },
    [namespace, router.pathname, router.query.slug, subgraphContext?.subgraph?.id],
  );

  const isViewingGraphOrSubgraph = !!activeGraph || !!activeSubgraph;
  return (
    <div className={cn(
      "flex justify-start items-center",
      isViewingGraphOrSubgraph && "gap-x-2",
    )}>
      <NamespaceSelector
        isViewingGraphOrSubgraph={isViewingGraphOrSubgraph}
        truncateNamespace={truncateNamespace}
      />
      <GraphSelector
        activeGraph={activeGraph}
        activeSubgraph={activeSubgraph}
      />
      <div className="flex flex-1 items-center justify-start truncate gap-x-2 text-sm">
        {children}
      </div>
    </div>
  );
}
