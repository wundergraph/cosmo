import { useContext, useState } from "react";
import { SessionClientContext, UserContext } from "@/components/app-provider";
import { z } from "zod";
import { useZodForm } from "@/hooks/use-form";
import { useToast } from "@/components/ui/use-toast";
import { useMutation } from "@connectrpc/connect-query";
import {
  deleteOrganization,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { Card, CardDescription, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const DeleteOrganization = () => {
  const user = useContext(UserContext);
  const sessionQueryClient = useContext(SessionClientContext);
  const [open, setOpen] = useState(false);

  const hasActiveSubscription = (
    !!user?.currentOrganization?.billing?.plan &&
    user?.currentOrganization?.billing?.plan !== 'developer'
  );
  const canDeleteOrganization = !hasActiveSubscription && user?.currentOrganization.roles.includes("admin");

  const regex = new RegExp(`^I want to delete the organization ${user?.currentOrganization.name}$`);
  const schema = z.object({
    organizationName: z.string().regex(regex, {
      message: "Please enter the organization name as requested.",
    }),
  });

  type DeleteOrgInput = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    reset,
  } = useZodForm<DeleteOrgInput>({
    schema,
    mode: "onChange",
  });

  const { toast } = useToast();

  const { mutate, isPending } = useMutation(deleteOrganization, {
    onSuccess: async (d) => {
      if (d.response?.code === EnumStatusCode.OK) {
        toast({
          description: "Organization deletion queued successfully.",
          duration: 3000,
        });

        await sessionQueryClient.refetchQueries();
      } else if (d.response?.details) {
        toast({ description: d.response.details, duration: 3000 });
      }

      setOpen(false);
    },
    onError: (error) => {
      toast({
        description: "Could not delete the organization. Please try again.",
        duration: 3000,
      });
      setOpen(false);
    },
  });

  const handleDeleteOrg = () => {
    if (!canDeleteOrganization) {
      return;
    }

    mutate({
      userID: user?.id,
    });
  };

  const onOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) {
      reset();
    }
  };

  return (
    <Card className="border-destructive">
      <CardHeader className="gap-y-6 md:flex-row">
        <div className="space-y-1.5">
          <CardTitle>Delete Organization</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            This action will queue the organization for deletion.
          </CardDescription>
        </div>
        <Dialog
          open={canDeleteOrganization && open}
          onOpenChange={onOpenChange}
        >
          <DialogTrigger
            className={cn({
              "cursor-not-allowed": !canDeleteOrganization,
            })}
            asChild
          >
            <Button
              type="submit"
              variant="destructive"
              className="w-full md:ml-auto md:w-max"
              disabled={!canDeleteOrganization}
            >
              Delete organization
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="leading-6">
                <span className="text-destructive">Permanently</span> delete the organization{" "}
                &quot;{user?.currentOrganization?.name}&quot;?
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(handleDeleteOrg)} className="mt-2 space-y-3">
              <div>
                <span className="font-bold">Deleting</span> the organization{" "}
                &quot;<strong>{user?.currentOrganization?.name}</strong>&quot; is a{" "}
                <span className="text-destructive font-bold">permanent action</span> that{" "}
                <span className="font-bold">cannot be undone</span>.
              </div>

              <div>
                Deleting the organization will also delete{" "}
                <span className="text-destructive font-bold">all related data</span>, including graphs, subgraphs,{" "}
                feature flags, members and API keys.
              </div>

              <div className="flex flex-col gap-y-3">
                <span>
                  To confirm, enter &quot;
                  <span className="rounded-md border px-1 font-bold focus:outline-none bg-secondary text-secondary-foreground">
                    I want to delete the organization {user?.currentOrganization.name}
                  </span>&quot;
                  in the box below:
                </span>
                <Input
                  type="text"
                  {...register("organizationName")}
                  autoFocus={true}
                />
                {errors.organizationName && (
                  <span className="px-2 text-xs text-destructive">
                    {errors.organizationName.message}
                  </span>
                )}
                <div className="mt-2 flex justify-end gap-x-4">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    isLoading={isPending}
                    type="submit"
                    disabled={!isValid}
                  >
                    Delete this organization
                  </Button>
                </div>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      {hasActiveSubscription && (
        <CardContent>
          An active subscription is associated with this organization. You must cancel the subscription before
          deleting the organization.
        </CardContent>
      )}
    </Card>
  );
};