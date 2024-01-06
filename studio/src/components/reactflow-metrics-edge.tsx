import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
} from "reactflow";
import { msToTime } from "@/lib/insights-helpers";
import React from "react";

export default function SubgraphMetricsEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            fontSize: "0.7rem",
            pointerEvents: "all",
            cursor: "pointer",
          }}
          className="nodrag nopan"
        >
          <div className="flex items-center justify-center gap-x-0.5 rounded-full bg-secondary bg-white px-1 py-0.5 text-secondary-foreground dark:bg-secondary dark:shadow-black/60">
            {msToTime(data.latency)}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
