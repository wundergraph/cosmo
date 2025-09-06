import * as React from "react";
import { GraphCommandItem } from "./graph-command-item"
import { CommandGroup, CommandSeparator } from "@/components/ui/command";
import { WorkspaceFederatedGraph } from "@/components/dashboard/workspace-provider";

type GraphCommandGroupProps = {
  isLastGroup: boolean;
  isFiltering: boolean;
  namespace: string;
  data: WorkspaceFederatedGraph[];
  activeGraphId?: string;
  activeSubgraphId?: string;
  setNamespace(namespace: string): void;
}

export function GraphCommandGroup({
  isLastGroup,
  isFiltering,
  namespace,
  data,
  activeGraphId,
  activeSubgraphId,
  setNamespace,
}: GraphCommandGroupProps) {
  return (
    <CommandGroup heading={namespace}>
      {data.map(({ graph, subgraphs }) => (
        <>
          <GraphCommandItem
            key={`${namespace}.${graph.id}`}
            namespace={namespace}
            name={graph.name}
            isContract={!!graph.contract}
            isActive={activeGraphId === graph.id}
            value={`${namespace}.${graph.id}`}
            setNamespace={setNamespace}
          />

          {(isFiltering || activeSubgraphId) && subgraphs.map((subgraph) => (
            <GraphCommandItem
              key={`${namespace}.${graph.id}.${subgraph.id}`}
              name={subgraph.name}
              namespace={namespace}
              isActive={activeSubgraphId === subgraph.id}
              value={`${namespace}.${graph.id}.${subgraph.id}`}
              isSubgraph
              className="pl-8"
              setNamespace={setNamespace}
            />
          ))}
        </>
      ))}

      {!isLastGroup && (
        <CommandSeparator className="mt-2" />
      )}
    </CommandGroup>
  );
}