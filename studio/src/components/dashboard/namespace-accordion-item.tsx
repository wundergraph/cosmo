import * as React from "react";
import { WorkspaceFederatedGraph } from "@/components/dashboard/workspace-provider";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { NamespaceBadge } from "@/components/dashboard/namespace-badge";
import { AccordionContent, AccordionItem } from "@/components/ui/accordion";
import Link from "next/link";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

type NamespaceAccordionProps = {
  namespace: string;
  graphs: WorkspaceFederatedGraph[];
  setNamespace(namespace: string): void;
}

export function NamespaceAccordionItem({ namespace, graphs, setNamespace }: NamespaceAccordionProps) {
  const currentOrg = useCurrentOrganization();
  const numberOfSubgraphs = graphs.map((v) => v.subgraphs.length).reduce((a, b) => a + b, 0);

  return (
    <AccordionItem key={`namespace-${namespace}`} value={namespace} className="last:border-b-0">
      <AccordionPrimitive.Header className="flex">
        <AccordionPrimitive.Trigger
          className="w-full flex flex-1 justify-start px-2 py-3 gap-x-2 [&[data-state=open]>svg]:rotate-180 font-normal text-sm"
        >
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 mt-1.5" />
          <div className="flex justify-start items-start flex-col text-left gap-y-2 w-full">
            <NamespaceBadge
              value={namespace}
              setNamespace={setNamespace}
              className="text-sm font-medium"
            />

            <div className="text-muted-foreground w-full text-right">
              {graphs.length} graph{graphs.length === 1 ? "" : "s"},{" "}
              {numberOfSubgraphs} subgraph{numberOfSubgraphs === 1 ? "" : "s"}
            </div>
          </div>
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>

      <AccordionContent>
        {graphs.map(({ graph, subgraphs }) => (
          <Link href={`/${currentOrg?.slug}`} key={`graph-${graph.id}`}>
            {graph.name}
          </Link>
        ))}
      </AccordionContent>
    </AccordionItem>
  );
}