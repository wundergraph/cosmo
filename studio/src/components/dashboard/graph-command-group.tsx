import * as React from "react";
import { WorkspaceNamespace } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { GraphCommandItem } from "./graph-command-item"
import { CommandGroup } from "@/components/ui/command";

type GraphCommandGroupProps = {
  isFiltering: boolean;
  namespace: WorkspaceNamespace;
  namespaceIndex: number;
  activeGraphId?: string;
  activeSubgraphId?: string;
  setNamespace(namespace: string): void;
}

export function GraphCommandGroup({
  isFiltering,
  namespace,
  namespaceIndex,
  activeGraphId,
  activeSubgraphId,
  setNamespace,
}: GraphCommandGroupProps) {
  return (
    <CommandGroup key={`heading-${namespaceIndex}`} heading={namespace.name}>
      {namespace.graphs.map(({ subgraphs, ...graph }, graphIndex) => (
        <React.Fragment key={`graph-${namespaceIndex}-${graphIndex}`}>
          <GraphCommandItem
            namespace={namespace}
            name={graph.name}
            isContract={graph.isContract}
            isActive={activeGraphId === graph.id}
            value={`${namespace.name}.${graph.id}`}
            setNamespace={setNamespace}
          />

          {(isFiltering || activeSubgraphId) && subgraphs.map((subgraph, subgraphIndex) => (
            <GraphCommandItem
              key={`subgraph-${namespaceIndex}-${graphIndex}-${subgraphIndex}`}
              name={subgraph.name}
              namespace={namespace}
              isActive={activeSubgraphId === subgraph.id}
              value={`${namespace.name}.${graph.id}.${subgraph.id}`}
              isSubgraph
              className="pl-8"
              setNamespace={setNamespace}
            />
          ))}
        </React.Fragment>
      ))}
    </CommandGroup>
  );
}