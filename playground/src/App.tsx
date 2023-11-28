import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { explorerPlugin } from "@graphiql/plugin-explorer";
import { createGraphiQLFetcher } from "@graphiql/toolkit";
import { GraphiQL } from "graphiql";
import { FaNetworkWired } from "react-icons/fa";
import { PiBracketsCurly } from "react-icons/pi";
import { TraceContext, TraceView } from "@/components/playground/trace-view";

const graphiQLFetch = async (onFetch: any, ...args: any) => {
  try {
    // @ts-expect-error
    const response = await fetch(...args);
    onFetch(await response.clone().json());
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

const ResponseTabs = () => {
  const onValueChange = (val: string) => {
    const response = document.getElementsByClassName(
      "graphiql-response"
    )[0] as HTMLDivElement;

    const visual = document.getElementById(
      "response-visualization"
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
        <TabsTrigger className="" value="response" asChild>
          <div>
            <PiBracketsCurly className="h-4 w-4 flex-shrink-0" />
          </div>
        </TabsTrigger>
        <TabsTrigger className="" value="plan" asChild>
          <div>
            <FaNetworkWired className="h-4 w-4 flex-shrink-0" />
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

export default function App() {
  const [isMounted, setIsMounted] = useState(false);

  const [headers, setHeaders] = useState(`{
  "X-WG-TRACE" : "true"
}`);

  const [response, setResponse] = useState<string>("");

  useEffect(() => {
    if (isMounted) return;

    const header = document.getElementsByClassName(
      "graphiql-session-header-right"
    )[0] as any as HTMLDivElement;

    if (header) {
      const div = document.createElement("div");
      div.id = "response-tabs";
      div.className = "flex items-center justify-center mr-2";
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

  const fetcher = useMemo(() => {
    const onFetch = (response: any) => {
      setResponse(JSON.stringify(response));
    };

    const url = "{{graphqlURL}}";
    // const url = "http://localhost:3002/graphql";
    return createGraphiQLFetcher({
      url: url,
      subscriptionUrl: window.location.protocol.replace('http', 'ws') + '//' + window.location.host + url,
      fetch: (...args) => graphiQLFetch(onFetch, ...args),
    });
  }, []);

  return (
    <TraceContext.Provider
      value={{
        headers,
        response,
        subgraphs: [],
      }}
    >
      <div className="h-screen w-screen">
        <GraphiQL
          shouldPersistHeaders
          showPersistHeadersSettings={false}
          fetcher={fetcher}
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
  );
}
