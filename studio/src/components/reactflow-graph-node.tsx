import { Component2Icon } from "@radix-ui/react-icons";
import { PiGraphLight } from "react-icons/pi";
import { Handle, Node, Position } from "reactflow";

function ReactFlowGraphNode({ data }: Node) {
  return (
    <>
      {data.parentId && (
        <Handle type="target" position={Position.Top} isConnectable={false} />
      )}
      <div className="nodrag dark:ring-white/15 flex w-[110px] items-center justify-center gap-x-1 rounded border border-transparent bg-secondary px-1 py-1 text-left text-xs shadow-sm ring-1 ring-black/[.08] transition duration-150 dark:shadow-black/60">
        <div className="flex items-center justify-center rounded-full p-1">
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
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        hidden={data.kind === "subgraph"}
      />
    </>
  );
}

export default ReactFlowGraphNode;
