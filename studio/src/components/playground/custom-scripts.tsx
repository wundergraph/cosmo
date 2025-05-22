import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  DotsVerticalIcon,
  Pencil1Icon,
  PlayIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import { useQueryClient } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createPlaygroundScript,
  deletePlaygroundScript,
  getPlaygroundScripts,
  updatePlaygroundScript,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { PlaygroundScript } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import CryptoJS from "crypto-js";
import _ from "lodash";
import { editor } from "monaco-editor";
import {
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
import { Input } from "../ui/input";
import { Loader } from "../ui/loader";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useToast } from "../ui/use-toast";
import { PlaygroundContext } from "./types";

const envKey = "playground:env";

const monacoExtendedAPI = `
  interface JSONObject {
    [key: string]: JSONValue;
  }
  type JSONArray = JSONValue[];
  type JSONValue = string | number | boolean | JSONObject | JSONArray | null;

  interface Playground {
    /**
     * The env property contains methods to interact with local environment variables.
     */
    env: {
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
    };

    /**
     * Represents the GraphQL request body.
     */
    request: {
      body: {
        /**
         * The GraphQL query string.
         */
        query: string;

        /**
         * The variables object associated with the GraphQL query.
         */
        variables?: { [key: string]?: JSONValue };

        /**
         * The name of the GraphQL operation (if specified).
         */
        operationName?: string;
      };
    };

    /**
     * Represents the GraphQL response body.
     */
    response: {
      body?: {
        /**
         * The data resulting from the GraphQL operation.
         */
        data?: T;
      };
    };

    /**
     * Exposes the crypto-js library for cryptographic operations.
     */
    CryptoJS: typeof import("crypto-js");
  }


  declare const playground: Playground;
`;

const getPlaygroundAPI = (
  graphId: string,
  requestBody?: any,
  responseBody?: any,
) => ({
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
    body: requestBody || null,
  },

  response: {
    body: responseBody || null,
  },

  CryptoJS: CryptoJS,
});

