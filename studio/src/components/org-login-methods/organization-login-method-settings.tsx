import { useState, useEffect, useMemo } from 'react';
import { useMutation } from '@connectrpc/connect-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OIDCProvider, OrganizationLoginMethods } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { updateOrganizationLoginMethods } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MultiSelect, MultiSelectOption } from '@/components/ui/multi-select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { docsBaseURL } from '@/lib/constants';
import Link from 'next/link';

// Sentinel values representing built-in methods, which are not SSO provider ids.
const PASSWORD_VALUE = '__password__';
const GOOGLE_VALUE = '__google__';
const GITHUB_VALUE = '__github__';
const BUILTIN_VALUES = new Set([PASSWORD_VALUE, GOOGLE_VALUE, GITHUB_VALUE]);

// Stable key describing the allowed methods, for dirty-state and diffing.
const methodsKey = (values: string[]) => [...values].sort().join(',');

const SectionCard = ({ children }: { children: React.ReactNode }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization</CardTitle>
        <CardDescription>
          Choose which login methods can be used to access this organization. Leave it empty to allow all methods.
          Members who use a method you remove lose access on their next request.{' '}
          <Link
            href={docsBaseURL + '/studio/organization-login-methods'}
            className="text-primary"
            target="_blank"
            rel="noreferrer"
          >
            Learn more
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
};

// Map the server's allow-flags into the multiselect's selected values.
const toSelected = (m: {
  allowPasswordLogin: boolean;
  allowGoogleLogin: boolean;
  allowGithubLogin: boolean;
  allowedSsoProviderIds: string[];
}): string[] => {
  const values: string[] = [];
  if (m.allowPasswordLogin) values.push(PASSWORD_VALUE);
  if (m.allowGoogleLogin) values.push(GOOGLE_VALUE);
  if (m.allowGithubLogin) values.push(GITHUB_VALUE);
  values.push(...m.allowedSsoProviderIds);
  return values;
};

export function OrganizationLoginMethodSettings({
  loginMethods,
  providers,
  refetchLoginMethods,
}: {
  // The org's current allow-list, fetched and entitlement-gated by the page.
  loginMethods: OrganizationLoginMethods | undefined;
  // Connected OIDC providers, fetched by the page (used as SSO-app options).
  providers: OIDCProvider[];
  // Refetches the page's getOrganizationLoginMethods query after a save.
  refetchLoginMethods: () => void;
}) {
  const { toast } = useToast();

  const { mutate, isPending } = useMutation(updateOrganizationLoginMethods);

  // Selected method values. Empty means "no restriction" — all methods allowed.
  const [selected, setSelected] = useState<string[]>([]);
  // Server snapshot — used for dirty-state and the narrowing warning.
  const [server, setServer] = useState<string[]>([]);

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingAffectedNamespaces, setPendingAffectedNamespaces] = useState<string[]>([]);

  useEffect(() => {
    if (!loginMethods) return;
    const next = toSelected(loginMethods);
    setSelected(next);
    setServer(next);
  }, [loginMethods]);

  const methodOptions = useMemo<MultiSelectOption[]>(
    () => [
      { value: PASSWORD_VALUE, label: 'Password login', description: 'Email and password sign-in', group: 'Password' },
      { value: GOOGLE_VALUE, label: 'Google', description: 'Sign in with Google', group: 'Social login' },
      { value: GITHUB_VALUE, label: 'GitHub', description: 'Sign in with GitHub', group: 'Social login' },
      ...providers.map((p) => ({
        value: p.id,
        label: p.name || p.alias || 'OIDC provider',
        description: p.alias || undefined,
        group: 'SSO apps',
      })),
    ],
    [providers],
  );

  const isDirty = useMemo(() => methodsKey(selected) !== methodsKey(server), [selected, server]);

  const doSave = (confirmNamespaceChanges: boolean) => {
    mutate(
      {
        allowPasswordLogin: selected.includes(PASSWORD_VALUE),
        allowGoogleLogin: selected.includes(GOOGLE_VALUE),
        allowGithubLogin: selected.includes(GITHUB_VALUE),
        allowedSsoProviderIds: selected.filter((v) => !BUILTIN_VALUES.has(v)),
        confirmNamespaceChanges,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            if (d.requiresConfirmation) {
              setPendingAffectedNamespaces(d.affectedNamespaces.map((n) => n.name));
              setConfirmDialogOpen(true);
            } else {
              toast({ description: 'Organization login methods updated successfully.', duration: 3000 });
              refetchLoginMethods();
            }
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 4000 });
          }
        },
        onError: () => {
          toast({
            description: 'Could not update organization login methods. Please try again.',
            duration: 3000,
          });
        },
      },
    );
  };

  const onSave = () => doSave(false);
  const onConfirm = () => {
    setConfirmDialogOpen(false);
    doSave(true);
  };

  return (
    <SectionCard>
      <div className="flex flex-col gap-y-6">
        <div className="flex flex-col gap-y-2">
          <p className="text-sm font-medium text-muted-foreground">Allowed login methods</p>
          <MultiSelect
            options={methodOptions}
            selected={selected}
            disabled={isPending}
            placeholder="Select login methods (leave empty to allow all)"
            searchPlaceholder="Search login methods…"
            emptyText="No login methods available."
            onChange={setSelected}
          />
          <p className="text-xs text-muted-foreground">
            Leave it empty to allow all login methods. Select one or more to restrict the organization to only those.
          </p>
        </div>

        <div className="flex justify-end">
          <Button type="button" isLoading={isPending} disabled={!isDirty} onClick={onSave}>
            Save
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm login method changes</AlertDialogTitle>
            <AlertDialogDescription>
              These namespaces are restricted to login methods you&apos;re removing. They will become open to your
              remaining allowed methods.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingAffectedNamespaces.length > 0 && (
            <ul className="ml-4 list-disc text-sm text-muted-foreground">
              {pendingAffectedNamespaces.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}
