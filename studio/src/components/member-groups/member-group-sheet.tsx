import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OrganizationMemberGroup, OrganizationMemberGroupRule } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "@radix-ui/react-icons";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import {
  getUserAccessibleResources,
  updateOrganizationMemberGroup,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { GroupRuleBuilder } from "@/components/member-groups/group-rule-builder";
import { useState } from "react";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { useToast } from "@/components/ui/use-toast";

export function MemberGroupSheet({ group, onGroupUpdated, onOpenChange }: {
  group?: OrganizationMemberGroup;
  onGroupUpdated(): Promise<unknown>;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Sheet open={!!group} onOpenChange={onOpenChange}>
      <SheetContent className="scrollbar-custom w-full max-w-full overflow-y-scroll sm:max-w-full md:max-w-2xl lg:max-w-3xl">
        {!group
          ? null
          : (
            <MemberGroupSheetContent
              group={group}
              onGroupUpdated={async () => {
                await onGroupUpdated();
                onOpenChange(false);
              }}
              onCancel={() => onOpenChange(false)}
            />
          )}
      </SheetContent>
    </Sheet>
  );
}

function MemberGroupSheetContent({ group, onGroupUpdated, onCancel }: {
  group: OrganizationMemberGroup;
  onGroupUpdated(): void;
  onCancel(): void;
}) {
  const { data } = useQuery(getUserAccessibleResources);
  const [groupRules, setGroupRules] = useState<OrganizationMemberGroupRule[]>([...group.rules]);
  const { toast } = useToast();

  const allRulesHaveRole = groupRules.every((rule) => !!rule.role);
  const { mutate, isPending } = useMutation(updateOrganizationMemberGroup);

  const onSaveClick = () => {
    if (!allRulesHaveRole) {
      return;
    }

    mutate(
      {
        groupId: group.groupId,
        rules: groupRules.map((rule) => {
          if (rule.resources.length > 0) {
            return rule;
          }

          const newRule = rule.clone();
          newRule.resources = ["*"];
          return newRule;
        }),
      },
      {
        onSuccess(resp) {
          if (resp?.response?.code === EnumStatusCode.OK) {
            onGroupUpdated();
            toast({
              description: "Group updated successfully",
              duration: 3000,
            });
          } else {
            toast({
              description: resp?.response?.details ?? "Could not update the group. Please try again.",
              duration: 3000,
            });
          }
        },
        onError() {
          toast({
            description: "Could not update the group. Please try again.",
            duration: 3000,
          });
        },
      }
    );
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>Rules for &quot;{group.name}&quot;</SheetTitle>
        <SheetDescription>Blah blah blah description</SheetDescription>
      </SheetHeader>

      <div className="my-6 space-y-3">
        {groupRules.length
          ? (
            groupRules.map((rule, index) => (
              <GroupRuleBuilder
                key={`rule-${rule.role}-${index}`}
                rule={rule}
                accessibleResources={data}
                disabled={isPending}
                onRuleUpdated={(newRule) => {
                  const newGroupRules = [...groupRules];
                  newGroupRules[index] = newRule;
                  setGroupRules(newGroupRules);
                }}
                onRemoveRule={() => {
                  const newGroupRules = [...groupRules];
                  newGroupRules.splice(index, 1);
                  setGroupRules(newGroupRules);
                }}
              />
            ))
          )
          : (
            <div className="border rounded-lg flex justify-start items-center gap-x-2 px-4 py-3">
              <ExclamationTriangleIcon className="size-4" />
              <span>No rules have been added to this group.</span>
            </div>
          )
        }

        <div>
          <Button
            variant="link"
            className="gap-x-2"
            onClick={() => {
              setGroupRules([
                ...groupRules,
                OrganizationMemberGroupRule.fromJson({}),
              ])
            }}
          >
            <PlusIcon className="size-4" />
            <span>Add rule</span>
          </Button>
        </div>
      </div>

      <SheetFooter className="gap-y-2">
        <Button variant="secondary" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>

        <Button
          disabled={isPending || !allRulesHaveRole}
          isLoading={isPending}
          onClick={onSaveClick}
        >
          Save
        </Button>
      </SheetFooter>
    </>
  );
}
