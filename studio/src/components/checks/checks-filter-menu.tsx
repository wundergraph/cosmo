import { useContext } from "react";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { DataTablePrimaryFilterMenu } from "@/components/analytics/data-table-primary-filter-menu";
import { GraphContext } from "@/components/layout/graph-layout";
import { useRouter } from "next/router";

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

  return (
    <DataTablePrimaryFilterMenu
      filters={[
        {
          id: "subgraphs",
          title: "Subgraphs",
          selectedOptions: parseSelectedSubgraphs(router.query.subgraphs),
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
  );
}