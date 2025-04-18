import type { OrganizationRuleSet } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation } from "@connectrpc/connect-query";
import {
  deleteOrganizationRuleSet,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { z } from "zod";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { useToast } from "@/components/ui/use-toast";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";

export function DeleteRuleSetDialog({ open, ruleSet, onRuleSetDeleted, onOpenChange }: {
  open: boolean;
  ruleSet: OrganizationRuleSet | null;
  onRuleSetDeleted(): Promise<unknown>;
  onOpenChange(open: boolean): void;
}) {
  const { toast } = useToast();
  const { mutate, isPending } = useMutation(deleteOrganizationRuleSet);

  function handleOnOpenChange(open: boolean) {
    if (isPending) {
      // Prevent closing the dialog while the operation is going
      return;
    }

    onOpenChange(open);
    reset();
  }

  const regex = new RegExp(`^${ruleSet?.name}$`);
  const schema = z.object({
    name: z.string().regex(regex, {
      message: "Please enter the rule set name as requested.",
    }),
  });

  type DeleteRuleSetInput = z.infer<typeof schema>;

  const {
    register,
    formState: { isValid, errors },
    handleSubmit,
    reset,
  } = useZodForm<DeleteRuleSetInput>({
    mode: "onChange",
    schema: schema,
  });

  const onSubmit: SubmitHandler<DeleteRuleSetInput> = () => {
    if (!ruleSet) {
      return;
    }

    mutate(
      { ruleSetId: ruleSet.ruleSetId },
      {
        async onSuccess(resp) {
          if (resp?.response?.code === EnumStatusCode.OK) {
            toast({
              description: "Rule set deleted successfully.",
              duration: 3000,
            });

            await onRuleSetDeleted();
            onOpenChange(false);
            reset();
          } else {
            toast({
              description: resp?.response?.details ?? "Could not delete the rule set. Please try again.",
              duration: 3000,
            });
          }
        },
        onError() {
          toast({
            description: "Could not delete the rule set. Please try again.",
            duration: 3000,
          });
        },
      },
    )
  };

  return (
    <Dialog open={!!ruleSet && open} onOpenChange={handleOnOpenChange}>
      <DialogTrigger />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete rule set</DialogTitle>
        </DialogHeader>

        <form
          className="mt-4 flex flex-col gap-y-3"
          onSubmit={handleSubmit(onSubmit)}
        >
          <div>Are you sure you want to delete this rule set?</div>
          {ruleSet?.membersCount
            ? (
              <>
                <div></div>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </>
            )
            : (
              <>
                <div>
                  Enter <strong>{ruleSet?.name}</strong> to confirm you want to delete this rule set.
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
                  Delete rule set
                </Button>
              </>
            )}
        </form>
      </DialogContent>
    </Dialog>
  );
}