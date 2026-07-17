import { Component2Icon } from '@radix-ui/react-icons';
import { PiGraphLight } from 'react-icons/pi';
import { Handle, NodeProps, Position } from 'reactflow';
import { VscError, VscRecord } from 'react-icons/vsc';
import React from 'react';
import { cn } from '@/lib/utils';

function ReactFlowGraphNode({ data, selected }: NodeProps) {
  const isSubgraph = data.kind === 'subgraph';
  return (
    <>
      {data.parentId && <Handle type="target" position={Position.Left} isConnectable={false} />}
      <div
        className={cn(
          'nodrag grid w-[120px] grid-cols-1 divide-y rounded border border-border-emphasized bg-white text-left text-xs shadow-sm shadow-black/5 ring-1 ring-black/[.08] transition duration-150 dark:divide-gray-700 dark:bg-secondary dark:shadow-black/60 dark:ring-white/15',
          isSubgraph && 'cursor-pointer hover:border-primary/40 hover:ring-primary/20 hover:shadow-md',
          selected &&
            isSubgraph &&
            'border-primary/60 ring-2 ring-primary/30 shadow-md shadow-[0_0_18px_hsl(var(--primary)/0.35)]',
        )}
      >
        <div className="flex items-center justify-center px-1.5">
          <div className="flex items-center justify-center">
            {data.kind === 'graph' ? (
              <PiGraphLight className="h-3 w-3 text-secondary-foreground" />
            ) : (
              <Component2Icon className="h-3 w-3 text-secondary-foreground" />
            )}
          </div>
          <div className={cn('truncate px-1 py-1', isSubgraph ? 'cursor-pointer' : 'cursor-help')} title={data.label}>
            {data.label}
          </div>
        </div>
        <div className="flex items-center justify-center gap-x-1 p-0.5">
          <div className="flex items-center justify-center gap-x-0.5 text-success">
            <VscRecord className="h-2 w-2" />
            <span className="text-[9px]">{data.requestRate || 0}</span>
          </div>
          <div className="flex items-center justify-center gap-x-0.5 text-destructive">
            <VscError className="h-2 w-2" />
            <span className="text-[9px]">{data.errorRate || 0}</span>
          </div>
          <div className="text-[7px] text-muted-foreground">RPM</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} hidden={data.kind === 'subgraph'} />
    </>
  );
}

export default ReactFlowGraphNode;
