import { AnalyticsViewFilterOperator } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";

export const constructAnalyticsTableQueryState = ({
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

  const filterQuery = `?filterState=${encodeURIComponent(
    JSON.stringify(filterState)
  )}`;

  return filterQuery;
};
