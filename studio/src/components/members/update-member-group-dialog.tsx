import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import { OrgMember } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { Button } from "@/components/ui/button";
import {
  getOrganizationGroups,
  updateOrgMemberGroup,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUser } from "@/hooks/use-user";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { useToast } from "@/components/ui/use-toast";

export function UpdateMemberGroupDialog({ open, member, onOpenChange, refresh }: {
  open: boolean;
  member?: OrgMember;
  onOpenChange(open: boolean): void;
  refresh(): Promise<unknown>;
}) {
  const [groupId, setGroupId] = useState<string | undefined>();
  useEffect(() => setGroupId(member?.groups?.[0]?.groupId), [member]);

  const user = useUser();
  const { data } = useQuery(getOrganizationGroups);
  const orgMemberGroups = data?.groups ?? [];
  const groupLabel = orgMemberGroups.find((g) => g.groupId === groupId)?.name || "Select a group";

  const { toast } = useToast();
  const { mutate, isPending } = useMutation(updateOrgMemberGroup);
  const onSubmit = () => {
    if (!groupId || !member) {
      return;
    }

    mutate(
      {
        userID: user?.id,
        orgMemberUserID: member.userID,
        groupId,
      },
      {
        async onSuccess(data) {
          if (data?.response?.code === EnumStatusCode.OK) {
            toast({
              description: `Member group updated to ${groupLabel} successfully.`,
              duration: 3000,
            });

            await refresh();
            onOpenChange(false);
          } else {
            toast({
              description: data?.response?.details || `Could not update member group to ${groupLabel}. Please try again`,
              duration: 3000,
            });
          }
        },
        onError() {
          toast({
            description: `Could not update member group to ${groupLabel}. Please try again`,
            duration: 3000,
          });
        },
      },
    );
  };

  const handleOnOpenChange = (v: boolean) => {
    if (isPending) {
      return;
    }

    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOnOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update member group</DialogTitle>
          <DialogDescription>
            Update the group for {member?.email}
          </DialogDescription>
        </DialogHeader>

        <div>
          <Select
            value={groupId}
            onValueChange={setGroupId}
            disabled={isPending}
          >
            <SelectTrigger value={groupId}>
              <SelectValue aria-label={groupLabel}>{groupLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {orgMemberGroups.map((group) => (
                <SelectItem
                  key={`group-${group.groupId}`}
                  value={group.groupId}
                >
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button
            disabled={!groupId}
            isLoading={isPending}
            onClick={onSubmit}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}