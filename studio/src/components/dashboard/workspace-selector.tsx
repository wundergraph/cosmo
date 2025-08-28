import { useRouter } from "next/router";
import { useCallback, useMemo, useState } from "react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { PopoverContentWithScrollableContent } from "@/components/popover-content-with-scrollable-content";
import { Button } from "@/components/ui/button";
import { CaretSortIcon, } from "@radix-ui/react-icons";
import * as React from "react";
import { useWorkspace } from "@/hooks/use-workspace";
import { Command, CommandInput } from "@/components/ui/command";
import Fuse from "fuse.js"
import { WorkspaceFederatedGraph } from "@/components/dashboard/workspace-provider";
import { useSubgraph } from "@/hooks/use-subgraph";

import { GraphCommandGroup } from "./graph-command-group";
import { NamespaceBadge } from "./namespace-badge";

export interface WorkspaceSelectorProps {
  children?: React.ReactNode;
  truncateNamespace?: boolean;
}

export function WorkspaceSelector({ children, truncateNamespace = true }: WorkspaceSelectorProps) {
  const router = useRouter();

  const subgraphContext = useSubgraph();
  const { namespace, graphs, setNamespace } = useWorkspace();
  const [filter, setFilter] = useState('');
  const [isOpen, setOpen] = useState(false);

  const routeSegment = router.pathname.split("/")[3]?.toLowerCase();
  const currentSlug = router.query.slug as string;
  const setNamespaceCallback = useCallback((ns: string) => {
    setNamespace(ns, false);
    setOpen(false);
  }, [setNamespace]);

  const namespaceGraphs = useMemo(() => graphs.get(namespace) ?? [], [graphs, namespace]);
  const namespaceSubgraphs = useMemo(() => namespaceGraphs.flatMap((g) => g.subgraphs), [namespaceGraphs]);

  const activeSubgraph = useMemo(
    () => routeSegment === "subgraph" && subgraphContext?.subgraph?.id
      ? namespaceSubgraphs.find((sg) => sg.id === subgraphContext.subgraph?.id)
      : undefined,
    [namespaceSubgraphs, routeSegment, subgraphContext],
  );

  const activeGraph = useMemo(
    () => routeSegment === "graph"
      ? namespaceGraphs.find((g) => g.graph.name.toLowerCase() === currentSlug?.toLowerCase())
      : undefined,
    [currentSlug, namespaceGraphs, routeSegment],
  );

  const filteredGraphs = useMemo<[string, WorkspaceFederatedGraph[]][]>(() => {
    const filterValue = filter?.trim().toLowerCase() ?? '';
    if (filterValue.length === 0) {
      // There is no filter, so return all graphs
      return Array.from(graphs.entries());
    }

    // If there is no graph in the current workspace, return an empty array
    const allWorkspaceFederatedGraphs = Array.from(graphs.values()).flat();
    if (allWorkspaceFederatedGraphs.length === 0) {
      return [];
    }

    // Perform a fuzzy search on all the graphs in the current workspace
    const graphFuse = new Fuse(allWorkspaceFederatedGraphs, {
      keys: ['graph.name'],
      threshold: 0.3,
    });

    const searchResults = allWorkspaceFederatedGraphs
      .map((workspaceFedGraph) => {
        const graphMatches = graphFuse.search(filterValue).some(({ item }) => item.graph.id === workspaceFedGraph.graph.id);
        if (graphMatches) {
          // If the graph matches the filter, return it as-is
          return [workspaceFedGraph];
        }

        // If the graph doesn't match the filter, perform a fuzzy search on the subgraphs'
        const subgraphFuse = new Fuse(workspaceFedGraph.subgraphs, { keys: ['name'], threshold: 0.3, });
        const matchingSubgraphs = subgraphFuse.search(filterValue);
        if (matchingSubgraphs.length === 0) {
          // If no subgraphs match the filter, return an empty array
          return [];
        }

        return [{
          graph: workspaceFedGraph.graph,
          subgraphs: matchingSubgraphs.map(({ item }) => item),
        }];
      })
      .flat();

    // Group the search results by namespace
    return searchResults.length === 0
      ? []
      : Object.entries(Object.groupBy(searchResults, ({ graph }) => graph.namespace,) as Record<string, WorkspaceFederatedGraph[]>)
  }, [graphs, filter]);

  return (
    <div className="h-9 flex justify-start items-center gap-x-2">
      <Popover
        modal
        open={isOpen}
        onOpenChange={(v) => {
          setOpen(v);
          if (v) {
            // Only reset the filter when the popover is opened
            setFilter('');
          }
        }}
      >
        <NamespaceBadge
          value={namespace}
          setNamespace={setNamespace}
          className={truncateNamespace ? "max-w-[180px] lg:max-w-xs truncate" : undefined}
        />

        {(activeGraph || activeSubgraph) && (
          <span className="text-muted-foreground">/</span>
        )}

        <PopoverTrigger asChild className="h-auto p-2">
          <Button variant="ghost" className="px-3 py-1 gap-x-4 min-h-7">
            {(activeGraph || activeSubgraph) && (
              <>
                {activeGraph?.graph.name ?? activeSubgraph?.name}
              </>
            )}
            <CaretSortIcon className="h-4 w-4 flex-shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContentWithScrollableContent
          className="p-0 w-72 lg:w-96 mt-4"
        >
          <Command
            loop
            shouldFilter={false}
            className="max-h-[calc(var(--radix-popover-content-available-height)_-32px)]"
          >
            <CommandInput
              value={filter}
              onValueChange={setFilter}
              placeholder="Search graphs, subgraphs and namespaces"
            />
            {filteredGraphs.length === 0
              ? (
                <div className="p-3 text-sm text-muted-foreground text-center pointer-events-none">
                  No namespace or graph found.
                </div>
              ) : (
                <div className="scrollbar-custom h-full overflow-y-auto">
                  {filteredGraphs.map(([ns, data], index) => (
                    <GraphCommandGroup
                      key={`namespace-${ns}`}
                      isLastGroup={index === filteredGraphs.length - 1}
                      isFiltering={!!filter?.trim().length}
                      data={data}
                      activeGraphId={activeGraph?.graph.id}
                      activeSubgraphId={activeSubgraph?.id}
                      namespace={ns}
                      setNamespace={setNamespaceCallback}
                    />
                  ))}
                </div>
              )}
          </Command>
        </PopoverContentWithScrollableContent>
      </Popover>

      <div className="flex flex-1 items-center justify-start truncate gap-x-2 text-sm">
        {children}
      </div>
    </div>
  );
}
