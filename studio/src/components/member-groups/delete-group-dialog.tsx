import type { OrganizationGroup } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
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
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { GroupSelect } from "@/components/group-select";

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

            onOpenChange(false);
            deleteForm.reset();
            await onGroupDeleted();
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
      <DialogTrigger asChild />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete group</DialogTitle>
          <DialogDescription>Are you sure you want to delete this group?</DialogDescription>
        </DialogHeader>

        <Form {...deleteForm}>
          <form
            className="mt-1 flex flex-col gap-y-4"
            onSubmit={deleteForm.handleSubmit(onSubmit)}
          >
            {group?.membersCount || group?.apiKeysCount || group?.hasOidcMappers ? (
              <>

                <span>
                <span className="font-semibold">Before deleting</span> the group, you must select a new group. This is because:
                </span>

                <ol className="list-disc ml-8 space-y-2">
                  {group.hasOidcMappers && (
                    <li>
                      One or more OIDC mapper targets this group, we need to update the mappers so{" "}
                      when user sign in using SSO they don&apos;t lose access to the organization.
                    </li>
                  )}
                  {!!group.membersCount && (
                    <li>
                      {group.membersCount === 1 ? "One member " : "Multiple members "} have been
                      assigned to this group.
                    </li>
                  )}
                  {!!group.apiKeysCount && (
                    <li>
                      {group.apiKeysCount === 1 ? "One API Key" : "Multiple API Keys"} have been
                      assigned to this group.
                    </li>
                  )}
                </ol>

                <FormField
                  control={deleteForm.control}
                  name="toGroupId"
                  render={({ field: { value, onChange } }) => (
                    <FormItem>
                      <FormControl>
                        <GroupSelect
                          value={value}
                          groups={otherGroups}
                          onValueChange={(group) => onChange(group.groupId)}
                        />
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
      </DialogContent>
    </Dialog>
  );
}