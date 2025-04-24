import type { OrganizationMemberGroup } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";

export function MemberGroupRow({ group, onSelect, onDelete }: {
  group: OrganizationMemberGroup;
  onSelect(): void;
  onDelete(): void;
}) {
  return (
    <TableRow>
      <TableCell>
        <Button variant="link" className="pl-0 h-auto gap-x-2" onClick={onSelect}>
          {group.name}
        </Button>
      </TableCell>
      <TableCell>{group.membersCount}</TableCell>
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