import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { useState } from 'react';
import { useIsAdmin } from '@/hooks/use-is-admin';
import { Button, buttonVariants } from '@/components/ui/button';
import { deleteOIDCProvider } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useMutation } from '@connectrpc/connect-query';
import { useToast } from '@/components/ui/use-toast';

export interface DisconnectOIDCProviderDialogProps {
  isProviderConnected: boolean;
  refetch(): Promise<unknown>;
}

export function DisconnectOIDCProviderDialog({ isProviderConnected, refetch }: DisconnectOIDCProviderDialogProps) {
  const isAdmin = useIsAdmin();
  const [open, setOpen] = useState(false);
  const [isPending, setPending] = useState(false);

  const { toast } = useToast();
  const { mutate } = useMutation(deleteOIDCProvider);
  const onDialogOpenChange = (open: boolean) => {
    if (isPending && !open) {
      return;
    }

    setOpen(isProviderConnected && open);
    if (open) {
      setPending(false);
    }
  };

  const onSubmit = () => {
    if (!isProviderConnected || !isAdmin || isPending) {
      return;
    }

    setPending(true);
    mutate(
      {},
      {
        onSuccess(data) {
          if (data.response?.code === EnumStatusCode.OK) {
            refetch().finally(() => {
              setOpen(false);

              toast({
                description: 'OIDC provider disconnected successfully.',
                duration: 4000,
              });
            });
          } else {
            setPending(false);
            toast({
              description: data.response?.details || 'Could not disconnect the OIDC provider. Please try again.',
              duration: 4000,
            });
          }
        },
        onError() {
          setPending(false);
          toast({
            description: 'Could not disconnect the OIDC provider. Please try again.',
            duration: 4000,
          });
        },
      },
    );
  };

  return (
    <AlertDialog open={isProviderConnected && isAdmin && open} onOpenChange={onDialogOpenChange}>
      {isProviderConnected && (
        <AlertDialogTrigger asChild>
          <Button className="md:ml-auto" variant="destructive">
            Disconnect
          </Button>
        </AlertDialogTrigger>
      )}

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure you want to disconnect the OIDC provider?</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-y-1" asChild>
            <div>
              <p>
                All members who are connected to the OIDC provider will be logged out and downgraded to the viewer role.
              </p>
              <p>Reconnecting will result in a new login url.</p>
              <p>This action cannot be undone.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <Button
            className={buttonVariants({ variant: 'destructive' })}
            type="button"
            disabled={!isAdmin || isPending}
            isLoading={isPending}
            onClick={onSubmit}
          >
            Disconnect
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
