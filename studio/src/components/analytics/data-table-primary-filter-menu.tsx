import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Column } from "@tanstack/react-table";
import { DataTableFilterCommands } from "./data-table-faceted-filter";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import useWindowSize from "@/hooks/use-window-size";
import { Fragment } from "react";

export function DataTablePrimaryFilterMenu<T>({
  filters,
}: {
  filters: {
    column?: Column<T, unknown> | undefined;
    title: string;
    options: {
      label: string;
      value: string;
    }[];
  }[];
}) {
  const { isMobile } = useWindowSize();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          Filters <ChevronDownIcon className="ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={isMobile ? "end" : "start"} className="w-56">
        {isMobile ? (
          <Accordion
            type="single"
            collapsible
            className="max-h-72 w-full overflow-auto"
          >
            {filters
              .filter((f) => f.options.length > 0)
              .map((filter, index) => {
                return (
                  <AccordionItem
                    value={index.toString()}
                    key={index.toString()}
                  >
                    <AccordionTrigger className="p-2">
                      <span>{filter.title}</span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <DataTableFilterCommands
                        title={filter.title}
                        column={filter.column}
                        options={filter.options}
                      />
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
          </Accordion>
        ) : (
          <DropdownMenuGroup>
            {filters
              .filter((f) => f.options.length > 0)
              .map((filter, index) => {
                return (
                  <DropdownMenuSub key={index.toString()}>
                    <DropdownMenuSubTrigger>
                      <span>{filter.title}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent>
                        <DataTableFilterCommands
                          title={filter.title}
                          column={filter.column}
                          options={filter.options}
                        />
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                );
              })}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
