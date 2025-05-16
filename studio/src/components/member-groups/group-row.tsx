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
import { Badge } from "@/components/ui/badge";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { useIsAdmin } from "@/hooks/use-is-admin";

export function GroupRow({ group, rbacEnabled, onSelect, onDelete }: {
  group: OrganizationGroup;
  rbacEnabled: boolean;
  onSelect(showMembers: boolean): void;
  onDelete(): void;
}) {
  const isAdmin = useIsAdmin();

  return (
    <TableRow>
      <TableCell className="space-x-3">
        {isAdmin ? (
          <Button
            variant="link"
            className="px-0 h-auto gap-x-2 whitespace-nowrap"
            onClick={() => onSelect(false)}
          >
            {group.name}
          </Button>
        ) : (
          <span>{group.name}</span>
        )}

        {group.builtin && (
          <Badge variant="outline" className="space-x-1">
            <InfoCircledIcon className="size-3" />
            <span>builtin</span>
          </Badge>
        )}
      </TableCell>
      <TableCell>{group.description}</TableCell>
      <TableCell className="text-center">
        {isAdmin ? (
          <Button
            variant="link"
            className="h-auto gap-x-2 whitespace-nowrap"
            onClick={() => onSelect(true)}
          >
            {group.membersCount}
          </Button>
        ) : group.membersCount}
      </TableCell>
      {rbacEnabled && isAdmin && (
        <TableCell>
          {!group.builtin && (
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
            </DropdownMenu>)}
        </TableCell>
      )}
    </TableRow>
  );
}