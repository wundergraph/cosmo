import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFeature } from '@/hooks/use-feature';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { calURL, docsBaseURL } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { CLI } from '@/components/ui/cli';
import { ConnectOIDCProviderDialog } from './connect-oidc-provider-dialog';
import { DisconnectOIDCProviderDialog } from './disconnect-oidc-provider-dialog';
import { UpdateMappersDialog } from './update-mappers-dialog';
import { OIDCInfoDialog } from './oidc-info-dialog';
import { GetOIDCProviderResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { useState } from 'react';

export interface OIDCCardProps {
  className?: string;
  providerData?: GetOIDCProviderResponse;
  refetchOIDCProvider(): Promise<unknown>;
}

export function OIDCCard({ className, providerData, refetchOIDCProvider }: OIDCCardProps) {
  const oidc = useFeature('oidc');
  const [wasProviderJustConnected, setWasProviderJustConnected] = useState(false);
  const [forceOpenMappersDialog, setForceOpenMappersDialog] = useState(false);

  return (
    <Card>
      <CardHeader className={cn(className)}>
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-x-2">
            <span>Connect OIDC provider</span>
            <Badge variant="outline">Enterprise feature</Badge>
          </CardTitle>
          <CardDescription>
            Connecting an OIDC provider allows users to automatically log in and be a part of this organization.{' '}
            <Link href={docsBaseURL + '/studio/sso'} className="text-sm text-primary" target="_blank" rel="noreferrer">
              Learn more
            </Link>
          </CardDescription>
        </div>
        {!oidc ? (
          <Button className="md:ml-auto" type="submit" variant="default" asChild>
            <Link href={calURL} target="_blank" rel="noreferrer">
              Contact us
            </Link>
          </Button>
        ) : (
          <div className="ml-auto flex gap-x-3">
            <OIDCInfoDialog
              open={wasProviderJustConnected}
              providerData={providerData}
              onClose={() => {
                setWasProviderJustConnected(false);
                setForceOpenMappersDialog(true);
              }}
            />

            <UpdateMappersDialog
              forceOpen={forceOpenMappersDialog}
              isProviderConnected={!!providerData?.name}
              currentMappers={providerData?.mappers ?? []}
              refetch={refetchOIDCProvider}
              onClose={() => setForceOpenMappersDialog(false)}
            />

            <ConnectOIDCProviderDialog
              isProviderConnected={!!providerData?.name}
              refetch={refetchOIDCProvider}
              onProviderConnected={() => setWasProviderJustConnected(true)}
            />
            <DisconnectOIDCProviderDialog isProviderConnected={!!providerData?.name} refetch={refetchOIDCProvider} />
          </div>
        )}
      </CardHeader>
      {providerData?.name && (
        <CardContent className="flex flex-col gap-y-3">
          <div className="flex flex-col gap-y-2">
            <span className="px-1">OIDC provider</span>
            <CLI command={`https://${providerData.endpoint}`} />
          </div>
          <div className="flex flex-col gap-y-2">
            <span className="px-1">Sign in redirect URL</span>
            <CLI command={providerData?.signInRedirectURL || ''} />
          </div>
          <div className="flex flex-col gap-y-2">
            <span className="px-1">Sign out redirect URL</span>
            <CLI command={providerData?.signOutRedirectURL || ''} />
          </div>
          <div className="flex flex-col gap-y-2">
            <span className="px-1">Login URL</span>
            <CLI command={providerData?.loginURL || ''} />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
