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
import { badgeVariants } from "@/components/ui/badge";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
        <span>{group.name}</span>
        {group.builtin && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={badgeVariants({ variant: "outline", className: "space-x-1" })}>
                <InfoCircledIcon className="size-3 pointer-events-none" />
                <span className="pointer-events-none">Built-In</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Built-in groups cannot be modified or deleted.
            </TooltipContent>
          </Tooltip>
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
                <DropdownMenuItem onClick={() => onSelect(false)}>
                  Edit
                </DropdownMenuItem>
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