import { AnalyticsViewGroupName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { endOfDay, startOfDay, subHours } from "date-fns";
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

export const useAnalyticsQueryState = () => {
  const { query } = useRouter();

  return useMemo(() => {
    const { filterState, pageSize, page, group, refreshInterval } = query;

    let filterStateObject = parse(filterState as string, []);

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

    const limit = Number(pageSize) || 10;
    const offset = (Number(page) || 0) * limit;

    const name = group
      ? AnalyticsViewGroupName[
          group as string as keyof typeof AnalyticsViewGroupName
        ]
      : AnalyticsViewGroupName.None;

    let range: Range | undefined = undefined;

    const parsedRange = getRange(query.range?.toString());

    let dateRange = {
      start: startOfDay(subHours(new Date(), parsedRange)),
      end: endOfDay(new Date()),
    };

    if (query.dateRange) {
      let tempRange = parse(query.dateRange as string, {
        start: subHours(new Date(), parsedRange),
        end: new Date(),
      });

      dateRange = {
        start: startOfDay(new Date(tempRange.start)),
        end: endOfDay(new Date(tempRange.end)),
      };
    } else if (!range) {
      range = parsedRange;
    }

    let refreshIntervalObject = parse(
      refreshInterval as string,
      refreshIntervals[0].value,
    );

    let sort =
      group && group !== "None"
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
      page,
      refreshInterval: refreshIntervalObject,
      sort,
    };
  }, [query]);
};
