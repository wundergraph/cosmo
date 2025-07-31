import { OrganizationGroup } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useQuery } from "@connectrpc/connect-query";
import { getOrganizationGroups } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { Button, buttonVariants } from "@/components/ui/button";
import { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandGroup, CommandItem } from "@/components/ui/command";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { ChevronUpDownIcon, CheckIcon } from "@heroicons/react/24/solid";
import { cn } from "@/lib/utils";

export function MultiGroupSelect({ value, disabled = false, groups, onValueChange }: {
  value: string[];
  disabled?: boolean;
  groups?: OrganizationGroup[];
  onValueChange(groups: OrganizationGroup[]): void;
}) {
  const [open, setOpen] = useState(false);
  const { data, isPending, error, refetch } = useQuery(getOrganizationGroups, {}, { enabled: groups === undefined });
  if (isPending) {
    return (
      <Button
        variant="outline"
        className="w-full"
        isLoading
      />
    );
  }

  if (groups === undefined && (error || data?.response?.code !== EnumStatusCode.OK)) {
    return (
      <Button
        variant="outline"
        className="w-full"
        onClick={() => refetch()}
      >
        Failed to load groups. Try again.
      </Button>
    );
  }

  const availableGroups = groups ?? data?.groups ?? [];
  const activeGroups = availableGroups.filter((group) => value.includes(group.groupId));

  return (
    <Popover
      modal
      open={open}
      onOpenChange={(o) => setOpen(o && !disabled)}>
      <PopoverTrigger asChild>
        <div
          role="button"
          className={buttonVariants({
            variant: "outline",
            className: cn(
              "w-full justify-start min-h-11 h-auto gap-x-2 relative max-w-full",
              disabled && "cursor-not-allowed opacity-50 hover:!bg-inherit hover:!border-inherit"
            ),
          })}
        >
          <div className="flex-grow flex justify-start items-center gap-2 flex-wrap mr-3.5 w-1 nowrap">
            {activeGroups.length > 0 ? (
              activeGroups.map((group) => (
                <span
                  key={group.groupId}
                  className="nowrap bg-accent border flex justify-start items-center rounded-full px-3 py-0.5 max-w-[96%] pointer-events-none select-none"
                >
                  <span className="truncate">{group.name}</span>
                </span>
              ))
            ) : (
              <span className="text-muted-foreground">Select one or more groups</span>
            )}
          </div>
          <span className="bg-border w-[1px] absolute inset-y-2 right-11" />
          <ChevronUpDownIcon className="size-4 flex-shrink-0" />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 w-[--radix-popover-trigger-width]">
        <Command>
          <CommandInput placeholder="Filter by group name" />
          <CommandList>
            <CommandGroup>
              {availableGroups.map((group) => (
                <CommandItem
                  key={group.groupId}
                  className="py-2 cursor-pointer gap-x-1.5"
                  onSelect={() => {
                    const currentValue = new Set(value);
                    if (currentValue.has(group.groupId)) {
                      currentValue.delete(group.groupId);
                    } else {
                      currentValue.add(group.groupId);
                    }

                    onValueChange(
                      currentValue.size === 0
                        ? []
                        : Array.from(currentValue)
                          .map((id) => availableGroups.find((group) => group.groupId === id)!)
                          .filter((group) => !!group)
                    );
                  }}
                >
                  <span className="size-4 shrink-0">
                    {value.includes(group.groupId) ? (
                      <CheckIcon className="size-4 shrink-0" />
                    ) : null}
                  </span>
                  <span className="truncate">{group.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}