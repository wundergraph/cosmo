import Trace from '@/components/analytics/trace';
import { CodeViewer } from '@/components/code-viewer';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { docsBaseURL } from '@/lib/constants';
import { extractVariablesFromGraphQL } from '@/lib/schema-helpers';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { PlayIcon } from '@radix-ui/react-icons';
import { useQuery } from '@connectrpc/connect-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  getOperationContent,
  getTrace,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { GraphQLSchema } from 'graphql';
import Link from 'next/link';
import { useRouter } from 'next/router';
import parserBabel from 'prettier/plugins/babel';
import * as prettierPluginEstree from 'prettier/plugins/estree';
import graphQLPlugin from 'prettier/plugins/graphql';
import * as prettier from 'prettier/standalone';
import { useContext, useEffect, useState } from 'react';
import { GraphContext } from '../layout/graph-layout';

export const TraceDetails = ({ ast }: { ast: GraphQLSchema | null }) => {
  const { query } = useRouter();
  const organizationSlug = query.organizationSlug as string;
  const namespace = query.namespace as string;
  const slug = query.slug as string;
  const [content, setContent] = useState('');
  const [variables, setVariables] = useState('');
  const [isTruncated, setTruncated] = useState(false);

  const graphContext = useContext(GraphContext);

  const traceId = query.traceID as string;
  const spanId = query.spanID as string;

  const {
    data: traceData,
    isLoading: traceIsLoading,
    error: traceError,
    refetch: traceRefetch,
  } = useQuery(
    getTrace,
    {
      id: traceId,
      spanId: spanId,
      federatedGraphId: graphContext?.graph?.id,
    },
    {
      refetchInterval: 10000,
    },
  );

  // Find the operation hash from any span that provides it
  const operationHash = traceData?.spans.find((span) => !!span.attributes?.operationHash)?.attributes.operationHash;

  const {
    data: operationContentData,
    error: operationContentError,
    isFetching: operationContentIsFetching,
    refetch: operationContentRefetch,
  } = useQuery(
    getOperationContent,
    {
      hash: operationHash,
      federatedGraphName: graphContext?.graph?.name,
      namespace,
    },
    {
      enabled: !!operationHash,
    },
  );

  useEffect(() => {
    if (!traceData || !operationContentData) {
      setVariables('');
      setContent('');

      return;
    }

    const checkValidity = async (content: string, variables: string) => {
      try {
        await prettier.format(content, {
          parser: 'graphql',
          plugins: [graphQLPlugin],
        });
      } catch {
        return false;
      }

      try {
        await prettier.format(variables, {
          parser: 'json',
          plugins: [parserBabel, prettierPluginEstree],
        });
      } catch {
        return false;
      }

      return true;
    };

    const content = operationContentData.operationContent;
    setContent(content);

    const routerSpan = traceData.spans.find((span) => !!span.attributes?.operationVariables);

    if (routerSpan) {
      const variables = routerSpan.attributes?.operationVariables;

      setVariables(variables);

      checkValidity(content, variables).then((isValid) => {
        if (!isValid) {
          setTruncated(true);
        }
      });
    }
  }, [traceData, operationContentData]);

  if (traceIsLoading) {
    return <Loader fullscreen />;
  } else if (traceError || traceData?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        className="order-2 h-72 border lg:order-last"
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve request information"
        description={traceData?.response?.details || traceError?.message || 'Please try again'}
        actions={<Button onClick={() => traceRefetch()}>Retry</Button>}
      />
    );
  }

  return (
    <div>
      <Trace spans={traceData.spans} />
      {operationContentIsFetching ? (
        <div className="mt-4 flex h-72 items-center justify-center rounded-md border">
          <Loader />
        </div>
      ) : (
        <>
          {operationContentError || operationContentData?.response?.code !== EnumStatusCode.OK ? (
            <EmptyState
              className="order-2 mt-4 h-72 border lg:order-last"
              icon={<ExclamationTriangleIcon />}
              title="Could not retrieve operation contents"
              description={
                operationContentData?.response?.details || operationContentError?.message || 'Please try again'
              }
              actions={<Button onClick={() => operationContentRefetch()}>Retry</Button>}
            />
          ) : (
            <>
              <div className="mb-3 mt-4">
                <div className="mb-1">Operation and Variables</div>
                <div className="text-xs text-muted-foreground">
                  Content is truncated to 3KB. To view the GraphQL variables of the operation, please enable variable
                  export in the router.{' '}
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={docsBaseURL + '/router/open-telemetry#graphql-variables'}
                    className="text-primary"
                  >
                    Learn more.
                  </a>
                </div>
              </div>
              <div className="flex max-h-96 justify-between rounded border">
                <CodeViewer
                  code={content}
                  language="graphql"
                  disableLinking
                  className="scrollbar-custom w-3/6 overflow-auto"
                />
                <CodeViewer
                  code={variables}
                  language="json"
                  disableLinking
                  className="scrollbar-custom w-2/6 overflow-auto"
                />
                <div className="px-2 py-2">
                  {isTruncated ? (
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="relative" asChild>
                          <Link
                            href={`/${organizationSlug}/${namespace}/graph/${slug}/playground?operation=${encodeURIComponent(
                              content || '',
                            )}&variables=${encodeURIComponent(
                              variables || JSON.stringify(extractVariablesFromGraphQL(content, ast)),
                            )}`}
                          >
                            <PlayIcon className="h-5" />
                            <ExclamationTriangleIcon className="absolute -right-1 -top-1 h-3.5 text-destructive" />
                          </Link>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Run in playground with truncated / invalid content</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" asChild>
                          <Link
                            href={`/${organizationSlug}/${namespace}/graph/${slug}/playground?operation=${encodeURIComponent(
                              content || '',
                            )}&variables=${encodeURIComponent(
                              variables || JSON.stringify(extractVariablesFromGraphQL(content, ast)),
                            )}`}
                          >
                            <PlayIcon className="h-5" />
                          </Link>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Run in playground</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default TraceDetails;
