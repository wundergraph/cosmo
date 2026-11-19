import { useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { createConnectQueryKey, useMutation } from '@connectrpc/connect-query';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  getWorkspace,
  migrateFromApollo,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { EmptyState } from './empty-state';
import { RunRouterCommand } from './federatedgraphs-cards';
import { Button } from './ui/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from './ui/form';
import { Input } from './ui/input';
import { useToast } from './ui/use-toast';
import { docsBaseURL } from '@/lib/constants';
import { SubmitHandler, useZodForm } from '@/hooks/use-form';
import { useWorkspace } from '@/hooks/use-workspace';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { useFireworks } from '@/hooks/use-fireworks';
import { buildUrl } from '@/lib/build-url';

const migrateInputSchema = z.object({
  apiKey: z.string().min(1, { message: 'API Key must contain at least 1 character.' }),
  variantName: z.string().min(1, { message: 'Variant name must contain at least 1 character.' }),
});

type MigrateInput = z.infer<typeof migrateInputSchema>;

const isSuccessfulMigration = (code?: EnumStatusCode) =>
  code === EnumStatusCode.OK || code === EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED;

export const MigrateFromApolloForm = () => {
  const queryClient = useQueryClient();
  const {
    namespace: { name: namespace },
  } = useWorkspace();
  const organizationSlug = useCurrentOrganization()?.slug;
  const graphsPath = buildUrl('/:organizationSlug/graphs', { organizationSlug });

  const form = useZodForm<MigrateInput>({
    mode: 'onChange',
    schema: migrateInputSchema,
  });

  const { toast } = useToast();
  const { mutate, isPending, data: migration } = useMutation(migrateFromApollo);
  const isMigrated = isSuccessfulMigration(migration?.response?.code);
  const [showRouterCommand, setShowRouterCommand] = useState(true);

  useFireworks(isMigrated);

  const onSubmit: SubmitHandler<MigrateInput> = (data) => {
    mutate(
      { apiKey: data.apiKey, variantName: data.variantName, namespace },
      {
        onSuccess: async (d) => {
          if (isSuccessfulMigration(d.response?.code)) {
            await queryClient.refetchQueries({
              queryKey: createConnectQueryKey({ schema: getWorkspace, cardinality: undefined }),
            });
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 3000 });
          }
        },
        onError: () => {
          toast({ description: 'Could not migrate the graph. Please try again.', duration: 3000 });
        },
      },
    );
  };

  if (isMigrated) {
    return (
      <>
        <RunRouterCommand
          open={showRouterCommand}
          setOpen={setShowRouterCommand}
          token={migration.token}
          hint="The Graph API Token which is scoped to the migrated federated graph is generated. Please store it safely for future use."
        />
        <EmptyState
          icon={<CheckCircleIcon className="text-success" />}
          title="Graph migrated"
          description="Run the router with the generated token to start serving your graph."
          actions={
            <div className="flex gap-x-2">
              <Button variant="outline" onClick={() => setShowRouterCommand(true)}>
                Show router command
              </Button>
              <Button asChild>
                <Link href={graphsPath}>Go to graphs</Link>
              </Button>
            </div>
          }
        />
      </>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-y-4">
        <FormField
          control={form.control}
          name="apiKey"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Graph API Key</FormLabel>
              <FormControl>
                <Input {...field} autoFocus />
              </FormControl>
              <FormDescription>
                The API key of the graph to migrate, from Apollo Studio. It is not stored and is only used to fetch the
                subgraphs. Learn how to get one{' '}
                <Link
                  href={docsBaseURL + '/studio/migrate-from-apollo'}
                  className="text-primary"
                  target="_blank"
                  rel="noreferrer"
                >
                  here.
                </Link>
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="variantName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Graph Variant Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>The variant of the graph to migrate, e.g. current.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button className="ml-auto" isLoading={isPending} type="submit" disabled={isPending || !form.formState.isValid}>
          Migrate Graph
        </Button>
      </form>
    </Form>
  );
};
