import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { GetOIDCProviderResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CLI } from '@/components/ui/cli';
import { Button } from '@/components/ui/button';

export interface OIDCInfoDialogProps {
  open: boolean;
  providerData: GetOIDCProviderResponse | undefined;
  onClose(): void;
}

export function OIDCInfoDialog({ open, providerData, onClose }: OIDCInfoDialogProps) {
  return (
    <Dialog open={open}>
      <DialogTrigger />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Steps to configure your OIDC provider</DialogTitle>
        </DialogHeader>

        <div className="mt-2 flex flex-col gap-y-2">
          <div className="flex flex-col gap-y-1">
            <span>1. Set your OIDC provider sign-in redirect URI as</span>
            <CLI command={providerData?.signInRedirectURL || ''} spanClassName="w-96 truncate" />
          </div>
          <div className="flex flex-col gap-y-1">
            <span>2. Set your OIDC provider sign-out redirect URI as</span>
            <CLI command={providerData?.signOutRedirectURL || ''} spanClassName="w-96 truncate" />
          </div>

          <div className="flex flex-col gap-y-1 pt-3">
            <span>Your users can login to the organization using the below url.</span>
            <CLI command={providerData?.loginURL || ''} spanClassName="w-96 truncate" />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onClose()} variant="outline">
            Update Mappers
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
