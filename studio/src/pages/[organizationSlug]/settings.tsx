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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader } from '@/components/ui/loader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { useFeature } from '@/hooks/use-feature';
import { SubmitHandler, useZodForm } from '@/hooks/use-form';
import { useIsAdmin } from '@/hooks/use-is-admin';
import { useIsCreator } from '@/hooks/use-is-creator';
import { useUser } from '@/hooks/use-user';
import { calURL, docsBaseURL, scimBaseURL } from '@/lib/constants';
import { NextPageWithLayout } from '@/lib/page';
import { MinusCircledIcon, PlusIcon } from '@radix-ui/react-icons';
import { useQuery, useMutation } from '@connectrpc/connect-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  createOIDCProvider,
  deleteOIDCProvider,
  getOIDCProvider,
  leaveOrganization,
  listOIDCProviders,
  updateFeatureSettings,
  updateIDPMappers,
  updateOrganizationDetails,
  getOrganizationGroups,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { Feature, OIDCProvider, OrganizationGroup } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Dispatch, SetStateAction, useContext, useEffect, useState } from 'react';
import { FaMagic } from 'react-icons/fa';
import { z } from 'zod';
import { DeleteOrganization } from '@/components/settings/delete-organization';
import { RestoreOrganization } from '@/components/settings/restore-organization';

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
        onError: (error) => {
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

interface Mapper {
  groupId: string;
  ssoGroup: string;
}

type MapperInput = Mapper & {
  id: number;
};

const createMapperSchema = z.object({
  groupId: z.string().uuid(),
  ssoGroup: z.string().min(1, { message: 'Please enter a value' }),
});

const saveSchema = z.array(createMapperSchema).min(1);

const NewMapper = ({
  remove,
  onChange,
  mapper,
  availableGroups,
}: {
  remove: () => void;
  onChange: (secret: Mapper) => void;
  mapper: Mapper;
  availableGroups: OrganizationGroup[];
}) => {
  type CreateMapperFormInput = z.infer<typeof createMapperSchema>;

  const groupLabel = availableGroups.find((g) => g.groupId === mapper.groupId)?.name || 'Select a group';

  const {
    register,
    formState: { errors },
  } = useZodForm<CreateMapperFormInput>({
    mode: 'onChange',
    schema: createMapperSchema,
  });

  const { ref, ...groupIdField } = register('groupId');

  return (
    <div className="flex items-center gap-x-3">
      <div className="grid flex-1 grid-cols-6 gap-x-2">
        <div className="col-span-3">
          <Select
            value={mapper.groupId}
            onValueChange={(value) => {
              onChange({
                groupId: value,
                ssoGroup: mapper.ssoGroup,
              });
            }}
            {...groupIdField}
          >
            <SelectTrigger value={mapper.groupId} className="w-[200px] lg:w-full">
              <SelectValue aria-label={groupLabel}>{groupLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableGroups.map((group) => (
                <SelectItem key={`group-${group.groupId}`} value={group.groupId}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.groupId && <span className="px-2 text-xs text-destructive">{errors.groupId.message}</span>}
        </div>
        <div className="col-span-3">
          <Input
            className="w-full"
            type="text"
            value={mapper.ssoGroup}
            placeholder="groupName or regex"
            {...register('ssoGroup')}
            onInput={(e) => {
              onChange({
                groupId: mapper.groupId,
                ssoGroup: e.currentTarget.value,
              });
            }}
          />
          {errors.ssoGroup && <span className="px-2 text-xs text-destructive">{errors.ssoGroup.message}</span>}
        </div>
      </div>
      <Button
        aria-label="remove"
        size="icon"
        variant="ghost"
        onClick={() => {
          remove();
        }}
      >
        <MinusCircledIcon />
      </Button>
    </div>
  );
};

const AddNewMappers = ({
  mappers,
  availableGroups,
  updateMappers,
}: {
  mappers: MapperInput[];
  availableGroups: OrganizationGroup[];
  updateMappers: Dispatch<SetStateAction<MapperInput[]>>;
}) => {
  return (
    <>
      {mappers.length === 0 ? (
        <div className="px-1 text-sm text-muted-foreground">No mappers have been added.</div>
      ) : (
        mappers.map((mapper, index) => (
          <NewMapper
            key={`mapper-${mapper.id}-${index}`}
            mapper={mapper}
            availableGroups={availableGroups}
            remove={() => {
              const newMappers = [...mappers];
              newMappers.splice(index, 1);
              updateMappers(newMappers);
            }}
            onChange={(newMapper) => {
              const newMappers = [...mappers];
              newMappers[index] = { ...newMappers[index], ...newMapper };
              updateMappers(newMappers);
            }}
          />
        ))
      )}
      <Button
        className="flex w-max gap-x-2"
        variant="outline"
        onClick={() => {
          const newMappers = [
            ...mappers,
            {
              id: Date.now(),
              groupId: '',
              ssoGroup: '',
            },
          ];
          updateMappers(newMappers);
        }}
      >
        <PlusIcon />
        <p>{mappers.length === 0 ? 'Add' : 'Add another'}</p>
      </Button>
    </>
  );
};

const UpdateIDPMappers = ({
  providerId,
  refetchProviderData,
}: {
  providerId: string;
  refetchProviderData: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const { mutate, isPending } = useMutation(updateIDPMappers);

  const { toast } = useToast();

  const [mappers, updateMappers] = useState<MapperInput[]>([]);

  const { data: orgMemberGroups } = useQuery(getOrganizationGroups);

  const { data: providerData, isLoading: isLoadingProvider } = useQuery(
    getOIDCProvider,
    { id: providerId },
    {
      enabled: open,
    },
  );

  useEffect(() => {
    if (!open) return;
    if (!providerData) return;
    updateMappers(
      providerData.mappers.map((m) => ({
        id: Date.now() + Math.random(),
        groupId: m.groupId,
        ssoGroup: m.ssoGroup,
      })),
    );
  }, [open, providerData]);

  const mutateMappers = () => {
    const groupMappers = mappers.map((m) => {
      return { groupId: m.groupId, ssoGroup: m.ssoGroup.trim() };
    });

    mutate(
      {
        id: providerId,
        mappers: groupMappers,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            toast({
              description: 'Group mappers updated successfully.',
              duration: 3000,
            });
            setOpen(false);
            refetchProviderData();
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 4000 });
            setOpen(false);
          }
        },
        onError: (error) => {
          toast({
            description: 'Could not update the group mappers. Please try again.',
            duration: 3000,
          });
          setOpen(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          updateMappers([]);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="submit" variant="secondary">
          Update Mappers
        </Button>
      </DialogTrigger>
      <DialogContent
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Update group mappers</DialogTitle>
          <DialogDescription>Map your groups to cosmo groups.</DialogDescription>
        </DialogHeader>
        {isLoadingProvider ? (
          <Loader />
        ) : (
          <>
            <div className="flex justify-between px-1 text-sm font-bold">
              <span>Group in cosmo</span>
              <span className="pr-12">Group in the provider</span>
            </div>
            <AddNewMappers
              mappers={mappers}
              availableGroups={orgMemberGroups?.groups ?? []}
              updateMappers={updateMappers}
            />
            <Button
              disabled={!saveSchema.safeParse(mappers).success}
              variant="default"
              size="lg"
              type="submit"
              isLoading={isPending}
              onClick={() => {
                mutateMappers();
              }}
            >
              Update
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

const ConnectOIDCProviderDialog = ({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) => {
  const [mode, setMode] = useState<'create' | 'map' | 'result'>('create');
  const { mutate, isPending, data } = useMutation(createOIDCProvider);
  const { toast } = useToast();

  const { data: orgMemberGroups } = useQuery(getOrganizationGroups, undefined, {
    enabled: mode === 'map',
  });

  const connectOIDCProviderInputSchema = z.object({
    name: z.string().min(1),
    discoveryEndpoint: z.string().startsWith('https://').min(1),
    clientID: z.string().min(1),
    clientSecret: z.string().min(1),
  });

  type ConnectOIDCProviderInput = z.infer<typeof connectOIDCProviderInputSchema>;

  const {
    register,
    formState: { isValid, errors },
    handleSubmit,
    reset,
  } = useZodForm<ConnectOIDCProviderInput>({
    mode: 'onBlur',
    schema: connectOIDCProviderInputSchema,
  });

  const [mappers, updateMappers] = useState<MapperInput[]>([]);

  useEffect(() => {
    if (!open) {
      setMode('create');
      reset();
      updateMappers([]);
    }
  }, [open, reset]);

  const onSubmit: SubmitHandler<ConnectOIDCProviderInput> = (formData) => {
    const groupMappers = mappers.map((m) => {
      return { groupId: m.groupId, ssoGroup: m.ssoGroup.trim() };
    });

    mutate(
      {
        clientID: formData.clientID,
        clientSecret: formData.clientSecret,
        discoveryEndpoint: formData.discoveryEndpoint,
        name: formData.name,
        mappers: groupMappers,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            toast({
              description: 'OIDC provider connected successfully.',
              duration: 3000,
            });

            setMode('result');
            reset();
            updateMappers([]);
            onCreated();
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 4000 });
            setMode('create');
            onOpenChange(false);
          }
        },
        onError: () => {
          toast({
            description: 'Could not connect the oidc provider to the organization. Please try again.',
            duration: 3000,
          });
          setMode('create');
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
      >
        {isPending ? (
          <Loader />
        ) : (
          <>
            <DialogHeader>
              {mode === 'create' && (
                <>
                  <DialogTitle>Connect OpenID Connect Provider</DialogTitle>
                  <DialogDescription className="flex flex-col gap-y-2">
                    <p>
                      Connecting an OIDC provider to this organization allows users to automatically log in and be part
                      of this organization.
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
                </>
              )}
              {mode === 'map' && (
                <>
                  <DialogTitle>Configure group mappers</DialogTitle>
                  <DialogDescription>Map your groups to cosmo groups.</DialogDescription>
                </>
              )}
              {mode === 'result' && (
                <>
                  <DialogTitle>Steps to configure your OIDC provider</DialogTitle>
                </>
              )}
            </DialogHeader>
            {mode !== 'result' ? (
              <form className="mt-2 flex flex-col gap-y-3" onSubmit={handleSubmit(onSubmit)}>
                {mode === 'create' && (
                  <>
                    <div className="flex flex-col gap-y-2">
                      <span className="text-sm font-semibold">Name</span>
                      <Input className="w-full" type="text" {...register('name')} />
                      {errors.name && <span className="px-2 text-xs text-destructive">{errors.name.message}</span>}
                    </div>

                    <div className="flex flex-col gap-y-2">
                      <span className="text-sm font-semibold">Discovery Endpoint</span>
                      <Input
                        className="w-full"
                        type="text"
                        placeholder="https://hostname/auth/realms/master/.wellknown/openid-configuration"
                        {...register('discoveryEndpoint')}
                      />
                      {errors.discoveryEndpoint && (
                        <span className="px-2 text-xs text-destructive">{errors.discoveryEndpoint.message}</span>
                      )}
                    </div>

                    <div className="flex flex-col gap-y-2">
                      <span className="text-sm font-semibold">Client ID</span>
                      <Input className="w-full" type="text" {...register('clientID')} />
                      {errors.clientID && (
                        <span className="px-2 text-xs text-destructive">{errors.clientID.message}</span>
                      )}
                    </div>

                    <div className="flex flex-col gap-y-2">
                      <span className="text-sm font-semibold">Client Secret</span>
                      <Input className="w-full" type="password" {...register('clientSecret')} />
                      {errors.clientSecret && (
                        <span className="px-2 text-xs text-destructive">{errors.clientSecret.message}</span>
                      )}
                    </div>

                    <Button
                      className="mt-2"
                      onClick={() => {
                        setMode('map');
                      }}
                      disabled={!isValid}
                      variant="default"
                      isLoading={isPending}
                    >
                      Connect
                    </Button>
                  </>
                )}
                {mode === 'map' && (
                  <>
                    <div className="flex justify-between px-1 text-sm font-bold">
                      <span>Group in cosmo</span>
                      <span className="pr-12">Group in the provider</span>
                    </div>
                    <AddNewMappers
                      mappers={mappers}
                      availableGroups={orgMemberGroups?.groups ?? []}
                      updateMappers={updateMappers}
                    />
                    <Button disabled={!saveSchema.safeParse(mappers).success} variant="default" size="lg" type="submit">
                      Save
                    </Button>
                  </>
                )}
              </form>
            ) : (
              <div className="flex flex-col gap-y-2">
                <div className="flex flex-col gap-y-1">
                  <span>1. Set your OIDC provider sign-in redirect URI as</span>
                  <CLI command={data?.signInURL || ''} spanClassName="w-96 truncate" />
                </div>
                <div className="flex flex-col gap-y-1">
                  <span>2. Set your OIDC provider sign-out redirect URI as</span>
                  <CLI command={data?.signOutURL || ''} spanClassName="w-96 truncate" />
                </div>

                <div className="flex flex-col gap-y-1 pt-3">
                  <span>Your users can login to the organization using the below url.</span>
                  <CLI command={data?.loginURL || ''} spanClassName="w-96 truncate" />
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

const OIDCProviderCard = ({ provider, refetch }: { provider: OIDCProvider; refetch: () => void }) => {
  const [alertOpen, setAlertOpen] = useState(false);
  const isAdmin = useIsAdmin();
  const { mutate: deleteOidcProvider, isPending: isDeleting } = useMutation(deleteOIDCProvider);
  const { toast } = useToast();

  return (
    <Card>
      <CardHeader className="gap-y-4 md:flex-row md:items-start md:gap-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-x-2">
            <span>{provider.name || 'OIDC provider'}</span>
            <Badge variant="secondary">Connected</Badge>
          </CardTitle>
          <CardDescription>
            {provider.alias ? <span className="font-mono text-xs">{provider.alias}</span> : null}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-2 md:ml-auto">
          <UpdateIDPMappers providerId={provider.id} refetchProviderData={refetch} />
          <AlertDialog open={isAdmin && alertOpen} onOpenChange={setAlertOpen}>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" disabled={!isAdmin || isDeleting}>
                Disconnect
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Are you sure you want to disconnect {provider.name || 'this OIDC provider'}?
                </AlertDialogTitle>
                <AlertDialogDescription className="flex flex-col gap-y-1" asChild>
                  <div>
                    <p>
                      All members who are connected to this SSO will be logged out and downgraded to the viewer role.
                    </p>
                    <p>Any namespaces restricted to this SSO app will become open to all login methods.</p>
                    <p>Reconnecting will result in a new login url.</p>
                    <p>This action cannot be undone.</p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className={buttonVariants({ variant: 'destructive' })}
                  type="button"
                  onClick={() => {
                    deleteOidcProvider(
                      { id: provider.id },
                      {
                        onSuccess: (d) => {
                          if (d.response?.code === EnumStatusCode.OK) {
                            refetch();
                            toast({
                              description: 'OIDC provider disconnected successfully.',
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
                            description: 'Could not disconnect the OIDC provider. Please try again.',
                            duration: 3000,
                          });
                        },
                      },
                    );
                  }}
                >
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-y-3">
        <div className="flex flex-col gap-y-2">
          <span className="px-1">OIDC provider</span>
          <CLI command={provider.endpoint ? `https://${provider.endpoint}` : ''} />
        </div>
        <div className="flex flex-col gap-y-2">
          <span className="px-1">Sign in redirect URL</span>
          <CLI command={provider.signInRedirectUrl || ''} />
        </div>
        <div className="flex flex-col gap-y-2">
          <span className="px-1">Sign out redirect URL</span>
          <CLI command={provider.signOutRedirectUrl || ''} />
        </div>
        <div className="flex flex-col gap-y-2">
          <span className="px-1">Login URL</span>
          <CLI command={provider.loginUrl || ''} />
        </div>
      </CardContent>
    </Card>
  );
};

const OpenIDConnectProviders = () => {
  const oidc = useFeature('oidc');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, refetch, isLoading } = useQuery(listOIDCProviders, {});
  const providers = data?.providers ?? [];

  return (
    <div className="flex flex-col gap-y-4">
      <Card>
        <CardHeader className="gap-y-6 md:flex-row">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-x-2">
              <span>SSO apps</span>
              <Badge variant="outline">Enterprise feature</Badge>
            </CardTitle>
            <CardDescription>
              Connect one or more OIDC providers so users can sign in to this organization via SSO. Each SSO app can be
              mapped to specific namespaces to restrict access.{' '}
              <Link
                href={docsBaseURL + '/studio/sso'}
                className="text-sm text-primary"
                target="_blank"
                rel="noreferrer"
              >
                Learn more
              </Link>
            </CardDescription>
          </div>
          {!oidc ? (
            <Button className="md:ml-auto" type="button" variant="default" asChild>
              <Link href={calURL} target="_blank" rel="noreferrer">
                Contact us
              </Link>
            </Button>
          ) : (
            <Button className="md:ml-auto" type="button" variant="default" onClick={() => setDialogOpen(true)}>
              Connect OIDC provider
            </Button>
          )}
        </CardHeader>
        {oidc && (
          <CardContent>
            {isLoading ? (
              <Loader />
            ) : providers.length === 0 ? (
              <div className="rounded-md border border-dashed p-6">
                <p className="text-sm text-muted-foreground">
                  No SSO apps are configured yet. Use the button above to connect one and enable single sign-on for this
                  organization.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-y-4">
                {providers.map((provider) => (
                  <OIDCProviderCard key={provider.id} provider={provider} refetch={refetch} />
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>
      {oidc && (
        <ConnectOIDCProviderDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onCreated={() => {
            refetch();
          }}
        />
      )}
    </div>
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
      {},
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

  const orgs = user?.organizations?.length || 0;

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

      <OpenIDConnectProviders />
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
