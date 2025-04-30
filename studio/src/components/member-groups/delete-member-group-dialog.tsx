import type { OrganizationGroup } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation } from "@connectrpc/connect-query";
import {
  deleteOrganizationGroup,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { z } from "zod";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { useToast } from "@/components/ui/use-toast";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";

export function DeleteMemberGroupDialog({ open, group, existingGroups, onGroupDeleted, onOpenChange }: {
  open: boolean;
  group: OrganizationGroup | null;
  existingGroups: OrganizationGroup[];
  onGroupDeleted(): Promise<unknown>;
  onOpenChange(open: boolean): void;
}) {
  const { toast } = useToast();
  const { mutate, isPending } = useMutation(deleteOrganizationGroup);
  const otherGroups = existingGroups.filter((g) => g.groupId !== group?.groupId);

  function handleOnOpenChange(open: boolean) {
    if (isPending) {
      // Prevent closing the dialog while the operation is going
      return;
    }

    onOpenChange(open);
    reset();
  }

  const regex = new RegExp(`^${group?.name}$`);
  const schema = z.object({
    name: z.string().regex(regex, {
      message: "Please enter the rule set name as requested.",
    }),
  });

  type DeleteGroupInput = z.infer<typeof schema>;

  const {
    register,
    formState: { isValid, errors },
    handleSubmit,
    reset,
  } = useZodForm<DeleteGroupInput>({
    mode: "onChange",
    schema: schema,
  });

  const onSubmit: SubmitHandler<DeleteGroupInput> = () => {
    if (!group) {
      return;
    }

    mutate(
      { groupId: group.groupId },
      {
        async onSuccess(resp) {
          if (resp?.response?.code === EnumStatusCode.OK) {
            toast({
              description: "Group deleted successfully.",
              duration: 3000,
            });

            await onGroupDeleted();
            onOpenChange(false);
            reset();
          } else {
            toast({
              description: resp?.response?.details ?? "Could not delete the group. Please try again.",
              duration: 3000,
            });
          }
        },
        onError() {
          toast({
            description: "Could not delete the group. Please try again.",
            duration: 3000,
          });
        },
      },
    )
  };

  return (
    <Dialog open={!!group && open} onOpenChange={handleOnOpenChange}>
      <DialogTrigger />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete group</DialogTitle>
        </DialogHeader>

        {group?.membersCount && otherGroups.length === 0 ? (
          <></>
        ) : (
          <form
            className="mt-4 flex flex-col gap-y-3"
            onSubmit={handleSubmit(onSubmit)}
          >
            <div>Are you sure you want to delete this group?</div>

            {group?.membersCount && (
              <>
                <div>
                  Select
                </div>
              </>
            )}

            <div>
              Enter <strong>{group?.name}</strong> to confirm you want to delete this group.
            </div>

            <Input
              className="w-full"
              type="text"
              {...register("name")}
              autoFocus
              disabled={isPending}
            />

            {errors.name && (
              <div className="px-2 text-xs text-destructive">
                {errors.name.message}
              </div>
            )}

            <Button
              type="submit"
              variant="destructive"
              disabled={!isValid || isPending}
              isLoading={isPending}
            >
              Delete group
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}