import { ClockIcon } from "@radix-ui/react-icons";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export const refreshIntervals = [
  {
    label: "Off",
    value: undefined,
  },
  {
    label: "10s",
    value: 10 * 1000,
  },
  {
    label: "30s",
    value: 30 * 1000,
  },
  {
    label: "1m",
    value: 60 * 1000,
  },
  {
    label: "5m",
    value: 5 * 60 * 1000,
  },
];

export interface RefreshIntervalProps {
  value?: number;
  onChange?: (value?: number) => void;
}

export const RefreshInterval: React.FC<RefreshIntervalProps> = (props) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <ClockIcon className="mr-2" />
          {refreshIntervals.find((ri) => ri.value === props.value)?.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {refreshIntervals.map((ri) => {
          return (
            <DropdownMenuCheckboxItem
              key={ri.label}
              checked={props.value === ri.value}
              onCheckedChange={() => props.onChange?.(ri.value)}
            >
              {ri.label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
