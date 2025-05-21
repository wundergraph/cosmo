import { OrganizationGroup } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { useMutation } from "@connectrpc/connect-query";
import {
  createOrganizationGroup,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { z } from "zod";
import { useZodForm } from "@/hooks/use-form";
import { SubmitHandler } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { useFeature } from "@/hooks/use-feature";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsAdmin } from "@/hooks/use-is-admin";

export function CreateGroupDialog({ onGroupCreated }: {
  onGroupCreated(group: OrganizationGroup): Promise<void>
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { mutate, isPending } = useMutation(createOrganizationGroup);
  const rbac = useFeature("rbac");
  const isAdmin = useIsAdmin();

  const createGroupInputSchema = z.object({
    name: z
      .string()
      .trim()
      .min(3, { message: "Group name must be a minimum of 3 characters" })
      .max(50, { message: "Group name must be maximum 50 characters" })
      .regex(
        new RegExp("^[a-zA-Z0-9]+(?:[_.@/-][a-zA-Z0-9]+)*$"),
        "The name should start and end with an alphanumeric character. Only '.', '_', '@', '/', and '-' are allowed as separators in between.",
      ),
    description: z
      .string()
      .trim()
      .max(500, { message: "Description must be a maximum of 500 characters" }),
  });

  type CreateGroupInput = z.infer<typeof createGroupInputSchema>;

  const {
    register,
    formState: { isValid, errors },
    handleSubmit,
    reset,
    setError,
  } = useZodForm<CreateGroupInput>({
    mode: "onChange",
    schema: createGroupInputSchema,
  });

  const onSubmit: SubmitHandler<CreateGroupInput> = (data) => {
    if (!rbac?.enabled) {
      return;
    }

    mutate(
      { name: data.name, description: data.description },
      {
        async onSuccess(data) {
          if (data.response?.code === EnumStatusCode.OK) {
            if (data.group) {
              toast({
                description: "Group created successfully",
                duration: 3000,
              });

              setOpen(false);
              reset();
              await onGroupCreated(data.group);
            }
          } else if (data.response?.details) {
            setError('name', { message: data.response.details });
          }
        },
        onError() {
          toast({
            description: "Could not create the group at this time. Please try again.",
            duration: 3000,
          });
        },
      }
    )
  };

  if (!isAdmin) {
    return null;
  }

  if (!rbac?.enabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={buttonVariants({ className: "cursor-default opacity-50 hover:!bg-primary" })}>
            New Group
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[300px] text-center">
          You need to enable RBAC on the organization settings to be able to create new groups.
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) {
          reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>New Group</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create group</DialogTitle>
        </DialogHeader>
        <form
          className="mt-4 flex flex-col gap-y-3"
          onSubmit={handleSubmit(onSubmit)}>
          <div className="flex flex-col gap-y-2">
            <label
              htmlFor="create-group-name"
              className="text-sm font-semibold"
            >
              Name{" "}
              <span className="text-destructive">*</span>
            </label>
            <Input
              id="create-group-name"
              className="w-full"
              disabled={isPending}
              type="text" {...register("name")}
            />

            {errors.name && (
              <span className="px-2 text-xs text-destructive">
                {errors.name.message}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-y-2">
            <label
              htmlFor="create-group-description"
              className="text-sm font-semibold"
            >
              Description
            </label>
            <Textarea
              id="create-group-description"
              className="w-full"
              disabled={isPending}
              rows={5}
              {...register("description")}
            />

            {errors.description && (
              <span className="px-2 text-xs text-destructive">
                {errors.description.message}
              </span>
            )}
          </div>

          <Button
            type="submit"
            disabled={!isValid || isPending}
            variant="default"
            isLoading={isPending}
          >
            New Group
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}