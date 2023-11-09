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
import { DataTableFilterCommands } from "./data-table-faceted-filter";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import useWindowSize from "@/hooks/use-window-size";
import { AnalyticsFilter } from "./filters";

export function DataTablePrimaryFilterMenu<T>({
  filters,
}: {
  filters: AnalyticsFilter[];
}) {
  const { isMobile } = useWindowSize();

  const isDisabled =
    filters.filter((f) => f.options.length > 0 && !f.customOptions).length ===
    0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={isDisabled}>
          Filter <ChevronDownIcon className="ml-2" />
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
              .filter((f) => f.options.length > 0 || f.customOptions)
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
                      <DataTableFilterCommands {...filter} />
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
          </Accordion>
        ) : (
          <DropdownMenuGroup>
            {filters
              .filter((f) => f.options.length > 0 || f.customOptions)
              .map((filter, index) => {
                return (
                  <DropdownMenuSub key={index.toString()}>
                    <DropdownMenuSubTrigger>
                      <span>{filter.title}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent>
                        <DataTableFilterCommands {...filter} />
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