export const attachPlaygroundAPI = (
  graphId: string,
  requestBody?: any,
  responseBody?: any,
) => {
  (window as any).playground = getPlaygroundAPI(
    graphId,
    requestBody,
    responseBody,
  );
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

  const [title, setTitle] = useState(script.title);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(title);

  useEffect(() => {
    setTitle(script.title);
    setEditedTitle(script.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script.id]);

  const context = useContext(PlaygroundContext);
  const {
    tabsState: { activeTabIndex, tabs },
  } = context;
  const currentTabId = tabs[activeTabIndex].id;

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
  const debouncedUpdate = useDebouncedCallback(() => {
    updateScript({
      id: script.id,
      title,
      content: editorRef.current?.getValue(),
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
    title?: string;
    updatedByTabId?: string;
  }>(`playground:${script.type}:selected`, {});

  const [scriptTabState, setScriptTabState] = useLocalStorage<{
    [key: string]: Record<string, any>;
  }>("playground:script:tabState", {});

  const updateOpScripts = useCallback(
    ({ upsert, updatedTitle }: { upsert: boolean; updatedTitle?: string }) => {
      const tempScriptTabState = { ...scriptTabState };

      tabs.forEach((tab) => {
        const tabId = tab.id;

        if (
          tempScriptTabState[tabId] &&
          tempScriptTabState[tabId][script.type]?.id === script.id
        ) {
          // Update existing script entry
          tempScriptTabState[tabId][script.type] = {
            ...tempScriptTabState[tabId][script.type],
            id: script.id,
            title: updatedTitle || script.title,
            enabled: tempScriptTabState[tabId][script.type]?.enabled || false,
            content: editorRef.current?.getValue(),
          };
        } else if (upsert && tabId === tabs[activeTabIndex].id) {
          // For the active tab, if upsert is true, we add or update the script
          if (!tempScriptTabState[tabId]) {
            tempScriptTabState[tabId] = {};
          }
          tempScriptTabState[tabId][script.type] = {
            id: script.id,
            title: updatedTitle || script.title,
            enabled: tempScriptTabState[tabId][script.type]?.enabled || false,
            content: editorRef.current?.getValue(),
          };
        }
      });

      setScriptTabState(tempScriptTabState);
    },
    [tabs, activeTabIndex, script, scriptTabState, setScriptTabState],
  );

  const updateSelectedScript = useCallback(() => {
    if (selectedScript && selectedScript.id === script.id) {
      setSelectedScript({
        ...selectedScript,
        title,
        content: editorRef.current?.getValue(),
        updatedByTabId: currentTabId,
      });
    }
  }, [script.id, selectedScript, setSelectedScript, title, currentTabId]);

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
            onChange={() => {
              debouncedUpdate();

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
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-x-2">
          <span className="text-sm">Title:</span>
          {isEditingTitle ? (
            <>
              <Input
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.currentTarget.value)}
                placeholder="Enter script title"
                className="w-64"
              />
              <Button
                variant="secondary"
                size="icon-sm"
                onClick={() => setIsEditingTitle(false)}
              >
                <Cross1Icon />
              </Button>
              <Button
                size="icon-sm"
                onClick={() => {
                  setTitle(editedTitle);
                  setIsEditingTitle(false);
                  updateScript({
                    id: script.id,
                    title: editedTitle,
                    content: editorRef.current?.getValue(),
                  });

                  if (selectedScript && selectedScript.id === script.id) {
                    setSelectedScript({
                      ...selectedScript,
                      title: editedTitle,
                      updatedByTabId: currentTabId,
                    });
                  }

                  if (script.type !== "pre-flight") {
                    updateOpScripts({
                      upsert: true,
                      updatedTitle: editedTitle,
                    });
                  }
                }}
              >
                <CheckIcon />
              </Button>
            </>
          ) : (
            <>
              <span className="text-sm">{title || "untitled script"}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsEditingTitle(true)}
              >
                <Pencil1Icon />
              </Button>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2">
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
                title,
                content: editorRef.current?.getValue(),
                updatedByTabId: currentTabId,
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
  setActiveScript: (val: PlaygroundScript | undefined) => void;
}) => {
  const { toast } = useToast();

  const [selectedScript, setSelectedScript] = useLocalStorage<
    | {
        id?: string;
      }
    | undefined
  >(`playground:${type}:selected`, {});

  const [, setScriptTabState] = useLocalStorage<{
    [key: string]: Record<string, any>;
  }>("playground:script:tabState", {});

  const { data, isLoading, error, refetch } = useQuery(getPlaygroundScripts, {
    type,
  });

  useEffect(() => {
    if (data) {
      if (data.scripts.length > 0) {
        // Find the updated active script
        const updatedActiveScript = data.scripts.find(
          (s) => s.id === activeScript?.id,
        );

        if (updatedActiveScript) {
          // Update the active script with the latest data
          setActiveScript(updatedActiveScript);
        } else {
          // If activeScript is not found, try to find the selected script
          const found = data.scripts.find((s) => s.id === selectedScript?.id);
          setActiveScript(found || data.scripts[0]);
        }
      } else {
        // No scripts left, set activeScript to undefined
        setActiveScript(undefined);
      }
    }
  }, [data, activeScript?.id, selectedScript?.id, setActiveScript]);

  const { mutate: createScript, isPending: creatingScript } = useMutation(
    createPlaygroundScript,
    {
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
    },
  );

  const { mutate: deleteScript } = useMutation(deletePlaygroundScript, {
    onSuccess: (data, variables) => {
      if (data.response?.code === EnumStatusCode.OK) {
        // If the deleted script is the selected script in local storage, remove it
        if (selectedScript?.id === variables.id) {
          setSelectedScript(undefined);
        }

        // Update scriptTabState
        setScriptTabState((prevState) => {
          const newState = { ...prevState };
          Object.keys(newState).forEach((tabId) => {
            const tabScripts = newState[tabId];
            if (tabScripts && tabScripts[type]?.id === variables.id) {
              const prevEnabled = tabScripts[type]?.enabled || false;
              newState[tabId][type] = { enabled: prevEnabled };
            }
          });
          return newState;
        });

        refetch();
      } else {
        toast({
          description: `Could not delete script. ${data.response?.details}`,
          duration: 3000,
        });
      }
    },
    onError: () => {
      toast({
        description: "Could not delete script. Please try again",
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
            isLoading={creatingScript}
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
            <div
              key={script.id}
              className={cn(
                "group flex w-full flex-grow-0 items-center rounded-md hover:bg-accent/80",
                {
                  "bg-accent/80": activeScript?.id === script.id,
                },
              )}
            >
              <Button
                className={cn(
                  "w-full min-w-0 text-muted-foreground hover:bg-transparent",
                  {
                    "text-foreground": activeScript?.id === script.id,
                  },
                )}
                variant="ghost"
                onClick={() => setActiveScript(script)}
              >
                {script.id === selectedScript?.id && (
                  <CheckIcon className="mr-2 h-5 w-5" />
                )}
                <div
                  className={cn("w-full truncate text-start", {
                    italic: !script.title,
                  })}
                >
                  {script.title || "untitled script"}
                </div>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon-sm"
                    className="flex-shrink-0"
                    variant="ghost"
                  >
                    <DotsVerticalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      deleteScript({
                        id: script.id,
                      });
                    }}
                    className="text-destructive"
                  >
                    Delete script
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
        isLoading={creatingScript}
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
  const [activeScript, setActiveScript] = useState<
    PlaygroundScript | undefined
  >();

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
    true,
  );

  const [scriptsTabState, setScriptsTabState] = useLocalStorage<{
    [key: string]: Record<string, any>;
  }>("playground:script:tabState", {});

  const {
    tabsState: { activeTabIndex, tabs },
  } = useContext(PlaygroundContext);

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
    isHydrated,
  } = useContext(PlaygroundContext);

  const [scriptsTabState, setScriptsTabState] = useLocalStorage<{
    [key: string]: Record<string, any>;
  }>("playground:script:tabState", {});

  useEffect(() => {
    // safe check to avoid race condition
    if (!isHydrated) return;

    setScriptsTabState((prev) => {
      if (tabs.length === 0) {
        return prev;
      }

      const ids = Object.keys(prev);
      const tabIds = tabs.map((t) => t.id);

      // Create a shallow copy -- this ensures state update is predictable
      // and accidently doesn't mutate previous setState
      const next = { ...prev };
      ids.forEach((id) => {
        if (!tabIds.includes(id)) {
          delete next[id];
        }
      });

      return next;
    });
  }, [tabs, setScriptsTabState, isHydrated]);

  const [selectedPreOp, setSelectedPreOp] = useLocalStorage<
    | (PlaygroundScript & {
        updatedByTabId?: string;
      })
    | null
  >(`playground:pre-operation:selected`, null);

  const [selectedPostOp, setSelectedPostOp] = useLocalStorage<
    | (PlaygroundScript & {
        updatedByTabId?: string;
      })
    | null
  >(`playground:post-operation:selected`, null);

  useEffect(() => {
    const activeTabId = tabs[activeTabIndex]?.id;

    if (!activeTabId) {
      return;
    }

    const activeTabScripts = scriptsTabState[activeTabId];

    if (!_.isEqual(selectedPreOp, activeTabScripts?.["pre-operation"])) {
      if (
        selectedPreOp?.updatedByTabId &&
        selectedPreOp?.updatedByTabId !== activeTabId
      ) {
        setSelectedPreOp(activeTabScripts?.["pre-operation"]);
      }
    }

    if (!_.isEqual(selectedPostOp, activeTabScripts?.["post-operation"])) {
      if (
        selectedPostOp?.updatedByTabId &&
        selectedPostOp?.updatedByTabId !== activeTabId
      ) {
        setSelectedPostOp(activeTabScripts?.["post-operation"]);
      }
    }
  }, [
    tabs,
    activeTabIndex,
    scriptsTabState,
    selectedPreOp,
    selectedPostOp,
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
