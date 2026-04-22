import { SessionClientContext, UserContext } from '@/components/app-provider';
import { EmptyState } from '@/components/empty-state';
import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CLI } from '@/components/ui/cli';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader } from '@/components/ui/loader';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { useFeature } from '@/hooks/use-feature';
import { SubmitHandler, useZodForm } from '@/hooks/use-form';
import { useIsAdmin } from '@/hooks/use-is-admin';
import { useIsCreator } from '@/hooks/use-is-creator';
import { useUser } from '@/hooks/use-user';
import { calURL, docsBaseURL, scimBaseURL } from '@/lib/constants';
import { NextPageWithLayout } from '@/lib/page';
import { useQuery, useMutation } from '@connectrpc/connect-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  getOIDCProvider,
  leaveOrganization,
  updateFeatureSettings,
  updateOrganizationDetails,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import {
  Feature,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useContext, useEffect, useState } from 'react';
import { FaMagic } from 'react-icons/fa';
import { z } from 'zod';
import { DeleteOrganization } from '@/components/settings/delete-organization';
import { RestoreOrganization } from '@/components/settings/restore-organization';
import { OIDCCard } from '@/components/oidc/oidc-card';

const OrganizationDetails = () => {
  const user = useContext(UserContext);
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const sessionQueryClient = useContext(SessionClientContext);

  const schema = z.object({
    organizationName: z
      .string()
      .min(1, {
        message: 'Organization name must be a minimum of 1 character',
      })
      .max(24, { message: 'Organization name must be maximum 24 characters' }),
    organizationSlug: z
      .string()
      .toLowerCase()
      .regex(
        new RegExp('^[a-z0-9]+(?:-[a-z0-9]+)*$'),
        'Slug should start and end with an alphanumeric character. Spaces and special characters other that hyphen not allowed.',
      )
      .min(3, {
        message: 'Organization slug must be a minimum of 3 characters',
      })
      .max(24, { message: 'Organization slug must be maximum 24 characters' })
      .refine((value) => !['login', 'signup', 'create', 'account'].includes(value), 'This slug is a reserved keyword'),
  });

  type OrganizationDetailsInput = z.infer<typeof schema>;

  const form = useZodForm<OrganizationDetailsInput>({
    schema,
    mode: 'onChange',
  });

  const { mutate, isPending } = useMutation(updateOrganizationDetails);

  const { toast } = useToast();

  const onSubmit: SubmitHandler<OrganizationDetailsInput> = (data) => {
    mutate(
      {
        userID: user?.id,
        organizationName: data.organizationName,
        organizationSlug: data.organizationSlug,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            router.replace(`/${data.organizationSlug}/settings`);
            toast({
              description: 'Organization details updated successfully.',
              duration: 3000,
            });
            sessionQueryClient.invalidateQueries({
              queryKey: ['user', router.asPath],
            });
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 3000 });
          }
        },
        onError: () => {
          toast({
            description: 'Could not update the organization details. Please try again.',
            duration: 3000,
          });
        },
      },
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-y-4">
        <FormField
          control={form.control}
          name="organizationName"
          defaultValue={user?.currentOrganization.name}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organization name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>This is the visible name of your organization within WunderGraph Cosmo.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="organizationSlug"
          defaultValue={user?.currentOrganization.slug}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organization slug</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>This is the URL namespace of the organization within WunderGraph Cosmo.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button className="ml-auto" isLoading={isPending} type="submit" disabled={!form.formState.isValid || !isAdmin}>
          Save
        </Button>
      </form>
    </Form>
  );
};

