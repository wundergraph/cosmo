import Trace from "@/components/analytics/trace";
import { EmptyState } from "@/components/empty-state";
import {
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { CodeViewer } from "@/components/code-viewer";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/router";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getTrace } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { AnalyticsToolbar } from "@/components/analytics/toolbar";
import { CopyButton } from "@/components/ui/copy-button";
import { useEffect, useState } from "react";
import graphQLPlugin from "prettier/plugins/graphql";
import parserBabel from "prettier/plugins/babel";
import * as prettierPluginEstree from "prettier/plugins/estree";
import * as prettier from "prettier/standalone";
import { PlayIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { docsBaseURL } from "@/lib/constants";

export const TracePage: NextPageWithLayout = () => {
  const { query } = useRouter();
  const organizationSlug = query.organizationSlug as string;
  const namespace = query.namespace as string;
  const slug = query.slug as string;
  const [content, setContent] = useState("");
  const [variables, setVariables] = useState("");

  const traceID = query.traceID as string;

  const { data, isLoading, error, refetch } = useQuery({
    ...getTrace.useQuery({
      id: traceID,
    }),
    refetchInterval: 10000,
  });

  useEffect(() => {
    const set = async (content: string, variables: string) => {
      const formattedContent = await prettier.format(content, {
        parser: "graphql",
        plugins: [graphQLPlugin],
      });
      setContent(formattedContent);
      const formattedVariables = await prettier.format(variables, {
        parser: "json",
        plugins: [parserBabel, prettierPluginEstree],
      });
      setVariables(formattedVariables);
    };

    if (!data) {
      return;
    }
    set(
      data.spans[0].attributes?.operationContent || "",
      data.spans[0].attributes?.operationVariables || "",
    );
  }, [data]);

  if (isLoading) {
    return <Loader fullscreen />;
  } else if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        className="order-2 h-72 border lg:order-last"
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve request information"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  return (
    <div>
      <Trace spans={data.spans} />
      <div className="mb-3 mt-4">
        <div className="mb-1">Operation and Variables</div>
        <div className="text-xs text-muted-foreground">
          Unless you don&apos;t disable variable export in the router, you can
          see variables here.{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={docsBaseURL + "/router/compliance#disable-variables-export"}
            className="text-primary"
          >
            Learn more.
          </a>
        </div>
      </div>
      <div className="scrollbar-custom flex max-h-96 justify-between overflow-auto rounded border">
        <CodeViewer code={content} disableLinking />
        <CodeViewer code={variables} language="json" disableLinking />
        <div className="px-2 py-2">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" asChild>
                <Link
                  href={`/${organizationSlug}/${namespace}/graph/${slug}/playground?operation=${encodeURIComponent(
                    content || "",
                  )}&variables=${encodeURIComponent(variables || "")}`}
                >
                  <PlayIcon className="h-5" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Run in playground</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};

const TraceToolbar = () => {
  const router = useRouter();
  return (
    <AnalyticsToolbar tab="traces">
      <span className="text-muted-foreground">/</span>{" "}
      <span className="text-sm">{router.query.traceID}</span>
      <CopyButton
        tooltip="Copy trace id"
        value={router.query.traceID?.toString() || ""}
      />
    </AnalyticsToolbar>
  );
};

TracePage.getLayout = (page) =>
  getGraphLayout(
    <GraphPageLayout
      title="Analytics"
      subtitle="Comprehensive view into Federated GraphQL Performance"
      toolbar={<TraceToolbar />}
    >
      {page}
    </GraphPageLayout>,
    {
      title: "Analytics",
    },
  );

export default TracePage;
