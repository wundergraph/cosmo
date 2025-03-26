import React, { useContext } from "react";
import { GraphContext } from "@/components/layout/graph-layout";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { Button } from "@/components/ui/button";
import { Cross2Icon } from "@radix-ui/react-icons";
import { DataTableFacetedFilter } from "@/components/analytics/data-table-faceted-filter";

export function SelectedChecksFilters({
    selectedSubgraphs
} :
  {
    selectedSubgraphs: string[];
  }
) {
  const applyParams = useApplyParams();
  const { subgraphs = [] } = useContext(GraphContext) ?? {};

  if (!selectedSubgraphs.length) {
    return null;
  }

  const subgraphOptions = subgraphs.map((sg) => ({
    label: sg.name,
    value: JSON.stringify({ label: sg.name, value: sg.id }),
  }));

  return (
    <>
      <div>
        <DataTableFacetedFilter
          id="subgraphs"
          title="Subgraphs"
          selectedOptions={
            selectedSubgraphs
              .map((id) => subgraphs.find((sg) => sg.id === id)!)
              .filter(Boolean)
              .map((sg) => JSON.stringify({ label: sg.name, value: sg.id }))
          }
          onSelect={(value) => {
            applyParams({
              subgraphs: value?.map(JSON.parse).map((sg: { value: string; }) => sg.value).join(',') ?? null,
            });
          }}
          options={subgraphOptions}
        />
      </div>
      <Button
        onClick={() => applyParams({ subgraphs: null })}
        variant="outline"
        className="mr-1 border-dashed px-3 lg:ml-1"
      >
        <Cross2Icon className="mr-2 h-4 w-4" />
        Reset
      </Button>
    </>
  );
}