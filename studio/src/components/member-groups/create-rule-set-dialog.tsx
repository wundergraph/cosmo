import { OrganizationRuleSet } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMutation } from "@connectrpc/connect-query";
import {
  createOrganizationRuleSet,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { z } from "zod";
import { useZodForm } from "@/hooks/use-form";
import { SubmitHandler } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";

export function CreateRuleSetDialog({ existingRuleSetNames, onRuleSetCreated }: {
  existingRuleSetNames: string[];
  onRuleSetCreated(ruleSet: OrganizationRuleSet): Promise<void>
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { mutate, isPending } = useMutation(createOrganizationRuleSet);

  const createRuleSetInputSchema = z.object({
    name: z
      .string()
      .trim()
      .min(3, { message: "Rule set name must be a minimum of 3 characters" })
      .max(50, { message: "Rule set name must be maximum 50 characters" })
      .superRefine((arg, ctx) => {
        if (!existingRuleSetNames.includes(arg.toLowerCase())) {
          return;
        }

        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `A rule set with the name ${arg} already exists`
        });
      }),
  });

  type CreateRuleSetInput = z.infer<typeof createRuleSetInputSchema>;

  const {
    register,
    formState: { isValid, errors },
    handleSubmit,
    reset,
    setError,
  } = useZodForm<CreateRuleSetInput>({
    mode: "onChange",
    schema: createRuleSetInputSchema,
  });

  const onSubmit: SubmitHandler<CreateRuleSetInput> = (data) => {
    mutate(
      { name: data.name },
      {
        async onSuccess(data) {
          if (data.response?.code === EnumStatusCode.OK) {
            if (data.ruleSet) {
              await onRuleSetCreated(data.ruleSet);
              setOpen(false);
              reset();
            }
          } else if (data.response?.details) {
            setError('name', { message: data.response.details });
          }
        },
        onError() {
          toast({
            description: "Could not create the rule set at this time. Please try again.",
            duration: 3000,
          });
        },
      }
    )
  };

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
        <Button>Create Rule Set</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Rule Set</DialogTitle>
        </DialogHeader>
        <form
          className="mt-4 flex flex-col gap-y-3"
          onSubmit={handleSubmit(onSubmit)}>
          <div className="flex flex-col gap-y-2">
            <label
              htmlFor="create-rule-set-name"
              className="text-sm font-semibold">
              Name
            </label>
            <Input id="create-rule-set-name" className="w-full" type="text" {...register("name")} />
            {errors.name && (
              <span className="px-2 text-xs text-destructive">
                {errors.name.message}
              </span>
            )}
          </div>

          <Button
            type="submit"
            disabled={!isValid}
            variant="default"
            isLoading={isPending}
          >
            Create Rule Set
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}