import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import React from "react";
import useWindowSize from "@/hooks/use-window-size";

export const valueFormatter = (tick: number) =>
  tick === 0 || tick % 1 != 0 ? "" : `${tick}`;

type TimeSetting = "relative" | "local" | "utc";

const labelFormatter = (tick: number, utc: boolean) =>
  utc ? new Date(tick).toUTCString() : new Date(tick).toLocaleString();

export const nanoTimestampToTime = (nano: number) => {
  let ms = (nano / 1000000).toFixed(1);

  if (parseFloat(ms) > 1000) {
    let seconds = (nano / 1000000000).toFixed(1); // Converting nano to seconds
    return seconds + " s";
  }
  return ms + " ms";
};

const CustomTooltip = ({
  active,
  payload,
  label,
  p95,
  utc,
  valueLabel = "Value",
}: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-md border border-gray-100 bg-white/60 p-2 text-sm shadow-md outline-0 backdrop-blur-lg dark:border-gray-700/80 dark:bg-gray-800/60 dark:bg-gray-900">
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
        <Tooltip
          cursor={false}
          content={
            <CustomTooltip
              utc={viewOption.value === "utc"}
              valueLabel={toolTipLabel}
            />
          }
          wrapperStyle={{ border: 0, background: "none", outline: "none" }}
        />
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
        <Tooltip
          content={
            <CustomTooltip
              utc={viewOption.value === "utc"}
              valueLabel={toolTipLabel}
            />
          }
          wrapperStyle={{ border: 0, background: "none", outline: "none" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};
