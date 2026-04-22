import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { createOIDCProvider } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useState } from 'react';
import { useIsAdmin } from '@/hooks/use-is-admin';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { docsBaseURL } from '@/lib/constants';
import { OIDCForm, OIDCProviderInput } from './oidc-form';
import { useMutation } from '@connectrpc/connect-query';
import { useToast } from '@/components/ui/use-toast';

export interface ConnectOIDCProviderDialogProps {
  isProviderConnected: boolean;
  refetch(): Promise<unknown>;
  onProviderConnected(): void;
}

export function ConnectOIDCProviderDialog({
  isProviderConnected,
  refetch,
  onProviderConnected,
}: ConnectOIDCProviderDialogProps) {
  const isAdmin = useIsAdmin();
  const [open, setOpen] = useState(false);
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const { mutate } = useMutation(createOIDCProvider);

  const onOpenChangeCallback = (open: boolean) => {
    if (isPending && !open) {
      return;
    }

    setPending(false);
    setOpen(open);
    setError(null);
  };

  const handleSubmit = (data: OIDCProviderInput) => {
    if (!isAdmin || isPending) {
      return;
    }

    setPending(true);
    mutate(data, {
      onSuccess(data) {
        if (data.response?.code === EnumStatusCode.OK) {
          refetch().finally(() => {
            setOpen(false);
            toast({
              description: 'OIDC provider connected successfully.',
              duration: 4000,
            });

            onProviderConnected();
          });
        } else {
          setPending(false);
          setError(
            data.response?.details || 'Could not connect the OIDC provider to the organization. Please try again.',
          );
        }
      },
      onError() {
        setPending(false);
        setError('Could not connect the OIDC provider to the organization. Please try again.');
      },
    });
  };

  return (
    <Dialog open={!isProviderConnected && isAdmin && open} onOpenChange={onOpenChangeCallback}>
      {!isProviderConnected && (
        <DialogTrigger asChild>
          <Button className="md:ml-auto" variant="default">
            Connect
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect OpenID Connect Provider</DialogTitle>
          <DialogDescription className="flex flex-col gap-y-2">
            <p>
              Connecting an OIDC provider to this organization allows users to automatically log in and be part of this
              organization.
            </p>
            <p>Use Okta, Auth0 or any other OAuth2 Open ID Connect compatible provider.</p>
            <div>
              <Link
                href={docsBaseURL + '/studio/sso'}
                className="text-sm text-primary"
                target="_blank"
                rel="noreferrer"
              >
                Click here{' '}
              </Link>
              for the step by step guide to configure your OIDC provider.
            </div>
          </DialogDescription>
        </DialogHeader>

        {error && <div className="mt-2 rounded bg-destructive p-2 text-destructive-foreground">{error}</div>}

        <OIDCForm isPending={isPending} handleSubmit={handleSubmit} onCancel={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
