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
  updateOrgMemberGroup,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useMutation } from "@connectrpc/connect-query";
import { useState } from "react";
import { useUser } from "@/hooks/use-user";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { useToast } from "@/components/ui/use-toast";
import { GroupSelect } from "@/components/group-select";

export function UpdateMemberGroupDialog({ open, member, onOpenChange, refresh }: {
  open: boolean;
  member?: OrgMember;
  onOpenChange(open: boolean): void;
  refresh(): Promise<unknown>;
}) {
  const user = useUser();
  const [selectedGroup, setSelectedGroup] = useState<{ groupId: string; name: string; } | undefined>();

  const { toast } = useToast();
  const { mutate, isPending } = useMutation(updateOrgMemberGroup);
  const onSubmit = () => {
    if (!selectedGroup?.groupId || !member) {
      return;
    }

    mutate(
      {
        userID: user?.id,
        orgMemberUserID: member.userID,
        groupId: selectedGroup.groupId,
      },
      {
        async onSuccess(data) {
          if (data?.response?.code === EnumStatusCode.OK) {
            toast({
              description: `Member group updated to ${selectedGroup.name} successfully.`,
              duration: 3000,
            });

            await refresh();
            onOpenChange(false);
          } else {
            toast({
              description: data?.response?.details || `Could not update member group to ${selectedGroup.name}. Please try again`,
              duration: 3000,
            });
          }
        },
        onError() {
          toast({
            description: `Could not update member group to ${selectedGroup.name}. Please try again`,
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
          <GroupSelect
            value={selectedGroup?.groupId}
            onGroupChange={setSelectedGroup}
          />
        </div>

        <DialogFooter>
          <Button
            disabled={!selectedGroup}
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