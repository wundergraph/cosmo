import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import {
  Bars3BottomLeftIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import Editor, { loader, useMonaco } from "@monaco-editor/react";
import { useContext, useEffect, useMemo, useState } from "react";
import { LuLayoutDashboard, LuNetwork } from "react-icons/lu";
import { Edge, Node, ReactFlowProvider } from "reactflow";
import { EmptyState } from "../empty-state";
import { schemaViewerDarkTheme } from "../schema/monaco-dark-theme";
import { CLI } from "../ui/cli";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { FetchFlow, ReactFlowQueryPlanFetchNode } from "./fetch-flow";
import { PlanPrinter } from "./prettyPrint";
import { TraceContext } from "./trace-view";
import { QueryPlan, QueryPlanFetchTypeNode } from "./types";

loader.config({
  paths: {
    // Load Monaco Editor from "public" directory
    vs: "/monaco-editor/min/vs",
    // Load Monaco Editor from different CDN
    // vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs',
  },
});

const PlanTree = ({ queryPlan }: { queryPlan: QueryPlan }) => {
  const [initialNodes, setInitialNodes] = useState<Node[]>([]);
  const [initialEdges, setInitialEdges] = useState<Edge[]>([]);

  useEffect(() => {
    const tempNodes: Node[] = [];
    const tempEdges: Edge[] = [];

    tempNodes.push({
      id: "root",
      type: "fetch",
      data: {
        ...queryPlan,
      },
      position: {
        x: 0,
        y: 0,
      },
    });

    const parseNodes = (node: QueryPlanFetchTypeNode, parentId: string) => {
      node.children?.forEach((child) => {
        const id = crypto.randomUUID();
        tempNodes.push({
          id,
          type: "fetch",
          data: {
            ...child,
          },
          position: {
            x: 0,
            y: 0,
          },
          connectable: false,
          deletable: false,
        });

        tempEdges.push({
          id: `${id}-${parentId}`,
          source: parentId,
          target: id,
          animated: true,
        });

        parseNodes(child, id);
      });
    };

    parseNodes(queryPlan, "root");

    setInitialNodes(tempNodes);
    setInitialEdges(tempEdges);
  }, [queryPlan]);

  const nodeTypes = useMemo<any>(
    () => ({
      fetch: ReactFlowQueryPlanFetchNode,
    }),
    [],
  );

  return (
    <ReactFlowProvider>
      <FetchFlow
        initialNodes={initialNodes}
        initialEdges={initialEdges}
        nodeTypes={nodeTypes}
        direction="TB"
        nodeWidth={400}
        nodeHeight={100}
      />
    </ReactFlowProvider>
  );
};

export const PlanView = () => {
  const { plan, planError } = useContext(TraceContext);

  const [formattedPlan, setFormattedPlan] = useState<string | null>(null);
  useEffect(() => {
    if (plan) {
      const printer = new PlanPrinter();
      const prettyPrintedQueryPlan = printer.print(plan);
      setFormattedPlan(prettyPrintedQueryPlan);
    }
  }, [plan]);

  const [view, setView] = useState<"tree" | "text">("tree");

  const selectedTheme = useResolvedTheme();
  const monaco = useMonaco();
  useEffect(() => {
    if (!monaco) return;
    if (selectedTheme === "dark") {
      monaco.editor.setTheme("wg-dark");
    } else {
      monaco.editor.setTheme("light");
    }
  }, [selectedTheme, monaco]);

  if (planError) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon className="h-12 w-12" />}
        title="Error fetching plan"
        description={planError}
      />
    );
  }

  if (!plan) {
    return (
      <EmptyState
        icon={<LuLayoutDashboard />}
        title="No query plan found"
        description="Include the below header before executing your queries. Router version 0.104.0 or above is required."
        actions={<CLI command={`"X-WG-Include-Query-Plan" : "true"`} />}
      />
    );
  }

  return (
    <div className="relative flex h-full w-full flex-1 flex-col font-sans">
      <Tabs
        defaultValue="tree"
        className="absolute bottom-3 right-4 z-30 w-max"
        onValueChange={(v: any) => setView(v)}
      >
        <TabsList className="grid w-full grid-cols-2 shadow-lg">
          <TabsTrigger value="tree">
            <div className="flex items-center gap-x-2">
              <LuNetwork />
              Tree View
            </div>
          </TabsTrigger>
          <TabsTrigger value="text">
            <div className="flex items-center gap-x-2">
              <Bars3BottomLeftIcon className="h-4 w-4" />
              Text View
            </div>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {view === "tree" && <PlanTree queryPlan={plan} />}
      {view === "text" && (
        <div className="scrollbar-custom h-full w-full overflow-auto rounded-xl">
          <Editor
            theme={selectedTheme === "dark" ? "wg-dark" : "light"}
            className="scrollbar-custom h-full"
            language="customLang"
            value={formattedPlan || ""}
            options={{
              fontSize: 14,
              scrollbar: {
                verticalScrollbarSize: 6,
                horizontalScrollbarSize: 6,
              },
              smoothScrolling: true,
              padding: {
                top: 21,
              },
              minimap: {
                enabled: false,
              },
            }}
            beforeMount={(monaco) => {
              monaco.editor.defineTheme("wg-dark", schemaViewerDarkTheme);
              if (selectedTheme === "dark") {
                monaco.editor.setTheme("wg-dark");
              }

              monaco.languages.register({
                id: "customLang",
              });
              monaco.languages.setMonarchTokensProvider("customLang", {
                // Define some basic tokens
                tokenizer: {
                  root: [
                    // Match keywords followed by (service
                    [/\b(\w+)(?=\s*\(service)/, "keyword"],

                    // Match Sequence, Parallel, Single followed by {
                    [/\b(QueryPlan|Sequence|Parallel)(?=\s*{)/, "keyword"],

                    // Match keywords followed by { with previous line ending in }
                    [/(?<=}\s*\n\s*)(\w+)/, "keyword"],

                    // Match service declarations: service: "serviceName"
                    [
                      /(service)(\s*:\s*)("[^"]*")/,
                      ["identifier", "", "string.service"],
                    ],

                    // Match variables: $variableName
                    [/\$[a-zA-Z_]\w*/, "variable"],
                  ],
                },
              });
            }}
          />
        </div>
      )}
    </div>
  );
};
