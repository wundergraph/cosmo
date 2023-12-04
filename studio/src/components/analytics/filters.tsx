import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { DataTablePrimaryFilterMenu } from "./data-table-primary-filter-menu";
import { ColumnFiltersState } from "@tanstack/react-table";
import { Button } from "../ui/button";
import { Cross2Icon } from "@radix-ui/react-icons";
import React from "react";

export interface AnalyticsFilter {
  id: string;
  title: string;
  selectedOptions?: string[];
  onSelect?: (value?: string[]) => void;
  options: Array<{
    label: string;
    value: string;
  }>;
  customOptions: boolean;
}

export interface AnalyticsFiltersProps {
  filters: AnalyticsFilter[];
}

export const AnalyticsFilters: React.FC<AnalyticsFiltersProps> = (props) => {
  const { filters = [] } = props;

  return (
    <>
      {filters.length > 0 && <DataTablePrimaryFilterMenu filters={filters} />}
    </>
  );
};

export interface AnalyticsSelectedFiltersProps {
  filters: AnalyticsFilter[];
  selectedFilters?: ColumnFiltersState;
  onReset?: () => void;
}

export const AnalyticsSelectedFilters: React.FC<
  AnalyticsSelectedFiltersProps
> = (props) => {
  const { filters, selectedFilters = [], onReset } = props;
  const availableFilters = filters.map(({ id }) => id);
  const isFiltered =
    selectedFilters.filter(({ id }) => availableFilters.includes(id)).length >
    0;

  if (!filters.length) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {filters.map((filter, index) => {
        const isSelected = !!selectedFilters.find(
          (each) => each.id === filter.id,
        );

        if (!isSelected) {
          return null;
        }

        return (
          <div key={index.toString()}>
            <DataTableFacetedFilter {...filter} />
          </div>
        );
      })}
      {isFiltered && (
        <Button
          onClick={() => onReset?.()}
          variant="outline"
          className="mr-1 border-dashed px-3 lg:ml-1"
        >
          <Cross2Icon className="mr-2 h-4 w-4" />
          Reset
        </Button>
      )}
    </div>
  );
};
