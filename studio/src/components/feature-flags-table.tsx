import { useUser } from '@/hooks/use-user';
import { docsBaseURL } from '@/lib/constants';
import { CommandLineIcon } from '@heroicons/react/24/outline';
import { TooltipContent, TooltipTrigger } from '@radix-ui/react-tooltip';
import { FeatureFlag, FederatedGraph } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { EmptyState } from './empty-state';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { CLI, CLISteps } from './ui/cli';
import { Pagination } from './ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrapper } from './ui/table';
import { Tooltip } from './ui/tooltip';
import { useWorkspace } from '@/hooks/use-workspace';

export const Empty = ({ graph }: { graph?: FederatedGraph }) => {
  const {
    namespace: { name: namespace },
  } = useWorkspace();

  let label = '[labels...]';
  if (graph?.labelMatchers && graph.labelMatchers.length > 0) {
    label = graph.labelMatchers[0].split(',')[0];
  }
  const steps = [
    {
      title: 'Create a feature subgraph',
      description:
        'A feature subgraph is a variant of an existing subgraph that contains your experimental schema changes.',
      command: `npx wgc feature-subgraph create <feature-subgraph-name> --namespace ${namespace} -r <routing-url> --subgraph <base-subgraph-name>`,
    },
    {
      title: 'Publish the feature subgraph',
      description:
        'Deploy your schema changes to the feature subgraph so they\u2019re available to reference in a feature flag.',
      command: `npx wgc subgraph publish <feature-subgraph-name> --namespace ${namespace} --schema <schema-path> `,
    },
    {
      title: 'Create the feature flag',
      description:
        'Tie everything together by creating a feature flag that references your feature subgraph. You can enable or disable it at any time.',
      command: `npx wgc feature-flag create <feature-flag-name> --namespace ${namespace} --label ${label} --enabled --feature-subgraphs <feature-subgraph-names...>`,
    },
  ];

  return (
    <EmptyState
      eyebrow="Get started"
      title="Create your first feature flag"
      description="Feature flags let you test schema changes safely by routing traffic to experimental subgraph versions — without affecting your main graph."
    >
      <div className="mt-8 flex flex-col gap-y-6 text-left">
        <div className="rounded-lg border">
          {steps.map((step, i) => (
            <div
              key={i}
              className={`flex gap-4 p-5 ${i < steps.length - 1 ? 'border-b border-border' : ''}`}
            >
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-sm font-medium text-foreground">{step.title}</p>
                <p className="text-sm text-muted-foreground">{step.description}</p>
                <CLI command={step.command} />
              </div>
            </div>
          ))}
        </div>

        <div>
          <div className="relative mb-3 flex items-center">
            <div className="flex-1 border-t" />
            <span className="mx-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              LEARN MORE
            </span>
            <div className="flex-1 border-t" />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              Read the full guide on feature flags and how to use them safely.
            </p>
            <a
              href={docsBaseURL + '/cli/feature-flags/create-feature-flag'}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 pl-4 text-sm font-medium text-primary hover:underline"
            >
              View docs →
            </a>
          </div>
        </div>
      </div>
    </EmptyState>
  );
};

export const FeatureFlagsTable = ({
  graph,
  featureFlags,
  totalCount,
}: {
  graph?: FederatedGraph;
  featureFlags: FeatureFlag[];
  totalCount: number;
}) => {
  const user = useUser();
  const router = useRouter();
  const organizationSlug = user?.currentOrganization.slug;

  const pageNumber = router.query.page ? parseInt(router.query.page as string) : 1;
  const limit = Number.parseInt((router.query.pageSize as string) || '10');
  const noOfPages = Math.ceil(totalCount / limit);

  if (!featureFlags || featureFlags.length === 0) return <Empty graph={graph} />;

  return (
    <>
      <TableWrapper className="mb-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-1/12 px-4">Name</TableHead>
              <TableHead className="w-1/12">Enabled</TableHead>
              <TableHead className="w-3/12 px-4">Labels</TableHead>
              <TableHead className="w-2/12 px-4">Created By</TableHead>
              <TableHead className="w-2/12 px-4">Created At</TableHead>
              <TableHead className="w-2/12 px-4">Updated At</TableHead>
              <TableHead className="w-1/12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {featureFlags.map(({ name, labels, createdAt, updatedAt, createdBy, namespace, isEnabled }) => {
              const path = graph
                ? `${router.asPath.split('?')[0]}/${name}`
                : `/${organizationSlug}/feature-flags/${name}?namespace=${namespace}`;

              return (
                <TableRow
                  key={name}
                  className=" group cursor-pointer py-1 hover:bg-secondary/30"
                  onClick={() => router.push(path)}
                >
                  <TableCell className="px-4 font-medium">{name}</TableCell>
                  <TableCell className="px-4">
                    <Badge variant={isEnabled ? 'success' : 'destructive'}>{isEnabled ? 'Enabled' : 'Disabled'}</Badge>
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="flex flex-wrap gap-2">
                      {labels.length === 0 && (
                        <Tooltip delayDuration={200}>
                          <TooltipTrigger>-</TooltipTrigger>
                          <TooltipContent>
                            Only graphs with empty label matchers will compose this subgraph
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {labels.map(({ key, value }) => {
                        return (
                          <Badge variant="secondary" key={key + value}>
                            {key}={value}
                          </Badge>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 text-muted-foreground">{createdBy || 'unknown user'}</TableCell>
                  <TableCell className="px-4 text-muted-foreground">
                    {createdAt
                      ? formatDistanceToNow(new Date(createdAt), {
                          addSuffix: true,
                        })
                      : 'Never'}
                  </TableCell>
                  <TableCell className="px-4 text-muted-foreground">
                    {updatedAt
                      ? formatDistanceToNow(new Date(updatedAt), {
                          addSuffix: true,
                        })
                      : 'Never'}
                  </TableCell>
                  <TableCell className="flex justify-end gap-2">
                    <Button asChild variant="ghost" size="sm" className="table-action">
                      <Link href={path}>View</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableWrapper>
      <Pagination limit={limit} noOfPages={noOfPages} pageNumber={pageNumber} />
    </>
  );
};
