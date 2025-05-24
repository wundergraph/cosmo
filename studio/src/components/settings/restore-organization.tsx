import { useContext, useState } from "react";
import { SessionClientContext } from "@/components/app-provider";
import { useToast } from "@/components/ui/use-toast";
import { useMutation } from "@connectrpc/connect-query";
import {
  restoreOrganization
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { Card, CardDescription, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useUser } from "@/hooks/use-user";

export const RestoreOrganization = () => {
  const user = useUser();
  const sessionQueryClient = useContext(SessionClientContext);
  const isAdmin = useIsAdmin();
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const { mutate, isPending } = useMutation(restoreOrganization, {
    onSuccess: async (d) => {
      if (d.response?.code === EnumStatusCode.OK) {
        toast({
          description: "Organization restored successfully.",
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
        description: "Could not restore the organization. Please try again.",
        duration: 3000,
      });

      setOpen(false);
    },
  });

  return (
    <Card>
      <CardHeader className="gap-y-6 md:flex-row">
        <div className="space-y-1.5">
          <CardTitle>Restore Organization</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Cancels the organization deletion.
          </CardDescription>
        </div>
        <Dialog
          open={open}
          onOpenChange={setOpen}
        >
          <DialogTrigger asChild>
            <Button
              className="w-full md:ml-auto md:w-max"
              isLoading={isPending}
              disabled={!isAdmin}
            >
              Restore Organization
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Restore {user?.currentOrganization?.name}
              </DialogTitle>
            </DialogHeader>

            <p>
              The deletion operation will be canceled upon restoring the organization.
            </p>

            <div className="mt-2 flex justify-end gap-x-4">
              <Button
                variant="outline"
                isLoading={isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                isLoading={isPending}
                onClick={() => mutate({ userID: user?.id })}
              >
                Restore this organization
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
    </Card>
  );
};