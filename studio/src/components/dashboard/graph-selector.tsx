import { useState } from "react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { WorkspaceCommandWrapper } from "./workspace-command-wrapper"
import { Button } from "@/components/ui/button";
import { CaretSortIcon } from "@radix-ui/react-icons";
import * as React from "react";
import { WorkspaceFederatedGraph, WorkspaceSubgraph } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";

interface GraphSelectorProps {
  activeGraph: WorkspaceFederatedGraph | undefined;
  activeSubgraph: WorkspaceSubgraph | undefined;
}

export function GraphSelector({ activeGraph, activeSubgraph }: GraphSelectorProps) {
  const [filter, setFilter] = useState('');
  const [isOpen, setOpen] = useState(false);
  if (!activeGraph && !activeSubgraph) {
    return null;
  }

  return (
    <>
      <span className="text-muted-foreground text-sm">/</span>
      <Popover
        modal
        open={isOpen}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            // Only reset the filter when the popover is opened
            setFilter('');
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" className="transition-colors duration-150 px-3 py-1.5 h-auto gap-x-4">
            <span>
              {activeGraph?.name ?? activeSubgraph?.name}
            </span>
            <CaretSortIcon className="h-4 w-4 flex-shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <WorkspaceCommandWrapper
          showFilter
          filter={filter}
          activeGraph={activeGraph}
          activeSubgraph={activeSubgraph}
          setFilter={setFilter}
          close={() => {
            setOpen(false);
            setFilter('');
          }}
        />
      </Popover>
    </>
  );
}