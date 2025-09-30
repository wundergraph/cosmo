import { PopoverContentWithScrollableContent } from "@/components/popover-content-with-scrollable-content";
import { Command, CommandInput } from "@/components/ui/command";
import { useWorkspace } from "@/hooks/use-workspace";
import { useMemo } from "react";
import {
  WorkspaceNamespace,
  WorkspaceFederatedGraph,
  WorkspaceSubgraph
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import Fuse from "fuse.js";
import * as React from "react";

import { GraphCommandGroup } from "./graph-command-group";

interface WorkspacePopoverContentProps {
  children?: React.ReactNode;
  showFilter: boolean;
  filter: string;
  activeGraph?: WorkspaceFederatedGraph;
  activeSubgraph?: WorkspaceSubgraph;
  setFilter(filter: string): void;
  close(): void;
}

export function WorkspaceCommandWrapper({
  children,
  showFilter,
  filter,
  activeGraph,
  activeSubgraph,
  setFilter,
  close,
}: WorkspacePopoverContentProps) {
  const { namespaceByName, setNamespace } = useWorkspace();
  const filteredGraphs = useMemo<WorkspaceNamespace[]>(() => {
    const filterValue = filter?.trim().toLowerCase() ?? '';
    if (filterValue.length === 0) {
      // There is no filter, so return all namespaces
      return Array.from(namespaceByName.values());
    }

    const fuse = new Fuse<unknown>([], { keys: ['name'], threshold: 0.2, includeScore: true });
    const searchResults: WorkspaceNamespace[] = [];
    for (const wns of Array.from(namespaceByName.values())) {
      // Determine whether the namespace contains the filter value
      if (wns.name.toLowerCase().includes(filterValue)) {
        // The namespace contains the filter value, add it with all the graphs/subgraphs to the search results
        searchResults.push(wns);
        continue;
      }

      if (!wns.graphs?.length) {
        // The namespace doesn't contain any federated graph, we don't need to perform the search here
        continue;
      }

      // We need to clone the namespace to avoid mutating the original object
      const clonedWns = wns.clone();
      clonedWns.graphs = [];

      // Apply the filter to the graphs, we need to find at least one to add the namespace to the search results
      for (const graph of wns.graphs) {
        fuse.setCollection([graph]);
        if (fuse.search(filterValue).length > 0) {
          // The graph contains the filter value, we need to add it to the search results
          clonedWns.graphs.push(graph);
          continue;
        }

        // Only search for subgraphs if the graph contains subgraphs
        if (!graph.subgraphs?.length) {
          // The federated graph doesn't contain any subgraphs, we don't need to perform the search here
          continue;
        }

        // Apply the filter to the subgraphs, we need to find at least one to add the graph to the search results
        fuse.setCollection(graph.subgraphs);
        const matchingSubgraphs = fuse.search(filterValue);
        if (matchingSubgraphs.length === 0) {
          // Only add the graph to the list of results if we found at least one matching subgraph
          continue;
        }

        // We need to clone the graph to avoid mutating the original object
        const clonedGraph = graph.clone();
        clonedGraph.subgraphs = matchingSubgraphs
          .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
          .map((match) => match.item as WorkspaceSubgraph);

        clonedWns.graphs.push(clonedGraph);
      }

      // Only add the namespace to the list of results if we found at least one matching graph
      if (clonedWns.graphs.length > 0) {
        searchResults.push(clonedWns);
      }
    }

    return searchResults;
  }, [namespaceByName, filter]);

  const isFiltering = filter.trim().length > 0;
  return (
    <PopoverContentWithScrollableContent
      className="p-0 w-72 lg:w-96 mt-4"
    >
      <Command
        loop
        shouldFilter={false}
        className="max-h-[calc(var(--radix-popover-content-available-height)_-32px)]"
      >
        {showFilter && (<CommandInput
          value={filter}
          onValueChange={setFilter}
          placeholder="Search namespace, graphs and subgraphs"
        />)}
        <div className="scrollbar-custom h-full overflow-y-auto">
          {isFiltering || !children ? (
            <>
              {filteredGraphs.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground text-center pointer-events-none">
                  No namespace, graph or subgraph matches your criteria.
                </div>
              ) : filteredGraphs.map((wns, index) => (
                <>
                    <GraphCommandGroup
                      key={`namespace-${index}`}
                      isFiltering={isFiltering}
                      namespace={wns}
                      namespaceIndex={index}
                      activeGraphId={activeGraph?.id}
                      activeSubgraphId={activeSubgraph?.id}
                      setNamespace={(ns) => {
                        setNamespace(ns, false);
                        close();
                      }}
                    />
                </>
              ))}
            </>
          ) : children}
        </div>
      </Command>
    </PopoverContentWithScrollableContent>
  );
}