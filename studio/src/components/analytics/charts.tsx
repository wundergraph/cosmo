import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  TooltipProps,
  XAxis,
  YAxis,
} from "recharts";
import React from "react";
import useWindowSize from "@/hooks/use-window-size";
import { formatDateTime } from "@/lib/format-date";

const labelFormatter = (label: number, utc?: boolean) => {
  return utc
    ? new Date(label).toUTCString()
    : label
    ? formatDateTime(label)
    : label;
};

export const valueFormatter = (tick: number) =>
  tick === 0 || tick % 1 != 0 ? "" : `${tick}`;

type TimeSetting = "relative" | "local" | "utc";

export const nanoTimestampToTime = (nano: number) => {
  let ms = (nano / 1000000).toFixed(1);

  if (parseFloat(ms) > 1000) {
    let seconds = (nano / 1000000000).toFixed(1); // Converting nano to seconds
    return seconds + " s";
  }
  return ms + " ms";
};

export const tooltipWrapperClassName =
  "rounded-md border !border-popover !bg-popover/60 p-2 text-sm shadow-md outline-0 backdrop-blur-lg";

export const ChartTooltip = (
  props: TooltipProps<any, any> & { utc?: boolean }
) => {
  const { utc, ...rest } = props;
  return (
    <Tooltip
      wrapperClassName={tooltipWrapperClassName}
      labelFormatter={(label) => labelFormatter(parseInt(label), utc)}
      {...rest}
    />
  );
};

ChartTooltip.displayName = "Tooltip";

export const CustomTooltip = ({
  active,
  payload,
  label,
  p95,
  utc,
  valueLabel = "Value",
}: any) => {
  if (active && payload && payload.length) {
    return (
      <div className={tooltipWrapperClassName}>
        <p className="label">{labelFormatter(label, utc)}</p>
        <p className="intro">
          {valueLabel}:{" "}
          {p95 ? nanoTimestampToTime(payload[0].value) : payload[0].value}
        </p>
      </div>
    );
  }
  return null;
};

export const BarChartComponent = ({
  data,
  domain,
  ticks,
  tickFormatter,
  largerInterval,
  viewOption,
  toolTipLabel,
  chartHeight,
}: {
  data: { timestamp: number; value: number }[];
  domain: number[];
  ticks: number[];
  tickFormatter: (tick: number) => string;
  largerInterval: number | undefined;
  viewOption: { label: string; value: TimeSetting };
  toolTipLabel: string;
  chartHeight: number;
}) => {
  const { isMobile } = useWindowSize();

  return (
    <ResponsiveContainer width="100%" height={chartHeight} className="-ml-6">
      <BarChart data={data}>
        <CartesianGrid
          color="currenColor"
          strokeWidth="0.2"
          vertical={false}
          strokeDasharray="3 1"
        />
        <Bar dataKey="value" fill="indianred" barSize={12} />
        <XAxis
          dataKey="timestamp"
          domain={domain}
          ticks={ticks}
          tickFormatter={tickFormatter}
          type="number"
          axisLine={false}
          interval={largerInterval}
          padding={{
            right: isMobile ? 16 : 32,
          }}
        />
        <YAxis
          tickFormatter={valueFormatter}
          dataKey="value"
          axisLine={false}
          tickLine={false}
          interval={1}
        />
        <ChartTooltip utc={viewOption.value === "utc"} />
      </BarChart>
    </ResponsiveContainer>
  );
};

export const LineChartComponent = ({
  data,
  domain,
  ticks,
  xAxisTickFormatter,
  yAxisTickFormatter,
  largerInterval,
  viewOption,
  toolTipLabel,
  chartHeight,
  cartesianGrid,
  xAxisPadding,
  hideXAxis = false,
  hideYAxis = false,
  className,
}: {
  data: { timestamp: number; value: number }[];
  domain: number[];
  ticks: number[];
  xAxisTickFormatter?: (tick: number) => string;
  yAxisTickFormatter?: (tick: number) => string;
  largerInterval?: number;
  viewOption: { label: string; value: TimeSetting };
  toolTipLabel: string;
  chartHeight: number;
  cartesianGrid: boolean;
  xAxisPadding?: { left?: number | undefined; right?: number | undefined };
  hideXAxis?: boolean;
  hideYAxis?: boolean;
  className?: string;
}) => {
  return (
    <ResponsiveContainer
      width="100%"
      height={chartHeight}
      className={className}
    >
      <LineChart data={data}>
        {cartesianGrid && (
          <CartesianGrid
            color="currenColor"
            strokeWidth="0.2"
            vertical={false}
            strokeDasharray="3 1"
          />
        )}
        <Line dot={false} type="monotone" dataKey="value" strokeWidth="2" />
        <XAxis
          dataKey="timestamp"
          domain={domain}
          ticks={ticks}
          type="number"
          tickFormatter={xAxisTickFormatter}
          axisLine={false}
          interval={largerInterval}
          padding={xAxisPadding}
          hide={hideXAxis}
        />
        <YAxis
          tickFormatter={yAxisTickFormatter}
          dataKey="value"
          axisLine={false}
          tickLine={false}
          hide={hideYAxis}
        />

        <ChartTooltip utc={viewOption.value === "utc"} />
      </LineChart>
    </ResponsiveContainer>
  );
};
