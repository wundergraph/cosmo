import { useRouter } from "next/router";
import { useCallback, useMemo, useState } from "react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { PopoverContentWithScrollableContent } from "@/components/popover-content-with-scrollable-content";
import { Button } from "@/components/ui/button";
import { CaretSortIcon, } from "@radix-ui/react-icons";
import * as React from "react";
import { useWorkspace } from "@/hooks/use-workspace";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { NamespaceBadge } from "./namespace-badge";
import { Accordion } from "@/components/ui/accordion";
import { PopoverAnchor } from "@radix-ui/react-popover";
import Fuse from "fuse.js"
import { WorkspaceFederatedGraph } from "@/components/dashboard/workspace-provider";
import { NamespaceAccordionItem } from "./namespace-accordion-item";

export interface WorkspaceSelectorProps {
  children?: React.ReactNode;
  truncateNamespace?: boolean;
}

export function WorkspaceSelector({ children, truncateNamespace = true }: WorkspaceSelectorProps) {
  const router = useRouter();

  const { namespace, graphs, setNamespace } = useWorkspace();
  const [filter, setFilter] = useState('');
  const [isOpen, setOpen] = useState(false);

  const currentSlug = router.query.slug as string;
  const setNamespaceCallback = useCallback((ns: string) => {
    setNamespace(ns, false);
    setOpen(false);
  }, [setNamespace]);

  const routeSegment = router.pathname.split("/")[3]?.toLowerCase();
  const namespaceGraphs = graphs.get(namespace) ?? [];
  const activeGraph = routeSegment === "graph"
    ? namespaceGraphs.find((g) => g.graph.name.toLowerCase() === currentSlug?.toLowerCase())
    : undefined;

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
      keys: ['graph.name', 'graph.namespace'],
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
        <PopoverAnchor />
        <NamespaceBadge
          value={namespace}
          setNamespace={setNamespace}
          className={truncateNamespace ? "max-w-[180px] lg:max-w-xs truncate" : undefined}
        />

        {(activeGraph) && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm">{activeGraph?.graph.name}</span>
          </>
        )}

        <PopoverTrigger asChild className="h-auto p-2">
          <Button variant="ghost">
            <CaretSortIcon className="h-4 w-4 flex-shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContentWithScrollableContent align="start" className="p-0 w-72 lg:w-96 mt-4">
          <Command>
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
                <Accordion type="single" defaultValue={namespace}>
                  {filteredGraphs.map(([ns, data]) => (
                    <NamespaceAccordionItem
                      key={`namespace-${ns}`}
                      namespace={ns}
                      graphs={data}
                      setNamespace={setNamespaceCallback}
                    />
                  ))}
                </Accordion>
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
