import type { OrganizationGroup } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";

export function GroupRow({ group, rbac, onSelect, onDelete }: {
  group: OrganizationGroup;
  rbac: boolean;
  onSelect(showMembers: boolean): void;
  onDelete(): void;
}) {
  return (
    <TableRow>
      <TableCell>
        <Button
          variant="link"
          className="px-0 h-auto gap-x-2 whitespace-nowrap"
          onClick={() => onSelect(false)}
        >
          {group.name}
        </Button>
      </TableCell>
      <TableCell>{group.description}</TableCell>
      <TableCell className="text-center">
        <Button
          variant="link"
          className="h-auto gap-x-2 whitespace-nowrap"
          onClick={() => onSelect(true)}
        >
          {group.membersCount}
        </Button>
      </TableCell>
      {rbac && (
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
      )}
    </TableRow>
  );
}