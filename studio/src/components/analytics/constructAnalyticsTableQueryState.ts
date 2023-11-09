import { AnalyticsViewFilterOperator } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";

export const constructAnalyticsTableQueryState = (state: {
  operationName?: string;
  operationHash?: string;
}) => {
  const filterState = createFilterState(state);

  const filterQuery = `?filterState=${encodeURIComponent(filterState)}`;

  return filterQuery;
};

export const createFilterState = ({
  operationName,
  operationHash,
}: {
  operationName?: string;
  operationHash?: string;
}) => {
  const filterState = [];

  if (operationName !== undefined) {
    filterState.push({
      id: "operationName",
      value:
        operationName === "" // empty string means "unknown operation"
          ? [
              `{"label":"-","operator":${AnalyticsViewFilterOperator.EQUALS},"value":""}`,
            ]
          : [
              `{"label":"${operationName}","operator":${AnalyticsViewFilterOperator.EQUALS},"value":"${operationName}"}`,
            ],
    });
  }

  if (operationHash !== undefined) {
    filterState.push({
      id: "operationHash",
      value: [
        `{"label":"${operationHash}","operator":${AnalyticsViewFilterOperator.EQUALS},"value":"${operationHash}"}`,
      ],
    });
  }

  return JSON.stringify(filterState);
};
