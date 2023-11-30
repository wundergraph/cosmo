import { GraphContext, getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TraceContext, TraceView } from "@/components/playground/trace-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NextPageWithLayout } from "@/lib/page";
import { explorerPlugin } from "@graphiql/plugin-explorer";
import { createGraphiQLFetcher } from "@graphiql/toolkit";
import { MobileIcon } from "@radix-ui/react-icons";
import { GraphiQL } from "graphiql";
import { useTheme } from "next-themes";
import { useRouter } from "next/router";
import { useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FaNetworkWired } from "react-icons/fa";
import { PiBracketsCurly } from "react-icons/pi";

const graphiQLFetch = async (
  onFetch: any,
  graphRequestToken: string,
  url: URL,
  init: RequestInit,
) => {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        "X-WG-Token": graphRequestToken,
      },
    });
    onFetch(await response.clone().json());
    return response;
  } catch (e) {
    // @ts-expect-error
    if (e?.message?.includes("Failed to fetch")) {
      throw new Error(
        "Unable to connect to the server. Please check if your server is running.",
      );
    }
    throw e;
  }
};

const ResponseTabs = () => {
  const onValueChange = (val: string) => {
    const response = document.getElementsByClassName(
      "graphiql-response",
    )[0] as HTMLDivElement;

    const visual = document.getElementById(
      "response-visualization",
    ) as HTMLDivElement;

    if (!response || !visual) {
      return;
    }

    if (val === "plan") {
      response.classList.add("!invisible");
      visual.classList.remove("invisible");
      visual.classList.remove("-z-50");
    } else {
      response.classList.remove("!invisible");
      visual.classList.add("-z-50");
      visual.classList.add("invisible");
    }
  };

  return (
    <Tabs
      defaultValue="response"
      className="w-full md:w-auto"
      onValueChange={onValueChange}
    >
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger className="!cursor-pointer" value="response" asChild>
          <div className="flex items-center gap-x-2">
            <PiBracketsCurly className="h-4 w-4 flex-shrink-0" />
            Response
          </div>
        </TabsTrigger>
        <TabsTrigger className="!cursor-pointer" value="plan" asChild>
          <div className="flex items-center gap-x-2">
            <FaNetworkWired className="h-4 w-4 flex-shrink-0" />
            Trace
          </div>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
};

const PlaygroundPortal = () => {
  const tabDiv = document.getElementById("response-tabs");
  const visDiv = document.getElementById("response-visualization");

  if (!tabDiv || !visDiv) return null;

  return (
    <>
      {createPortal(<ResponseTabs />, tabDiv)}
      {createPortal(<TraceView />, visDiv)}
    </>
  );
};

const PlaygroundPage: NextPageWithLayout = () => {
  const router = useRouter();
  const operation = router.query.operation as string;

  const graphContext = useContext(GraphContext);

  const [query, setQuery] = useState<string | undefined>(
    operation ? atob(operation) : undefined,
  );
  const [headers, setHeaders] = useState(`{
  "X-WG-TRACE" : "true"
}`);
  const [response, setResponse] = useState<string>("");

  const [isGraphiqlRendered, setIsGraphiqlRendered] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    if (isMounted) return;

    const header = document.getElementsByClassName(
      "graphiql-session-header-right",
    )[0] as any as HTMLDivElement;

    if (header) {
      const logo = document.getElementsByClassName("graphiql-logo")[0];
      logo.classList.add("hidden");
      const div = document.createElement("div");
      div.id = "response-tabs";
      div.className = "flex items-center justify-center mx-2";
      header.append(div);
    }

    const responseSection =
      document.getElementsByClassName("graphiql-response")[0];
    const responseSectionParent =
      responseSection.parentElement as any as HTMLDivElement;

    if (responseSectionParent) {
      responseSectionParent.id = "response-parent";
      responseSectionParent.classList.add("relative");
      const div = document.createElement("div");
      div.id = "response-visualization";
      div.className = "flex flex-1 h-full w-full absolute invisible -z-50";
      responseSectionParent.append(div);
    }

    setIsMounted(true);
  }, [isMounted]);

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
    const onFetch = (response: any) => {
      setResponse(JSON.stringify(response));
    };

    const url = graphContext?.graph?.routingURL ?? "";
    return createGraphiQLFetcher({
      url: url,
      subscriptionUrl: url.replace("http", "ws"),
      fetch: (...args) =>
        graphiQLFetch(
          onFetch,
          graphContext?.graphRequestToken!,
          args[0] as URL,
          args[1] as RequestInit,
        ),
    });
  }, [graphContext?.graph?.routingURL]);

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

  if (!graphContext?.graph) return null;

  return (
    <PageHeader title="Studio | Playground">
      <TraceContext.Provider
        value={{
          headers,
          response,
          subgraphs: graphContext.subgraphs,
        }}
      >
        <div className="hidden h-[100%] flex-1 md:flex">
          <GraphiQL
            shouldPersistHeaders
            showPersistHeadersSettings={false}
            fetcher={fetcher}
            query={query}
            onEditQuery={setQuery}
            headers={headers}
            onEditHeaders={setHeaders}
            plugins={[
              explorerPlugin({
                showAttribution: false,
              }),
            ]}
          />
          {isMounted && <PlaygroundPortal />}
        </div>
      </TraceContext.Provider>
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

PlaygroundPage.getLayout = (page: React.ReactNode) => {
  return getGraphLayout(page, {
    title: "Playground",
  });
};

export default PlaygroundPage;
