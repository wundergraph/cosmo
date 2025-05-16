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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";

const groupIdValidator = z
  .string()
  .uuid({ message: "Please select a valid group."});

export function DeleteGroupDialog({ open, group, existingGroups, onGroupDeleted, onOpenChange }: {
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
    deleteForm.reset();
  }

  const regex = new RegExp(`^${group?.name}$`);
  const schema = z.object({
    name: z.string().regex(regex, {
      message: "Please enter the rule set name as requested.",
    }),
    toGroupId: group?.membersCount && otherGroups.length > 0
      ? groupIdValidator
      : groupIdValidator.optional(),
  });

  type DeleteGroupInput = z.infer<typeof schema>;

  const deleteForm = useZodForm<DeleteGroupInput>({
    mode: "onChange",
    schema: schema,
  });

  const onSubmit: SubmitHandler<DeleteGroupInput> = ({ toGroupId }) => {
    if (!group) {
      return;
    }

    mutate(
      { groupId: group.groupId, toGroupId },
      {
        async onSuccess(resp) {
          if (resp?.response?.code === EnumStatusCode.OK) {
            toast({
              description: "Group deleted successfully.",
              duration: 3000,
            });

            await onGroupDeleted();
            onOpenChange(false);
            deleteForm.reset();
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
          <Form {...deleteForm}>
            <form
              className="mt-4 flex flex-col gap-y-3"
              onSubmit={deleteForm.handleSubmit(onSubmit)}
            >
              <div>Are you sure you want to delete this group?</div>

              {group?.membersCount ? (
                <>
                  <div>
                    {group.membersCount === 1 ? "One member is " : "Multiple members are "}
                    part of this group, to continue with the deletion you must select a new group for the
                    member(s) using the box below.
                  </div>

                  <FormField
                    control={deleteForm.control}
                    name="toGroupId"
                    render={({ field: { value, onChange } }) => (
                      <FormItem>
                        <FormControl>
                          <Select value={value} onValueChange={onChange}>
                            <SelectTrigger>
                              <SelectValue>
                                {otherGroups.find((g) => g.groupId === value)?.name ?? "Select a role"}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {otherGroups.map((group) => (
                                <SelectItem key={`group-${group.groupId}`} value={group.groupId}>
                                  {group.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>

                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              ) : null}

              <div>
                Enter <strong>{group?.name}</strong> to confirm you want to delete this group.
              </div>

              <div className="space-y-2">
                <FormField
                  control={deleteForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          className="w-full"
                          type="text"
                          autoFocus
                          disabled={isPending}
                          {...field}
                        />
                      </FormControl>

                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button
                type="submit"
                variant="destructive"
                disabled={!deleteForm.formState.isValid || isPending}
                isLoading={isPending}
              >
                Delete group
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}