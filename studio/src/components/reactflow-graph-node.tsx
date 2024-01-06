import { Component2Icon } from "@radix-ui/react-icons";
import { PiGraphLight } from "react-icons/pi";
import { Handle, NodeProps, Position } from "reactflow";
import { VscError, VscRecord } from "react-icons/vsc";
import React from "react";

function ReactFlowGraphNode({ data }: NodeProps) {
  return (
    <>
      {data.parentId && (
        <Handle type="target" position={Position.Left} isConnectable={false} />
      )}
      <div className="nodrag dark:ring-white/15 grid w-[120px] grid-cols-1 divide-y rounded border border-border-emphasized bg-white text-left text-xs shadow-sm shadow-black/5 ring-1 ring-black/[.08] transition duration-150 dark:divide-gray-700 dark:bg-secondary dark:shadow-black/60">
        <div className="flex items-center justify-center">
          <div className="flex items-center justify-center">
            {data.kind === "graph" ? (
              <PiGraphLight className="h-3 w-3 text-secondary-foreground" />
            ) : (
              <Component2Icon className="h-3 w-3 text-secondary-foreground" />
            )}
          </div>
          <div className="cursor-help truncate px-1 py-1" title={data.label}>
            {data.label}
          </div>
        </div>
        <div className="flex items-center justify-center gap-x-1 p-0.5">
          <div className="flex items-center justify-center gap-x-0.5 text-green-500">
            <VscRecord className="h-2 w-2" />
            <span className="text-[9px]">{data.requestRate || 0}</span>
          </div>
          <div className="flex items-center justify-center gap-x-0.5 text-red-500">
            <VscError className="h-2 w-2" />
            <span className="text-[9px]">{data.errorRate || 0}</span>
          </div>
          <div className="text-[7px] text-muted-foreground">RPM</div>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        hidden={data.kind === "subgraph"}
      />
    </>
  );
}

export default ReactFlowGraphNode;
