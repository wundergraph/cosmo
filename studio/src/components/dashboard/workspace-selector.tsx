import { useRouter } from "next/router";
import { useCallback, useState } from "react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  PopoverContentWithScrollableContent
} from "@/components/member-groups/popover-content-with-scrollable-content";
import { Button } from "@/components/ui/button";
import { CaretSortIcon, } from "@radix-ui/react-icons";
import * as React from "react";
import { useWorkspace } from "@/hooks/use-workspace";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { NamespaceBadge } from "./namespace-badge";
import { Accordion, AccordionContent, AccordionItem } from "@/components/ui/accordion";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDownIcon } from "@radix-ui/react-icons";

export interface WorkspaceSelectorProps {
  children?: React.ReactNode;
  truncateNamespace?: boolean;
}

export function WorkspaceSelector({ children, truncateNamespace = true }: WorkspaceSelectorProps) {
  const { namespace, graphs, setNamespace } = useWorkspace();
  const router = useRouter();
  const [isOpen, setOpen] = useState(false);

  const currentSlug = router.query.slug as string;
  const setNamespaceCallback = useCallback((ns: string) => {
    setNamespace(ns, false);
    setOpen(false);
  }, [setNamespace]);

  const routeSegment = router.pathname.split("/")[3]?.toLowerCase();
  const namespaceGraphs = graphs.get(namespace) ?? [];
  const activeGraph = routeSegment === "graph"
    ? namespaceGraphs.find((g) => g.graph.name.toLowerCase() === currentSlug?.toLowerCase())
    : undefined;

  const x = Array.from(graphs.entries());

  return (
    <div className="h-9 flex justify-start items-center gap-x-2">
      <NamespaceBadge
        value={namespace}
        setNamespace={setNamespace}
        className={truncateNamespace ? "max-w-[180px] lg:max-w-xs truncate" : undefined}
      />

      {(activeGraph) && (
        <>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm">{activeGraph?.graph.name}</span>
        </>
      )}

      <Popover open={isOpen} onOpenChange={setOpen}>
        <PopoverTrigger asChild className="h-auto p-2">
          <Button variant="ghost">
            <CaretSortIcon className="h-4 w-4 flex-shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContentWithScrollableContent className="p-0 w-72 lg:w-96">
          <Command>
            <CommandInput placeholder="Search graphs, subgraphs and namespaces" />
              <Accordion type="single" defaultValue={namespace}>
                {x.map(([ns, data]) => {
                  const numberOfSubgraphs = data.map((v) => v.subgraphs.length).reduce((a, b) => a + b, 0);

                  return (
                    <AccordionItem key={`namespace-${ns}`} value={ns} className="last:border-b-0">
                      <AccordionPrimitive.Header className="flex">
                        <AccordionPrimitive.Trigger
                          className="w-full flex flex-1 justify-start px-2 py-3 gap-x-2 [&[data-state=open]>svg]:rotate-180 font-normal text-sm"
                        >
                          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 mt-1.5" />
                          <div className="flex justify-start items-start flex-col text-left gap-y-2 w-full">
                            <NamespaceBadge
                              value={ns}
                              setNamespace={setNamespaceCallback}
                              className="text-sm font-medium"
                            />

                            <div className="text-muted-foreground w-full text-right">
                              {data.length} graph{data.length === 1 ? "" : "s"},{" "}
                              {numberOfSubgraphs} subgraph{numberOfSubgraphs === 1 ? "" : "s"}
                            </div>
                          </div>
                        </AccordionPrimitive.Trigger>
                      </AccordionPrimitive.Header>

                      <AccordionContent>S</AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
          </Command>
        </PopoverContentWithScrollableContent>
      </Popover>

      <div className="flex flex-1 items-center justify-start truncate gap-x-2 text-sm">
        {children}
      </div>
    </div>
  );
}
