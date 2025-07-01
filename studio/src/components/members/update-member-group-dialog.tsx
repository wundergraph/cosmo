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
import { useEffect, useState } from "react";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { useToast } from "@/components/ui/use-toast";
import { MultiGroupSelect } from "@/components/multi-group-select";

export function UpdateMemberGroupDialog({ open, member, onOpenChange, refresh }: {
  open: boolean;
  member?: OrgMember;
  onOpenChange(open: boolean): void;
  refresh(): Promise<unknown>;
}) {
  const [selectedGroups, setSelectedGroups] = useState<{ groupId: string; name: string; }[]>([]);
  useEffect(() => {
    if (member?.groups) {
      setSelectedGroups(member.groups);
    }
  }, [member]);

  const { toast } = useToast();
  const { mutate, isPending } = useMutation(updateOrgMemberGroup);
  const onSubmit = () => {
    if (selectedGroups.length === 0 || !member) {
      return;
    }

    mutate(
      {
        orgMemberUserID: member.userID,
        groups: selectedGroups.map((group) => group.groupId),
      },
      {
        async onSuccess(data) {
          if (data?.response?.code === EnumStatusCode.OK) {
            toast({
              description: 'Member groups updated successfully.',
              duration: 3000,
            });

            await refresh();
            onOpenChange(false);
          } else {
            toast({
              description: data?.response?.details || 'Could not update the member groups. Please try again',
              duration: 3000,
            });
          }
        },
        onError() {
          toast({
            description: 'Could not update the member groups. Please try again',
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
          <DialogTitle>Update member groups</DialogTitle>
          <DialogDescription>
            Update groups for {member?.email}
          </DialogDescription>
        </DialogHeader>

        <div>
          <MultiGroupSelect
            disabled={isPending}
            value={selectedGroups.map((group) => group.groupId)}
            onValueChange={setSelectedGroups}
          />
        </div>

        <DialogFooter>
          <Button
            disabled={selectedGroups.length === 0}
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