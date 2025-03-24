import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  formatISO,
  subHours,
} from "date-fns";
import { formatDateTime } from "./format-date";

export const dateFormatter = (tick: number, utc: boolean) =>
  utc ? new Date(tick).toUTCString() : formatDateTime(tick);

export const valueFormatter = (tick: number) =>
  tick === 0 || tick % 1 != 0 ? "" : `${tick}`;

export interface PeriodOptions {
  label: string;
  value: number;
  id: string;
}
export const periodOptions: PeriodOptions[] = [
  {
    label: "Last 1 Hour",
    value: 1,
    id: "1H",
  },
  {
    label: "Last 4 Hours",
    value: 4,
    id: "4H",
  },
  {
    label: "Last 1 Day",
    value: 24,
    id: "24H",
  },
  {
    label: "Last 2 Days",
    value: 2 * 24,
    id: "2D",
  },
  {
    label: "Last 1 Week",
    value: 7 * 24,
    id: "7D",
  },
];

export type TimeSetting = "relative" | "local" | "utc";

export const viewOptions: { label: string; value: TimeSetting }[] = [
  {
    label: "Local",
    value: "local",
  },
  {
    label: "Relative",
    value: "relative",
  },
  {
    label: "UTC",
    value: "utc",
  },
];

export const useChartData = (
  timeRange = 24,
  rawData: { timestamp: number | string | Date }[],
  timeSetting: TimeSetting | undefined = "local",
) => {
  let suffix = "h";
  let timeDifference = differenceInHours;
  if (timeRange === 1) {
    suffix = "m";
    timeDifference = differenceInMinutes;
  } else if (timeRange > 24) {
    suffix = "d";
    timeDifference = differenceInDays;
  }

  const data = rawData.map((t: any) => ({
    ...t,
    value: Number.parseFloat(t.value) || 0,
    previousValue: Number.parseFloat(t.previousValue) || 0,
    p99: 'p99' in t ? Number.parseFloat(t.p99) || 0 : undefined,
    p90: 'p90' in t ? Number.parseFloat(t.p90) || 0 : undefined,
    p50: 'p50' in t ? Number.parseFloat(t.p50) || 0 : undefined,
    // We use millisecond timestamp everywhere
    timestamp:
      t.timestamp instanceof Date
        ? new Date(t.timestamp).getTime()
        : typeof t.timestamp === "string"
        ? Number.parseInt(t.timestamp)
        : t.timestamp,
  }));

  const ticks = data.map((d) => d.timestamp);
  const domain = [ticks[0], ticks[ticks.length - 1]];

  const timeFormatter = (tick: number) => {
    const now = new Date(tick);

    switch (timeSetting) {
      case "local": {
        if (timeRange > 24) {
          return now.toLocaleDateString("default", {
            day: "numeric",
            month: "short",
          });
        }
        return now.toLocaleString("default", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
      }
      case "utc": {
        const hours = now.getUTCHours().toString().padStart(2, "0");
        const minutes = now.getUTCMinutes().toString().padStart(2, "0");
        const day = now.getUTCDate().toString().padStart(2, "0");
        const month = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ][now.getUTCMonth()];
        if (timeRange > 24) {
          return `${day} ${month}`;
        }
        return `${hours}:${minutes}`;
      }
      case "relative": {
        const diff = timeDifference(domain[1], now);
        if (diff === 0) {
          return "now";
        }
        return `${diff}${suffix}`;
      }
    }
  };

  return { data, timeFormatter, ticks, domain };
};

const bigintE3 = BigInt(1e3);
const bigintE6 = BigInt(1e6);

export const msToTime = (ms: number = 0) => {
  if (ms > 1000) return (ms / 1000).toFixed(2) + " s";

  return ms.toFixed(2) + " ms";
};

export const nsToTime = (ns: bigint) => {
  let seconds = Number(ns / BigInt(1e9)).toFixed(2);
  if (Number(seconds) > 1) return seconds + " s";

  // Work with smaller units (picoseconds) to circumvent bigint division
  const ps = ns * bigintE3;
  const microseconds = Number(ps / bigintE6);
  const milliseconds = microseconds / 1e3;

  return milliseconds.toFixed(2) + " ms";
};

export const createStringifiedDateRange = (range: number) => {
  return JSON.stringify({
    start: formatISO(subHours(new Date(), range)),
    end: formatISO(new Date()),
  });
};

export const createDateRange = (range: number) => {
  return {
    start: subHours(new Date(), range),
    end: new Date(),
  };
};
