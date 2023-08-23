import { AnalyticsViewFilterOperator } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";

export const defaultFilterFn = (row: any, id: any, value: any) => {
  let isFiltered = false;

  const rowData = row.original;

  const targetValue = rowData[id];

  let filterValue: Array<{
    label: string;
    operator: AnalyticsViewFilterOperator;
    value: string | number;
  }> = [];

  try {
    filterValue = value.map((each: string) => JSON.parse(each));
  } catch (e) {
    console.error(e);
  }

  filterValue.forEach((filterOption) => {
    if (filterOption.operator === AnalyticsViewFilterOperator.EQUALS) {
      isFiltered = targetValue === filterOption.value;
    }
    if (filterOption.operator === AnalyticsViewFilterOperator.NOT_EQUALS) {
      isFiltered = targetValue !== filterOption.value;
    }
    if (filterOption.operator === AnalyticsViewFilterOperator.GREATER_THAN) {
      isFiltered = targetValue > filterOption.value;
    }
    if (filterOption.operator === AnalyticsViewFilterOperator.LESS_THAN) {
      isFiltered = targetValue < filterOption.value;
    }
    if (
      filterOption.operator ===
      AnalyticsViewFilterOperator.GREATER_THAN_OR_EQUAL
    ) {
      isFiltered = targetValue >= filterOption.value;
    }
    if (
      filterOption.operator === AnalyticsViewFilterOperator.LESS_THAN_OR_EQUAL
    ) {
      isFiltered = targetValue <= filterOption.value;
    }
    if (
      [
        AnalyticsViewFilterOperator.CONTAINS,
        AnalyticsViewFilterOperator.NOT_CONTAINS,
        AnalyticsViewFilterOperator.IN,
        AnalyticsViewFilterOperator.NOT_IN,
        AnalyticsViewFilterOperator.BETWEEN,
        AnalyticsViewFilterOperator.NOT_BETWEEN,
        AnalyticsViewFilterOperator.IS_NULL,
        AnalyticsViewFilterOperator.IS_NOT_NULL,
      ].indexOf(filterOption.operator)
    ) {
      // complex filter operations - let server handle it
      isFiltered = true;
    }
  });

  return isFiltered;
};
