import { endOfDay, formatISO, startOfDay, subDays } from "date-fns";
import { useRouter } from "next/router";
import { AnalyticsViewGroupName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useMemo } from "react";
import { refreshIntervals } from "./data-table";

export const useAnalyticsQueryState = () => {
  const { query } = useRouter();

  return useMemo(() => {
    const { filterState, pageSize, page, group, refreshInterval } = query;

    let filterStateObject = [];
    try {
      filterStateObject = JSON.parse(filterState as string);
    } catch (e) {
      console.error(e);
    }
    const filters = filterStateObject
      .map((each: { id: string; value: string[] }) => {
        return each.value.map((eachValue) => {
          let valueObject: {
            value?: string;
            operator?: string;
          } = {};

          try {
            valueObject = JSON.parse(eachValue);
          } catch (e) {
            console.error(e);
          }

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
      let tempRange = {
        from: subDays(new Date(), 1),
        to: new Date(),
      };
      try {
        tempRange = JSON.parse(query.dateRange as string);
      } catch (e) {
        console.error(e);
      }
      dateRange = {
        start: formatISO(startOfDay(new Date(tempRange.from))),
        end: formatISO(endOfDay(new Date(tempRange.to))),
      };
    }

    let refreshIntervalObject = refreshIntervals[0];

    try {
      refreshIntervalObject = JSON.parse(refreshInterval as string);
    } catch (e) {
      console.error(e);
    }

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
