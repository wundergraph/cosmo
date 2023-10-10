import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CheckIcon, ChevronDownIcon } from "@radix-ui/react-icons";
import { AnalyticsViewGroupName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";

export function DataTableGroupMenu({
  value,
  onChange,
  items,
  className,
}: {
  value: AnalyticsViewGroupName;
  items: Array<{
    label: string;
    value: AnalyticsViewGroupName;
  }>;
  onChange: (newValue: AnalyticsViewGroupName) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          Group By: {items.find((each) => each.value === value)?.label ?? ""}
          <ChevronDownIcon className="ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          {items.map((item, index) => {
            return (
              <DropdownMenuItem
                onClick={() => onChange(item.value)}
                key={index.toString()}
                className="flex flex-row items-center justify-between"
              >
                <span>{item.label}</span>
                {value === item.value ? (
                  <CheckIcon className="h-5 w-5" />
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
