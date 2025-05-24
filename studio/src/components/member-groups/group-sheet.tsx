import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  OrganizationGroup,
  UpdateOrganizationGroupRequest_GroupRule
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { Button } from "@/components/ui/button";
import { InfoCircledIcon, PlusIcon } from "@radix-ui/react-icons";
import { PencilIcon } from "@heroicons/react/24/outline";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import {
  getUserAccessibleResources,
  updateOrganizationGroup,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { GroupRuleBuilder } from "@/components/member-groups/group-rule-builder";
import { useState } from "react";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { useToast } from "@/components/ui/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { roles } from "@/lib/constants";
import { useFeature } from "@/hooks/use-feature";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function GroupSheet({ open, group, onGroupUpdated, onOpenChange }: {
  open: boolean;
  group?: OrganizationGroup;
  onGroupUpdated(): Promise<unknown>;
  onOpenChange(open: boolean): void;
}) {
  const [previousGroup, setPreviousGroup] = useState<OrganizationGroup>();
  const onSheetOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      setPreviousGroup(group);
    }
  };

  const currentGroup = group || previousGroup;
  return (
    <Sheet open={open} onOpenChange={onSheetOpenChange}>
      <SheetContent className="scrollbar-custom w-full max-w-full overflow-y-scroll sm:max-w-full md:max-w-2xl lg:max-w-3xl">
        {!currentGroup
          ? null
          : (
            <MemberGroupSheetContent
              group={currentGroup}
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
  group: OrganizationGroup;
  onGroupUpdated(): Promise<unknown>;
  onCancel(): void;
}) {
  const { data } = useQuery(getUserAccessibleResources);
  const [description, setDescription] = useState(group.description || '');
  const { toast } = useToast();
  const rbac = useFeature("rbac");

  const [groupRules, setGroupRules] = useState<UpdateOrganizationGroupRequest_GroupRule[]>([...group.rules.map(
    (r) => new UpdateOrganizationGroupRequest_GroupRule({
      role: r.role,
      namespaces: r.namespaces,
      resources: r.resources,
    })
  )]);

  const allRulesHaveRole = groupRules.every((rule) => !!rule.role);
  const { mutate, isPending, isSuccess } = useMutation(updateOrganizationGroup);

  const actualRoles = roles.filter((r) => !groupRules.some((gr) => gr.role === r.key));

  const isDisabled = isPending || isSuccess;
  const onSaveClick = () => {
    if (!allRulesHaveRole || !rbac?.enabled) {
      return;
    }

    mutate(
      { groupId: group.groupId, description, rules: groupRules },
      {
        onSuccess(resp) {
          if (resp?.response?.code === EnumStatusCode.OK) {
            onGroupUpdated().finally(() => {
              toast({
                description: "Group updated successfully",
                duration: 3000,
              });
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
        <SheetDescription className="space-x-2">
          <span>{description || "No description set"}</span>
          {rbac?.enabled && !group.builtin && (
            <EditDescriptionDialog
              description={description}
              disabled={isDisabled}
              onUpdate={setDescription}
            />
          )}
        </SheetDescription>
      </SheetHeader>

      {!rbac?.enabled && (
        <Alert className="mt-6">
          <InfoCircledIcon className="size-5" />
          <AlertTitle>Attention!</AlertTitle>
          <AlertDescription>
            You need to enable RBAC in the settings to be able to modify groups.
          </AlertDescription>
        </Alert>
      )}

      <div className="my-6 space-y-3">
        {groupRules.length > 0 && (
          groupRules.map((rule, index) => (
            <GroupRuleBuilder
              key={`rule-${rule.role}-${index}`}
              builtin={group.builtin}
              roles={roles.filter((r) => r.key === rule.role || !groupRules.some((gr) => gr.role === r.key))}
              rule={rule}
              accessibleResources={data}
              disabled={isDisabled}
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
        )}

        {rbac?.enabled && !group.builtin && (
          <div>
            <Button
              variant="secondary"
              className="gap-x-2"
              disabled={!actualRoles.length || isDisabled}
              onClick={() => {
                if (!actualRoles.length) {
                  return;
                }

                setGroupRules([
                  ...groupRules,
                  UpdateOrganizationGroupRequest_GroupRule.fromJson({}),
                ]);
              }}
            >
              <PlusIcon className="size-4" />
              <span>Add rule</span>
            </Button>
          </div>
        )}
      </div>

      <SheetFooter className="gap-y-2">
        {rbac?.enabled && !group.builtin && (
          <>
            <Button variant="secondary" onClick={onCancel} disabled={isDisabled}>
              Cancel
            </Button>

            <Button
              disabled={isDisabled || !allRulesHaveRole}
              isLoading={isPending || isSuccess}
              onClick={onSaveClick}
            >
              Save
            </Button>
          </>
        )}
      </SheetFooter>
    </>
  );
}

function EditDescriptionDialog({ description, disabled, onUpdate }: {
  description: string;
  disabled: boolean;
  onUpdate(description: string): void;
}) {
  const [tmpDescription, setTmpDescription] = useState(description);
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" disabled={disabled}>
          <PencilIcon className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update group description</DialogTitle>
        </DialogHeader>

        <div className="space-y-1">
          <Textarea
            rows={5}
            maxLength={250}
            defaultValue={tmpDescription}
            onChange={(e) => setTmpDescription(e.target.value)}
          />

          <div className="text-right text-xs">
            {tmpDescription.length}/250
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              onUpdate(tmpDescription.trim());
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
