import { Table } from "@tanstack/react-table";
import { AnalyticsViewResultFilter } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { AnalyticsFilter } from "./filters";

export const optionConstructor = ({
  label,
  operator,
  value,
}: {
  label: string;
  operator: string;
  value: string | number;
}) => {
  let prefix = "";

  if (operator === "GREATER_THAN") prefix = ">";
  if (operator === "LESS_THAN") prefix = "<";

  return {
    label,
    value: JSON.stringify({ label, operator, value }),
  };
};

export const getDataTableFilters = <T>(
  table: Table<T>,
  filters: Array<AnalyticsViewResultFilter>
) => {
  const filtersList: Array<AnalyticsFilter> = [];

  filters.forEach((filter) => {
    const column = table.getColumn(filter.columnName);
    filtersList.push({
      id: filter.columnName,
      title: filter.title,
      selectedOptions: (column?.getFilterValue() as string[]) || [],
      onSelect: (value) => {
        return column?.setFilterValue(value);
      },
      options: filter.options.map((each) =>
        optionConstructor({
          label: each.label,
          operator: each.operator as unknown as string,
          value: each.value as unknown as string,
        })
      ),
    });
  });

  return filtersList;
};
