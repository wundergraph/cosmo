import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import { cn } from "@/lib/utils";
import {
  createConnectQueryKey,
  useMutation,
  useQuery,
} from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import Editor, { loader, useMonaco } from "@monaco-editor/react";
import {
  CheckIcon,
  CodeIcon,
  Cross1Icon,
  Pencil1Icon,
  PlayIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import { useQueryClient } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createPlaygroundScript,
  getPlaygroundScripts,
  updatePlaygroundScript,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { PlaygroundScript } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { editor } from "monaco-editor";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDebouncedCallback } from "use-debounce";
import { EmptyState } from "../empty-state";
import { schemaViewerDarkTheme } from "../schema/monaco-dark-theme";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Loader } from "../ui/loader";
import { Separator } from "../ui/separator";
import { useToast } from "../ui/use-toast";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import CryptoJS from "crypto-js";
import { TabsState } from "@graphiql/react";

const envKey = "playground:env";

type ScriptContextType = {
  graphId: string;
  tabsState: TabsState;
};

export const ScriptContext = createContext<ScriptContextType>({
  graphId: "",
  tabsState: { tabs: [], activeTabIndex: 0 },
});

const monacoExtendedAPI = `
  type JSONValue = string | number | boolean | JSONObject | JSONArray | null;
  interface JSONObject {
    [key: string]: JSONValue;
  }
  type JSONArray = JSONValue[];

  interface PlaygroundEnv {
    /**
     * Sets a key-value pair for local environment variables.
     * @param name The key name.
     * @param value The value to store.
     */
    set(name: string, value: any): void;

    /**
     * Gets a value from local environment variables by key.
     * @param name The key name.
     * @returns The value associated with the key.
     */
    get(name: string): JSONValue;
  }

  interface PlaygroundRequestBody {
    /**
     * The GraphQL query string.
     */
    query: string;

    /**
     * The variables object associated with the GraphQL query.
     */
    variables: { [key: string]?: JSONValue } | null;

    /**
     * The name of the GraphQL operation (if specified).
     */
    operationName?: string;
  }

  interface ExecutionResult<T> {
    /**
     * The data resulting from the GraphQL operation.
     */
    data?: T;

    /**
     * Any errors that occurred during the GraphQL operation.
     */
    errors?: any[];
  }

  interface PlaygroundResponseBody extends ExecutionResult<JSONObject> {}

  interface Playground {
    /**
     * The env property contains methods to interact with local environment variables.
     */
    env: PlaygroundEnv;

    /**
     * Represents the GraphQL request body.
     */
    request: {
      body: PlaygroundRequestBody;
    };

    /**
     * Represents the GraphQL response body.
     */
    response: {
      body: PlaygroundResponseBody | null;
    };

    /**
     * Exposes the crypto-js library for cryptographic operations.
     */
    CryptoJS: typeof import("crypto-js");
  }


  declare const playground: Playground;
`;

const getPlaygroundAPI = (graphId: string) => ({
  env: {
    set: (name: string, value: string) => {
      const storedEnv = localStorage.getItem(envKey) || "{}";
      const parsed = JSON.parse(storedEnv);
      if (!parsed[graphId]) {
        parsed[graphId] = {};
      }
      parsed[graphId][name] = value;
      localStorage.setItem(envKey, JSON.stringify(parsed));
      window.dispatchEvent(
        new StorageEvent("local-storage", {
          key: envKey,
        }),
      );
    },
    get: (name: string) => {
      const storedEnv = localStorage.getItem(envKey) || "{}";
      const parsed = JSON.parse(storedEnv);
      return parsed[graphId]?.[name];
    },
  },

  request: {
    body: {
      query: "",
      variables: {} as { [key: string]: any } | null,
      operationName: undefined as string | undefined,
    },
  },

  response: {
    body: null as { data?: any; errors?: any[] } | null,
  },

  CryptoJS: CryptoJS,
});

export const attachPlaygroundAPI = (graphId: string) => {
  (window as any).playground = getPlaygroundAPI(graphId);
};

export const detachPlaygroundAPI = () => {
  delete (window as any).playground;
};

type ScriptType = "pre-flight" | "pre-operation" | "post-operation";

