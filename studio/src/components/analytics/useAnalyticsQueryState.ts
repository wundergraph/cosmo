import { AnalyticsViewGroupName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { subHours } from "date-fns";
import { useRouter } from "next/router";
import { useMemo } from "react";
import { Range, getRange } from "../date-picker-with-range";
import { refreshIntervals } from "./refresh-interval";

const parse = (value: string, fallback: any) => {
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
};

export const useDateRangeQueryState = (customDefaultRange?: Range) => {
  const { query } = useRouter();

  return useMemo(() => {
    let range: Range | undefined = undefined;

    const parsedRange = getRange(query.range?.toString() || customDefaultRange);

    let dateRange = {
      start: subHours(new Date(), parsedRange),
      end: new Date(),
    };

    if (query.dateRange) {
      let tempRange = parse(query.dateRange as string, {
        start: subHours(new Date(), parsedRange),
        end: new Date(),
      });

      dateRange = {
        start: new Date(tempRange.start),
        end: new Date(tempRange.end),
      };
    } else {
      range = parsedRange;
    }

    return {
      dateRange,
      range,
    };
  }, [customDefaultRange, query.dateRange, query.range]);
};

export const useAnalyticsQueryState = (customDefaultRange?: Range) => {
  const { query } = useRouter();
  const { range, dateRange } = useDateRangeQueryState(customDefaultRange);

  return useMemo(() => {
    let filterStateObject = parse(query.filterState as string, []);

    const filters = filterStateObject
      .map((each: { id: string; value: string[] }) => {
        return each.value.map((eachValue) => {
          let valueObject: {
            value?: string;
            operator?: string;
          } = parse(eachValue, {});

          return {
            field: each.id,
            value: valueObject.value!,
            operator: valueObject.operator!,
          };
        });
      })
      .flat();

    const limit = Math.min(Number(query.pageSize) || 20, 50);
    const offset = (Number(query.page) || 0) * limit;

    const name = query.group
      ? AnalyticsViewGroupName[
          query.group as string as keyof typeof AnalyticsViewGroupName
        ]
      : AnalyticsViewGroupName.None;

    let refreshIntervalObject = parse(
      query.refreshInterval as string,
      refreshIntervals[0].value,
    );

    let sort =
      query.group && query.group !== "None"
        ? {
            id: "totalRequests",
            desc: true,
          }
        : {
            id: "unixTimestamp",
            desc: true,
          };

    if (query.sort) {
      sort.id = query.sort.toString();
      sort.desc = query.sortDir === "desc";
    }

    return {
      name,
      filters,
      pagination: { limit, offset },
      dateRange,
      range,
      page: query.page,
      refreshInterval: refreshIntervalObject,
      sort,
    };
  }, [
    query.filterState,
    query.pageSize,
    query.page,
    query.group,
    query.sort,
    query.dateRange,
    query.sortDir,
    query.range,
    query.refreshInterval,
  ]);
};
