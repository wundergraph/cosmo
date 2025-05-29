import {
  UpdateOrganizationGroupRequest_GroupRule,
  GetUserAccessibleResourcesResponse,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { roles as originalRoles } from "@/lib/constants";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { TrashIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { capitalize, cn } from "@/lib/utils";
import useWindowSize from "@/hooks/use-window-size";
import { useFeature } from "@/hooks/use-feature";
import { GroupRolesCommand, GroupRolesAccordion } from "./group-roles-command";
import { GroupResourceSelector } from "@/components/member-groups/group-resource-selector";
import { PopoverContentWithScrollableContent } from "../popover-content-with-scrollable-content";

export function GroupRuleBuilder({ builtin, roles, rule, accessibleResources, disabled, onRuleUpdated, onRemoveRule }: {
  builtin: boolean;
  roles: (typeof originalRoles)[number][];
  rule: UpdateOrganizationGroupRequest_GroupRule;
  accessibleResources: GetUserAccessibleResourcesResponse | undefined;
  disabled: boolean;
  onRuleUpdated(rule: UpdateOrganizationGroupRequest_GroupRule): void;
  onRemoveRule(): void;
}) {
  const { isMobile } = useWindowSize();
  const [isPopoverOpen, setPopoverOpen] = useState(false);
  const activeRole = originalRoles.find((r) => r.key === rule.role);
  const rbac = useFeature("rbac");

  const roleContext = useMemo(() => {
    const rolesByCategories = Object.groupBy(roles, (r) => r.category);
    return {
      roles,
      categories: Object.keys(rolesByCategories),
      rolesByCategory: rolesByCategories
    };
  }, [roles]);

  const onSelectRole = (role: string) => {
    const newSelectedRole = originalRoles.find((r) => r.key === role);
    if (!newSelectedRole) {
      return;
    }

    setPopoverOpen(false);

    onRuleUpdated(new UpdateOrganizationGroupRequest_GroupRule({ role }));
  };

  return (
    <div className="grid grid-cols-2 gap-3 justify-start items-start">
      <div className="gap-y-20">
        <Popover open={isPopoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              disabled={disabled || !rbac?.enabled || builtin}
              className="w-full justify-start"
            >
            <span className={cn('truncate', !activeRole && 'text-muted-foreground')}>
              {activeRole ? (
                <span className="flex justify-start items-center gap-x-1">
                  <span>
                    {capitalize(activeRole.category).replace('-', ' ')}
                  </span>
                  <ChevronRightIcon className="size-3 text-muted-foreground" />
                  <span className="truncate">{activeRole.displayName}</span>
                </span>
              ) : "Select a role"}
            </span>
            </Button>
          </PopoverTrigger>

          <PopoverContentWithScrollableContent
            className="p-0 w-[calc(100vw-54px)] sm:w-[350px] md:w-[500px]"
            align="start"
          >
            {!isMobile ? (
              <GroupRolesCommand
                roles={roleContext.roles}
                categories={roleContext.categories}
                rolesByCategory={roleContext.rolesByCategory}
                onSelectRole={onSelectRole}
              />
              )
              : (
                <GroupRolesAccordion
                  rolesByCategory={roleContext.rolesByCategory}
                  onSelectRole={onSelectRole}
                />
              )}
          </PopoverContentWithScrollableContent>
        </Popover>
      </div>

      <div className="flex justify-start items-start gap-x-2">
        {activeRole && activeRole.category !== 'organization' ? (
          <GroupResourceSelector
              rule={rule}
              disabled={disabled}
              activeRole={activeRole}
              accessibleResources={accessibleResources}
              onRuleUpdated={onRuleUpdated}
          />
        ) : (<div className="grow h-9 text-sm flex justify-start items-center text-muted-foreground">
          {activeRole && "Grants access to all resources."}
        </div>)}

        {rbac?.enabled && !builtin && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            disabled={disabled}
            onClick={onRemoveRule}
          >
            <TrashIcon className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
