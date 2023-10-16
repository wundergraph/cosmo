import { getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { NextPageWithLayout } from "@/lib/page";
import { GraphiQL } from "graphiql";
import { createGraphiQLFetcher } from "@graphiql/toolkit";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { useExplorerPlugin } from "@graphiql/plugin-explorer";
import { ExclamationTriangleIcon, MobileIcon } from "@radix-ui/react-icons";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useQuery } from "@tanstack/react-query";
import { getFederatedGraphByName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { Loader } from "@/components/ui/loader";
import { useRouter } from "next/router";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";

const graphiQLFetch: typeof fetch = async (...args) => {
  try {
    const response = await fetch(...args);
    return response;
  } catch (e) {
    // @ts-expect-error
    if (e?.message?.includes("Failed to fetch")) {
      throw new Error(
        "Unable to connect to the server. Please check if your server is running."
      );
    }
    throw e;
  }
};

const PlaygroundPage: NextPageWithLayout = () => {
  const router = useRouter();

  const { data, isLoading, error, refetch } = useQuery(
    getFederatedGraphByName.useQuery({
      name: router.query.slug as string,
    })
  );

  const [query, setQuery] = useState<string | undefined>(undefined);
  const [isGraphiqlRendered, setIsGraphiqlRendered] = useState(false);

  useEffect(() => {
    if (!isGraphiqlRendered && typeof query === "string") {
      if (!query) {
        // query is empty - fill it with template
        setQuery(`# Welcome to WunderGraph Studio
#
#
# Type queries into this side of the screen, and you will see intelligent
# typeaheads aware of the current GraphQL type schema and live syntax and
# validation errors highlighted within the text.
#
# GraphQL queries typically start with a "{" character. Lines that start
# with a # are ignored.
#
# An example GraphQL query might look like:
#
#     {
#       field(arg: "value") {
#         subField
#       }
#     }
#
# Keyboard shortcuts:
#
#   Prettify query:  Shift-Ctrl-P (or press the prettify button)
#
#  Merge fragments:  Shift-Ctrl-M (or press the merge button)
#
#        Run Query:  Ctrl-Enter (or press the play button)
#
#    Auto Complete:  Ctrl-Space (or just start typing)
#
`);
      }
      // set first render flag to true - to prevent opening new tab / filling data while user is editing
      setIsGraphiqlRendered(true);
    }
  }, [query, isGraphiqlRendered]);

  const fetcher = useMemo(() => {
    return createGraphiQLFetcher({
      url: data?.graph?.routingURL ?? "",
      fetch: graphiQLFetch,
    });
  }, [data?.graph?.routingURL]);

  const explorerPlugin = useExplorerPlugin({
    query: query as string,
    onEdit: setQuery,
    showAttribution: false,
  });

  const { theme } = useTheme();

  useEffect(() => {
    if (theme === "light") {
      document.body.classList.add("graphiql-light");
      document.body.classList.remove("graphiql-dark");
    } else {
      document.body.classList.add("graphiql-dark");
      document.body.classList.remove("graphiql-light");
    }

    return () => {
      document.body.classList.remove("graphiql-dark");
      document.body.classList.remove("graphiql-light");
    };
  }, [theme]);

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve subgraphs"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  if (!data?.graph) return null;

  return (
    <PageHeader title="Studio | Playground">
      <div className="hidden h-[100%] flex-1 md:flex">
        <GraphiQL
          fetcher={fetcher}
          query={query}
          onEditQuery={setQuery}
          plugins={[explorerPlugin]}
        />
      </div>
      <div className="flex flex-1 items-center justify-center md:hidden">
        <Alert className="m-8">
          <MobileIcon className="h-4 w-4" />
          <AlertTitle>Heads up!</AlertTitle>
          <AlertDescription>
            Cosmo GraphQL Playground is not available on mobile devices. Please
            open this page on your desktop.
          </AlertDescription>
        </Alert>
      </div>
    </PageHeader>
  );
};

PlaygroundPage.getLayout = getGraphLayout;

export default PlaygroundPage;
