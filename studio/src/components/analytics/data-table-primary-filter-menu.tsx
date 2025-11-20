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
  DropdownMenuCheckboxItem,
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
import { CustomOptions } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { cn } from "@/lib/utils";

export function DataTablePrimaryFilterMenu<T>({
  filters,
  className,
}: {
  className?: string;
  filters: AnalyticsFilter[];
}) {
  const { isMobile } = useWindowSize();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          Filter <ChevronDownIcon className="ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={isMobile ? "end" : "start"}
        className={cn("w-56", className)}
      >
        {isMobile ? (
          <Accordion
            type="single"
            collapsible
            className="max-h-72 w-full overflow-auto"
          >
            {filters.map((filter, index) => {
              return (
                <AccordionItem value={index.toString()} key={index.toString()}>
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
            {filters.map((filter, index) => {
              if (filter.customOptions === CustomOptions.Boolean) {
                return (
                  <DropdownMenuCheckboxItem
                    key={index.toString()}
                    checked={
                      filter.selectedOptions &&
                      filter.selectedOptions.length > 0
                    }
                    checkboxPosition="right"
                    onCheckedChange={(checked) => {
                      filter.onSelect?.(checked ? ["true"] : undefined);
                    }}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {filter.title}
                  </DropdownMenuCheckboxItem>
                );
              }
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