const CosmoAi = () => {
  const router = useRouter();
  const ai = useFeature('ai');
  const sessionQueryClient = useContext(SessionClientContext);
  const { mutate, isPending, data } = useMutation(updateFeatureSettings);
  const { toast } = useToast();

  const disable = () => {
    mutate(
      {
        enable: false,
        featureId: Feature.ai,
      },
      {
        onSuccess: async (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            await sessionQueryClient.invalidateQueries({
              queryKey: ['user', router.asPath],
            });
            toast({
              description: 'Disabled Cosmo AI successfully.',
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({
              description: d.response.details,
              duration: 4000,
            });
          }
        },
        onError: () => {
          toast({
            description: 'Could not disable Cosmo AI. Please try again.',
            duration: 3000,
          });
        },
      },
    );
  };

  const enable = () => {
    mutate(
      {
        enable: true,
        featureId: Feature.ai,
      },
      {
        onSuccess: async (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            await sessionQueryClient.invalidateQueries({
              queryKey: ['user', router.asPath],
            });
            toast({
              description: 'Enabled Cosmo AI successfully.',
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({
              description: d.response.details,
              duration: 4000,
            });
          }
        },
        onError: () => {
          toast({
            description: 'Could not enable Cosmo AI. Please try again.',
            duration: 3000,
          });
        },
      },
    );
  };

  const action = ai?.enabled ? (
    <Button className="md:ml-auto" type="submit" variant="destructive" isLoading={isPending} onClick={() => disable()}>
      Disable
    </Button>
  ) : (
    <Button className="md:ml-auto" type="submit" variant="default" isLoading={isPending} onClick={() => enable()}>
      Enable
    </Button>
  );

  return (
    <Card>
      <CardHeader className="gap-y-6 md:flex-row">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-x-2">
            <FaMagic />
            <span>Cosmo AI</span>
            <Badge variant="outline">Beta</Badge>
          </CardTitle>
          <CardDescription>
            Enable generative AI to create documentation for your GraphQL schema or fix queries.{' '}
            <Link
              href={docsBaseURL + '/studio/cosmo-ai'}
              className="text-sm text-primary"
              target="_blank"
              rel="noreferrer"
            >
              Learn more
            </Link>
          </CardDescription>
        </div>
        {action}
      </CardHeader>
    </Card>
  );
};

const RBAC = () => {
  const router = useRouter();
  const sessionQueryClient = useContext(SessionClientContext);
  const rbac = useFeature('rbac');
  const { mutate, isPending } = useMutation(updateFeatureSettings);
  const { toast } = useToast();

  const disable = () => {
    mutate(
      {
        enable: false,
        featureId: Feature.rbac,
      },
      {
        onSuccess: async (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            await sessionQueryClient.invalidateQueries({
              queryKey: ['user', router.asPath],
            });
            toast({
              description: 'Disabled RBAC successfully.',
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({
              description: d.response.details,
              duration: 4000,
            });
          }
        },
        onError: () => {
          toast({
            description: 'Could not disable RBAC. Please try again.',
            duration: 3000,
          });
        },
      },
    );
  };

  const enable = () => {
    mutate(
      {
        enable: true,
        featureId: Feature.rbac,
      },
      {
        onSuccess: async (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            await sessionQueryClient.invalidateQueries({
              queryKey: ['user', router.asPath],
            });
            toast({
              description: 'Enabled RBAC successfully.',
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({
              description: d.response.details,
              duration: 4000,
            });
          }
        },
        onError: () => {
          toast({
            description: 'Could not enable RBAC. Please try again.',
            duration: 3000,
          });
        },
      },
    );
  };

  const action = rbac?.enabled ? (
    <Button className="md:ml-auto" type="submit" variant="destructive" isLoading={isPending} onClick={() => disable()}>
      Disable
    </Button>
  ) : (
    <Button className="md:ml-auto" type="submit" variant="default" isLoading={isPending} onClick={() => enable()}>
      Enable
    </Button>
  );

  return (
    <Card>
      <CardHeader className="gap-y-6 md:flex-row">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-x-2">
            <span>Resource Based Access Control (RBAC)</span>
            <Badge variant="outline">Enterprise feature</Badge>
          </CardTitle>
          <CardDescription>
            Enabling RBAC allows the fine grain access control of subgraphs, federated graphs and monographs.{' '}
            <Link
              href={docsBaseURL + '/studio/graph-access-control'}
              className="text-sm text-primary"
              target="_blank"
              rel="noreferrer"
            >
              Learn more
            </Link>
          </CardDescription>
        </div>
        {rbac ? (
          action
        ) : (
          <Button className="md:ml-auto" type="submit" variant="default" asChild>
            <Link href={calURL} target="_blank" rel="noreferrer">
              Contact us
            </Link>
          </Button>
        )}
      </CardHeader>
    </Card>
  );
};

const Scim = () => {
  const router = useRouter();
  const sessionQueryClient = useContext(SessionClientContext);
  const scim = useFeature('scim');
  const { mutate, isPending } = useMutation(updateFeatureSettings);
  const { toast } = useToast();

  const disable = () => {
    mutate(
      {
        enable: false,
        featureId: Feature.scim,
      },
      {
        onSuccess: async (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            await sessionQueryClient.invalidateQueries({
              queryKey: ['user', router.asPath],
            });
            toast({
              description: 'Disabled Scim successfully.',
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({
              description: d.response.details,
              duration: 4000,
            });
          }
        },
        onError: () => {
          toast({
            description: 'Could not disable Scim. Please try again.',
            duration: 3000,
          });
        },
      },
    );
  };

  const enable = () => {
    mutate(
      {
        enable: true,
        featureId: Feature.scim,
      },
      {
        onSuccess: async (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            await sessionQueryClient.invalidateQueries({
              queryKey: ['user', router.asPath],
            });
            toast({
              description: 'Enabled Scim successfully.',
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({
              description: d.response.details,
              duration: 4000,
            });
          }
        },
        onError: () => {
          toast({
            description: 'Could not enable Scim. Please try again.',
            duration: 3000,
          });
        },
      },
    );
  };

  const action = scim?.enabled ? (
    <Button className="md:ml-auto" type="submit" variant="destructive" isLoading={isPending} onClick={() => disable()}>
      Disable
    </Button>
  ) : (
    <Button className="md:ml-auto" type="submit" variant="default" isLoading={isPending} onClick={() => enable()}>
      Enable
    </Button>
  );

  return (
    <Card>
      <CardHeader className="gap-y-6 md:flex-row">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-x-2">
            <span>System for Cross-Domain Identity Management (SCIM)</span>
            <Badge variant="outline">Enterprise feature</Badge>
          </CardTitle>
          <CardDescription>
            Enabling SCIM allows the admin to provision and unprovision the users from the Identity prodviders.{' '}
            <Link href={docsBaseURL + '/studio/scim'} className="text-sm text-primary" target="_blank" rel="noreferrer">
              Learn more
            </Link>
          </CardDescription>
        </div>
        {scim ? (
          action
        ) : (
          <Button className="md:ml-auto" type="submit" variant="default" asChild>
            <Link href={calURL} target="_blank" rel="noreferrer">
              Contact us
            </Link>
          </Button>
        )}
      </CardHeader>
      {scim?.enabled && (
        <CardContent>
          <div className="flex flex-col gap-y-2">
            <span className="px-1">SCIM server url</span>
            <CLI command={scimBaseURL} />
          </div>
        </CardContent>
      )}
    </Card>
  );
};

const LeaveOrganization = () => {
  const user = useContext(UserContext);
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const { mutate } = useMutation(leaveOrganization);

  const { toast } = useToast();

  const handleLeaveOrg = () => {
    mutate(
      {
        userID: user?.id,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            router.reload();
            toast({
              description: 'Left the organization successfully.',
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 4000 });
          }
        },
        onError: (error) => {
          toast({
            description: 'Could not leave the organization. Please try again.',
            duration: 3000,
          });
        },
      },
    );
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader className="gap-y-6 md:flex-row">
        <div className="space-y-1.5">
          <CardTitle>Leave Organization</CardTitle>
          <CardDescription>Revokes your access to this organization.</CardDescription>
        </div>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button className="md:ml-auto" type="submit" variant="destructive">
              Leave organization
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure you want to leave this organization?</AlertDialogTitle>
              <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: 'destructive' })}
                type="button"
                onClick={handleLeaveOrg}
              >
                Leave
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardHeader>
    </Card>
  );
};

const SettingsDashboardPage: NextPageWithLayout = () => {
  const user = useUser();
  const isAdmin = useIsAdmin();
  const isCreator = useIsCreator();
  const orgIsPendingDeletion = Boolean(user?.currentOrganization?.deletion);

  const {
    data: providerData,
    refetch: refetchOIDCProvider,
    isLoading: fetchingOIDCProvider,
  } = useQuery(getOIDCProvider, {
    enabled: false,
  });

  const orgs = user?.organizations?.length || 0;

  useEffect(() => {
    if (!user || !user.currentOrganization || !user.currentOrganization.slug || !refetchOIDCProvider) return;
    refetchOIDCProvider();
  }, [refetchOIDCProvider, user, user?.currentOrganization.slug]);

  if (fetchingOIDCProvider) {
    return <Loader fullscreen />;
  }

  if (!isAdmin) {
    if (isCreator) {
      return <EmptyState title="Unauthorized" description="You are not authorized to manage this organization." />;
    } else {
      return (
        <div className="flex flex-col gap-y-4">
          <LeaveOrganization />
        </div>
      );
    }
  }

  return (
    <div className="flex flex-col gap-y-4">
      <OrganizationDetails key={user?.currentOrganization.slug || ''} />
      <Separator className="my-2" />

      <CosmoAi />
      <RBAC />
      <Separator className="my-2" />

      <OIDCCard className="gap-y-6 md:flex-row" providerData={providerData} refetchOIDCProvider={refetchOIDCProvider} />

      <Scim />
      {(!isCreator || orgs > 1 || orgIsPendingDeletion) && <Separator className="my-2" />}

      {!isCreator && <LeaveOrganization />}

      {orgs > 1 && !orgIsPendingDeletion && <DeleteOrganization />}
      {isAdmin && orgIsPendingDeletion && <RestoreOrganization />}
    </div>
  );
};

SettingsDashboardPage.getLayout = (page) => {
  return getDashboardLayout(page, 'Settings', 'Settings for this organization');
};

export default SettingsDashboardPage;
