import { Dispatch, SetStateAction, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { z } from 'zod';
import { SiApollographql } from 'react-icons/si';
import { useMutation } from '@connectrpc/connect-query';
import { ChevronDoubleRightIcon } from '@heroicons/react/24/outline';
import { ArrowRightIcon } from '@radix-ui/react-icons';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { migrateFromApollo } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { Logo } from './logo';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Input } from './ui/input';
import { useToast } from './ui/use-toast';
import { docsBaseURL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { SubmitHandler, useZodForm } from '@/hooks/use-form';
import { useWorkspace } from '@/hooks/use-workspace';
import { useCurrentOrganization } from '@/hooks/use-current-organization';

export const MigrationDialog = ({
  refetch,
  isMigrating,
  setIsMigrating,
  setIsMigrationSuccess,
  setToken,
  isEmptyState,
  compact,
}: {
  refetch: () => void;
  isMigrating: boolean;
  setIsMigrating: Dispatch<SetStateAction<boolean>>;
  setIsMigrationSuccess: Dispatch<SetStateAction<boolean>>;
  setToken: Dispatch<SetStateAction<string | undefined>>;
  isEmptyState?: boolean;
  compact?: boolean;
}) => {
  const router = useRouter();
  const {
    namespace: { name: namespace },
  } = useWorkspace();
  const organizationSlug = useCurrentOrganization()?.slug;
  const graphsPath = organizationSlug ? `/${organizationSlug}/graphs` : '/graphs';
  const migrate = !!router.query.migrate;

  const migrateInputSchema = z.object({
    apiKey: z.string().min(1, { message: 'API Key must contain at least 1 character.' }),
    variantName: z.string().min(1, { message: 'Variant name must contain at least 1 character.' }),
  });

  type MigrateInput = z.infer<typeof migrateInputSchema>;

  const {
    register,
    formState: { isValid, errors },
    handleSubmit,
    reset,
  } = useZodForm<MigrateInput>({
    mode: 'onBlur',
    schema: migrateInputSchema,
  });

  const { toast } = useToast();

  const { mutate } = useMutation(migrateFromApollo);

  const [open, setOpen] = useState(migrate || false);

  const trigger = compact ? (
    <Card className="flex w-full items-center rounded-xl border-primary/70 bg-primary/10 px-5 py-4 text-left transition-colors hover:bg-primary/15">
      <div className="flex shrink-0 items-center gap-x-2 text-foreground">
        <SiApollographql className="size-5" />
        <ChevronDoubleRightIcon className="size-4 text-muted-foreground" />
        <Logo width={22} height={22} />
      </div>
      <div className="ml-5 min-w-0 flex-1">
        <p className="text-base font-semibold leading-5 text-primary">Migrate from Apollo</p>
        <p className="text-sm leading-5 text-muted-foreground">Bring your existing supergraph over</p>
      </div>
      <ArrowRightIcon className="ml-4 size-5 shrink-0 text-muted-foreground" />
    </Card>
  ) : (
    <Card className="flex h-full flex-col justify-center gap-y-2 bg-transparent p-4 group-hover:border-ring dark:hover:border-input-active ">
      <div className="flex items-center justify-center gap-x-5">
        <SiApollographql className="h-10 w-10" />
        <ChevronDoubleRightIcon className="animation h-8 w-8" />
        <Logo width={50} height={50} />
      </div>
      <p className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-xl font-semibold text-transparent">
        Migrate from Apollo
      </p>
    </Card>
  );

  const onSubmit: SubmitHandler<MigrateInput> = (data) => {
    setIsMigrating(true);
    mutate(
      {
        apiKey: data.apiKey,
        variantName: data.variantName,
        namespace,
      },
      {
        onSuccess: (d) => {
          setOpen(false);
          if (
            d.response?.code === EnumStatusCode.OK ||
            d.response?.code === EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED
          ) {
            toast({
              description: 'Successfully migrated the graph.',
              duration: 2000,
            });
            refetch();
            setIsMigrationSuccess(true);
            setToken(d.token);
          } else if (d.response?.details) {
            setIsMigrating(false);
            toast({ description: d.response.details, duration: 3000 });
          }
          router.replace(graphsPath);
        },
        onError: (_) => {
          toast({
            description: 'Could not migrate the graph. Please try again.',
            duration: 3000,
          });
          setOpen(false);
          setIsMigrating(false);
          router.replace(graphsPath);
        },
      },
    );
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn('w-full', {
          'min-h-[254px]': !isEmptyState,
          'text-left': compact,
        })}
      >
        {trigger}
      </DialogTrigger>
      <DialogContent>
        {!isMigrating ? (
          <>
            <DialogHeader>
              <DialogTitle>Migrate from Apollo</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-y-2">
              <p className="text-sm">
                The Graph API Key is the api key associated to the graph which has to be migrated and it should be
                obtained from Apollo Studio.
              </p>
              <p className="text-sm">
                Click{' '}
                <Link
                  href={docsBaseURL + '/studio/migrate-from-apollo'}
                  className="text-primary"
                  target="_blank"
                  rel="noreferrer"
                >
                  here
                </Link>{' '}
                to find the steps to obtain the key.
              </p>
              <p className="text-sm text-teal-400">
                Note: This key is not stored and only used to fetch the subgraphs.
              </p>
            </div>
            <form className="mt-2 flex flex-col gap-y-3" onSubmit={handleSubmit(onSubmit)}>
              <div className="flex flex-col gap-y-2">
                <span className="text-sm font-semibold">Graph API Key</span>
                <Input className="w-full" type="text" {...register('apiKey')} />
                {errors.apiKey && <span className="px-2 text-xs text-destructive">{errors.apiKey.message}</span>}
              </div>
              <div className="flex flex-col gap-y-2">
                <span className="text-sm font-semibold">Graph Variant Name</span>
                <Input className="w-full" type="text" {...register('variantName')} />
                {errors.variantName && (
                  <span className="px-2 text-xs text-destructive">{errors.variantName.message}</span>
                )}
              </div>

              <Button className="mt-2" type="submit" disabled={!isValid} variant="default">
                Migrate
              </Button>
            </form>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-y-4 py-4">
            <div className="flex items-center justify-center gap-x-5">
              <SiApollographql className="h-10 w-10" />
              <ChevronDoubleRightIcon className="animation h-8 w-8" />
              <Logo width={50} height={50} />
            </div>
            <p className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-xl font-semibold text-transparent">
              Migrating...
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
