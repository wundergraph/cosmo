import { endOfDay, formatISO, startOfDay, subDays } from "date-fns";
import { useRouter } from "next/router";
import { AnalyticsViewGroupName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useMemo } from "react";
import { refreshIntervals } from "./data-table";

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

    let dateRange = {
      start: formatISO(startOfDay(subDays(new Date(), 1))),
      end: formatISO(endOfDay(new Date())),
    };

    if (query.dateRange) {
      let tempRange = parse(query.dateRange as string, {
        start: subDays(new Date(), 1),
        end: new Date(),
      });

      dateRange = {
        start: formatISO(startOfDay(new Date(tempRange.start))),
        end: formatISO(endOfDay(new Date(tempRange.end))),
      };
    }

    let refreshIntervalObject = parse(
      refreshInterval as string,
      refreshIntervals[0]
    );

    return {
      name,
      filters,
      pagination: { limit, offset },
      dateRange,
      page,
      refreshInterval: refreshIntervalObject,
    };
  }, [query]);
};
