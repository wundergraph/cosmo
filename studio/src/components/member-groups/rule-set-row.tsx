import type { OrganizationRuleSet } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";

export function RuleSetRow({ ruleSet, onSelect, onDelete }: {
  ruleSet: OrganizationRuleSet;
  onSelect(): void;
  onDelete(): void;
}) {
  return (
    <TableRow>
      <TableCell>
        <Button variant="link" className="pl-0 h-auto" onClick={onSelect}>
          {ruleSet.name}
        </Button>
      </TableCell>
      <TableCell>{ruleSet.membersCount}</TableCell>
      <TableCell>
        <DropdownMenu>
          <div className="flex justify-center">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <EllipsisVerticalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </div>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}