loader.config({
  paths: {
    // Load Monaco Editor from "public" directory
    vs: "/monaco-editor/min/vs",
    // Load Monaco Editor from different CDN
    // vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs',
  },
});

const ScriptEditor = ({
  script,
  close,
}: {
  script: PlaygroundScript;
  close: () => void;
}) => {
  const selectedTheme = useResolvedTheme();
  const monaco = useMonaco();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const envEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const context = useContext(ScriptContext);
  const {
    tabsState: { activeTabIndex, tabs },
  } = context;

  const client = useQueryClient();
  const { mutate: updateScript } = useMutation(updatePlaygroundScript, {
    onSuccess: (data) => {
      if (data.response?.code === EnumStatusCode.OK) {
        const key = createConnectQueryKey(getPlaygroundScripts, {
          type: script.type,
        });
        client.invalidateQueries({
          queryKey: key,
        });
      }
    },
  });
  const debouncedUpdate = useDebouncedCallback((value: string | undefined) => {
    updateScript({
      id: script.id,
      title: script.title,
      content: value,
    });
  }, 500);

  useEffect(() => {
    if (!monaco) return;
    if (selectedTheme === "dark") {
      monaco.editor.setTheme("wg-dark");
    } else {
      monaco.editor.setTheme("light");
    }
  }, [selectedTheme, monaco]);

  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView();
    }
  }, [logs]);

  const [env, setEnv] = useLocalStorage<any>(envKey, {});
  const [envError, setEnvError] = useState<string | undefined>();

  const updateEnvError = useDebouncedCallback((value: string | undefined) => {
    setEnvError(value);
  }, 500);

  useEffect(() => {
    setEnvError(undefined);
  }, [env, updateEnvError]);

  const handleEnvChange = (value: string | undefined) => {
    try {
      const parsedEnv = JSON.parse(value || "{}");
      setEnv({
        ...env,
        [context.graphId]: parsedEnv,
      });
      updateEnvError(undefined);
    } catch (e: any) {
      updateEnvError(e.message);
    }
  };

  const [selectedScript, setSelectedScript] = useLocalStorage<{
    id?: string;
    content?: string;
  }>(`playground:${script.type}:selected`, {});

  const [scriptTabState, setScriptTabState] = useLocalStorage<{
    [key: string]: Record<string, any>;
  }>("playground:script:tabState", {});

  const updateOpScripts = useCallback(
    ({ upsert }: { upsert: boolean }) => {
      const activeTabId = tabs[activeTabIndex].id;
      const tempScriptTabState = { ...scriptTabState };

      if (!tempScriptTabState[activeTabId]) {
        if (!upsert) {
          return;
        }
        tempScriptTabState[activeTabId] = {};
      }

      if (
        !upsert &&
        tempScriptTabState[activeTabId][script.type].id !== script.id
      ) {
        return;
      }

      tempScriptTabState[activeTabId] = {
        ...tempScriptTabState[activeTabId],
        [script.type]: {
          ...script,
          enabled:
            tempScriptTabState[activeTabId][script.type]?.enabled || false,
          content: editorRef.current?.getValue(),
        },
      };

      setScriptTabState(tempScriptTabState);
    },
    [activeTabIndex, script, scriptTabState, setScriptTabState, tabs],
  );

  const updateSelectedScript = useCallback(() => {
    if (selectedScript && selectedScript.id === script.id) {
      setSelectedScript({
        ...script,
        content: editorRef.current?.getValue(),
      });
    }
  }, [script, selectedScript, setSelectedScript]);

  const runCode = async (code: string) => {
    const capturedLogs: string[] = [];
    const originalLog = console.log;

    console.log = (...args) => {
      const logString = args
        .map((arg) => {
          if (arg === null) return "null";
          if (arg === undefined) return "undefined";
          if (typeof arg === "object") return JSON.stringify(arg, null, 2);
          return String(arg); // Handle all other types
        })
        .join(" ");

      capturedLogs.push(logString);
      setLogs((prevLogs) => [...prevLogs, logString]);
      originalLog(...args);
    };

    try {
      attachPlaygroundAPI(context.graphId);
      const asyncEval = new Function(`
        return (async () => {
          ${code}
        })();
      `);

      await asyncEval();
    } catch (error: any) {
      setLogs((prevLogs) => [...prevLogs, `Error: ${error.message}`]);
    } finally {
      detachPlaygroundAPI();
    }

    console.log = originalLog;
  };

  return (
    <div className="flex flex-col pl-4">
      <ResizablePanelGroup direction="vertical">
        <ResizablePanel defaultSize={70} minSize={20}>
          <Editor
            key={script.id}
            onChange={(val) => {
              debouncedUpdate(val);

              if (script.type !== "pre-flight") {
                updateOpScripts({ upsert: false });
              }

              updateSelectedScript();
            }}
            theme={selectedTheme === "dark" ? "wg-dark" : "light"}
            className="scrollbar-custom h-full text-xs"
            language="javascript"
            defaultValue={script.content}
            loading={null}
            options={{
              automaticLayout: true,
              language: "javascript",
              minimap: {
                enabled: false,
              },
              hideCursorInOverviewRuler: true,
              overviewRulerBorder: false,
              scrollbar: {
                verticalScrollbarSize: 6,
                horizontalScrollbarSize: 6,
                useShadows: false,
              },
              suggest: {
                showWords: false,
              },
            }}
            onMount={(editor, monaco) => {
              editorRef.current = editor;

              monaco.editor.defineTheme("wg-dark", schemaViewerDarkTheme);
              if (selectedTheme === "dark") {
                monaco.editor.setTheme("wg-dark");
              }

              // Fetch and add the crypto-js type definitions
              fetch("https://unpkg.com/@types/crypto-js@4.2.0/index.d.ts")
                .then((response) => response.text())
                .then((typeDefs) => {
                  monaco.languages.typescript.javascriptDefaults.addExtraLib(
                    typeDefs,
                    "crypto-js.d.ts",
                  );

                  monaco.languages.typescript.javascriptDefaults.addExtraLib(
                    `
                      declare module 'crypto-js' {
                        export = CryptoJS;
                      }
                    `,
                    "crypto-js-module.d.ts",
                  );
                })
                .catch((e) => console.error(e));

              monaco.languages.typescript.javascriptDefaults.addExtraLib(
                monacoExtendedAPI,
                "playground.d.ts",
              );
            }}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel minSize={10} defaultSize={30}>
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={60} minSize={40}>
              <div className="relative flex h-full flex-col py-4 pr-4 text-sm">
                <p className="pb-4">Console Output</p>
                <div className="absolute right-3 top-3 flex gap-x-2">
                  <Button
                    size="icon-sm"
                    variant="outline"
                    onClick={() => {
                      setLogs([]);
                    }}
                  >
                    <Cross1Icon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    onClick={() => {
                      const content = editorRef.current?.getValue();
                      if (content) {
                        runCode(content);
                      }
                    }}
                  >
                    <PlayIcon />
                  </Button>
                </div>
                <div className="scrollbar-custom h-full flex-1 overflow-auto">
                  {logs.map((l, index) => {
                    return (
                      <div
                        key={index}
                        className="border-b border-dotted py-1.5 after:content-['\200b'] last:border-none "
                      >
                        {l}
                      </div>
                    );
                  })}
                  <div ref={logsEndRef} />
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={40} minSize={40}>
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between py-4 pl-4 text-sm">
                  <span>Environment Variables</span>
                  <Tooltip>
                    <TooltipTrigger>
                      {!envError ? (
                        <CheckIcon className="text-success" />
                      ) : (
                        <Cross1Icon className="text-destructive" />
                      )}
                    </TooltipTrigger>
                    <TooltipContent align="end">
                      {!envError ? "Valid" : envError}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Editor
                  key="env-editor"
                  onChange={handleEnvChange}
                  theme={selectedTheme === "dark" ? "wg-dark" : "light"}
                  language="json"
                  value={JSON.stringify(env[context.graphId], null, 2)}
                  loading={null}
                  options={{
                    automaticLayout: true,
                    language: "json",
                    minimap: {
                      enabled: false,
                    },
                    hideCursorInOverviewRuler: true,
                    overviewRulerBorder: false,
                    scrollbar: {
                      verticalScrollbarSize: 6,
                      horizontalScrollbarSize: 6,
                      useShadows: false,
                    },
                    lineNumbers: "off",
                    folding: false,
                  }}
                  onMount={(editor, monaco) => {
                    envEditorRef.current = editor;

                    monaco.editor.defineTheme("wg-dark", schemaViewerDarkTheme);
                    if (selectedTheme === "dark") {
                      monaco.editor.setTheme("wg-dark");
                    }
                  }}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
      <Separator orientation="horizontal" />
      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="secondary"
          onClick={() => {
            close();
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={() => {
            setSelectedScript({
              ...script,
              content: editorRef.current?.getValue(),
            });

            if (script.type !== "pre-flight") {
              updateOpScripts({ upsert: true });
            }

            close();
          }}
        >
          Use script
        </Button>
      </div>
    </div>
  );
};

const ScriptSelector = ({
  type,
  activeScript,
  setActiveScript,
}: {
  type: ScriptType;
  activeScript?: PlaygroundScript;
  setActiveScript: (val: PlaygroundScript) => void;
}) => {
  const { toast } = useToast();

  const [selectedScript] = useLocalStorage<{
    id?: string;
  }>(`playground:${type}:selected`, {});

  const { data, isLoading, error, refetch } = useQuery(getPlaygroundScripts, {
    type,
  });

  useEffect(() => {
    if (data && !activeScript && data.scripts.length > 0) {
      const found = data.scripts.find((s) => s.id === selectedScript?.id);
      setActiveScript(found || data.scripts[0]);
    }
  }, [data, activeScript, selectedScript, setActiveScript]);

  const { mutate: createScript } = useMutation(createPlaygroundScript, {
    onSuccess: (data) => {
      if (data.response?.code === EnumStatusCode.OK) {
        refetch();
      } else {
        toast({
          description: `Could not create script. ${data.response?.details}`,
          duration: 3000,
        });
      }
    },
    onError: () => {
      toast({
        description: "Could not create script. Please try again",
        duration: 3000,
      });
    },
  });

  if (isLoading) {
    return <Loader />;
  }

  if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve scripts"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={
          <Button onClick={() => refetch()} variant="outline">
            Retry
          </Button>
        }
      />
    );
  }

  if (data.scripts.length === 0) {
    return (
      <EmptyState
        icon={<CodeIcon className="h-12 w-12" />}
        title={`Create a new ${type} script`}
        description="No scripts found. Create a new one to use in your operations"
        actions={
          <Button
            onClick={() =>
              createScript({
                type,
              })
            }
          >
            <PlusIcon className="mr-2" /> Create
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col justify-between">
      <div className="scrollbar-custom flex h-full flex-col gap-y-2 overflow-y-auto">
        {data.scripts.map((script) => {
          return (
            <Button
              className={cn("w-full text-muted-foreground", {
                "bg-accent/80 text-foreground": activeScript?.id === script.id,
              })}
              variant="ghost"
              key={script.id}
              onClick={() => setActiveScript(script)}
            >
              <div
                className={cn("w-full text-start", {
                  italic: !script.title,
                })}
              >
                {script.title || "untitled script"}
              </div>
              {script.id === selectedScript?.id && (
                <CheckIcon className="h-6 w-6" />
              )}
            </Button>
          );
        })}
      </div>
      <Button
        variant="secondary"
        onClick={() =>
          createScript({
            type,
          })
        }
        className="mt-4"
      >
        <PlusIcon />
        New script
      </Button>
    </div>
  );
};

const ScriptsViewer = ({ type }: { type: ScriptType }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeScript, setActiveScript] = useState<PlaygroundScript>();

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setActiveScript(undefined);
        }
        setIsOpen(isOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="secondary">
          <Pencil1Icon />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="flex h-[90vh] max-w-[90vw] flex-col overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="capitalize">{type} Script</DialogTitle>
        </DialogHeader>
        <div
          className={cn("grid h-full min-h-0 grid-cols-1 gap-4 divide-x", {
            "grid-cols-[15rem_auto]": activeScript,
          })}
        >
          <ScriptSelector
            type={type}
            activeScript={activeScript}
            setActiveScript={setActiveScript}
          />
          {activeScript && (
            <ScriptEditor
              script={activeScript}
              close={() => {
                setIsOpen(false);
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ScriptSetting = ({ type }: { type: ScriptType }) => {
  const [selectedScript] = useLocalStorage<PlaygroundScript | null>(
    `playground:${type}:selected`,
    null,
  );

  const [preFlightEnabled, setPreFlightEnabled] = useLocalStorage(
    `playground:pre-flight:enabled`,
    false,
  );

  const [scriptsTabState, setScriptsTabState] = useLocalStorage<{
    [key: string]: Record<string, any>;
  }>("playground:script:tabState", {});

  const {
    tabsState: { activeTabIndex, tabs },
  } = useContext(ScriptContext);

  const isOpEnabled = useMemo(() => {
    const activeId = tabs[activeTabIndex]?.id;

    if (!activeId) {
      return;
    }

    return scriptsTabState[activeId]?.[type]?.enabled || false;
  }, [activeTabIndex, tabs, scriptsTabState, type]);

  const setOpEnabled = useCallback(
    (val: boolean) => {
      const activeId = tabs[activeTabIndex].id;

      const tempScriptsTabState = { ...scriptsTabState };
      if (!tempScriptsTabState[activeId]) {
        tempScriptsTabState[activeId] = {};
      }

      tempScriptsTabState[activeId][type] = {
        ...tempScriptsTabState[activeId][type],
        enabled: val,
      };

      setScriptsTabState(tempScriptsTabState);
    },
    [tabs, activeTabIndex, scriptsTabState, type, setScriptsTabState],
  );

  return (
    <div className="flex items-center gap-4">
      <Checkbox
        checked={type === "pre-flight" ? preFlightEnabled : isOpEnabled}
        onCheckedChange={(state) => {
          if (type === "pre-flight") {
            setPreFlightEnabled(!!state);
          } else {
            setOpEnabled(!!state);
          }
        }}
      />
      <div className="w-28 flex-shrink-0 capitalize">{type}</div>:
      <div className="flex w-full items-center justify-between gap-4 rounded-lg border pl-2">
        <div className="select-none text-sm italic">
          {selectedScript && selectedScript.id
            ? selectedScript.title || "untitled script"
            : "None Selected"}
        </div>
        <ScriptsViewer type={type} />
      </div>
    </div>
  );
};

export const CustomScripts = () => {
  const {
    tabsState: { activeTabIndex, tabs },
  } = useContext(ScriptContext);

  const [scriptsTabState, setScriptsTabState] = useLocalStorage<{
    [key: string]: Record<string, any>;
  }>("playground:script:tabState", {});

  useEffect(() => {
    setScriptsTabState((prev) => {
      if (tabs.length === 0) {
        return prev;
      }

      const ids = Object.keys(prev);
      const tabIds = tabs.map((t) => t.id);

      ids.forEach((id) => {
        if (!tabIds.includes(id)) {
          delete prev[id];
        }
      });

      return prev;
    });
  }, [tabs, setScriptsTabState]);

  const [, setSelectedPreOp] = useLocalStorage<PlaygroundScript | null>(
    `playground:pre-operation:selected`,
    null,
  );
  const [, setSelectedPostOp] = useLocalStorage<PlaygroundScript | null>(
    `playground:post-operation:selected`,
    null,
  );
  useEffect(() => {
    const activeTabId = tabs[activeTabIndex]?.id;

    if (!activeTabId) {
      return;
    }

    const activeTabScripts = scriptsTabState[activeTabId];

    setSelectedPreOp(activeTabScripts?.["pre-operation"]);
    setSelectedPostOp(activeTabScripts?.["post-operation"]);
  }, [
    tabs,
    activeTabIndex,
    scriptsTabState,
    setSelectedPreOp,
    setSelectedPostOp,
  ]);

  return (
    <div className="flex h-full flex-1 flex-col gap-2 pl-1.5">
      <ScriptSetting type="pre-operation" />
      <ScriptSetting type="post-operation" />
    </div>
  );
};

export const PreFlightScript = () => {
  return (
    <div className="border-t py-4 pl-6 pr-4">
      <ScriptSetting type="pre-flight" />
    </div>
  );
};
