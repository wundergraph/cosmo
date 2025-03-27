import { useContext } from "react";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { DataTablePrimaryFilterMenu } from "@/components/analytics/data-table-primary-filter-menu";
import { GraphContext } from "@/components/layout/graph-layout";
import { useRouter } from "next/router";
import { SelectedChecksFilters } from "./selected-checks-filters";

export const parseSelectedSubgraphs = (value: unknown) => {
  if (typeof value === "string") {
    return value.split(",").filter(Boolean);
  }

  return [];
}

export function ChecksFilterMenu() {
  const router = useRouter();
  const applyParams = useApplyParams();
  const { subgraphs = [] } = useContext(GraphContext) ?? {};
  const selectedSubgraphs = parseSelectedSubgraphs(router.query.subgraphs);

  return (
    <div className="flex flex-col gap-2 space-y-2">
      <div className="flex gap-2">
        <div className="flex flex-wrap gap-2">
          <DataTablePrimaryFilterMenu
            filters={[
              {
                id: "subgraphs",
                title: "Subgraphs",
                selectedOptions: selectedSubgraphs,
                onSelect: (selected) => {
                  applyParams({ subgraphs: selected?.join(',') ?? null });
                },
                options: subgraphs.map((sg) => ({
                  label: sg.name,
                  value: sg.id
                })),
              }
            ]}
          />

          <div className="flex flex-wrap gap-1">
            <SelectedChecksFilters selectedSubgraphs={selectedSubgraphs} />
          </div>
        </div>
      </div>
    </div>
  );
}