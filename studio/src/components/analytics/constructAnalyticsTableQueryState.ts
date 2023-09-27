import { AnalyticsViewFilterOperator } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";

export const constructAnalyticsTableQueryState = (state: {
  operationName?: string;
}) => {
  const filterState = createFilterState(state);

  const filterQuery = `?filterState=${encodeURIComponent(filterState)}`;

  return filterQuery;
};

export const createFilterState = ({
  operationName,
}: {
  operationName?: string;
}) => {
  const filterState = [];

  if (operationName) {
    filterState.push({
      id: "operationName",
      value:
        operationName === "unknown"
          ? [
              `{"label":"-","operator":${AnalyticsViewFilterOperator.EQUALS},"value":""}`,
            ]
          : [
              `{"label":"${operationName}","operator":${AnalyticsViewFilterOperator.EQUALS},"value":"${operationName}"}`,
            ],
    });
  }

  return JSON.stringify(filterState);
};
