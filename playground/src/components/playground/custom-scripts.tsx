import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useLocalStorage } from '@/lib/use-local-storage';
import { cn } from '@/lib/utils';
import Editor, { useMonaco } from '@monaco-editor/react';
import { CheckIcon, Cross1Icon, Pencil1Icon, PlayIcon } from '@radix-ui/react-icons';
import CryptoJS from 'crypto-js';
import _ from 'lodash';
import { editor } from 'monaco-editor';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Separator } from '../ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { schemaViewerDarkTheme } from './monaco-dark-theme';
import { PlaygroundContext, PlaygroundScript } from './types';
import { useResolvedTheme } from '@/lib/use-resolved-theme';

const envKey = 'playground:env';

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

const getPlaygroundAPI = (graphId: string, requestBody?: any, responseBody?: any) => ({
  env: {
    set: (name: string, value: string) => {
      const storedEnv = localStorage.getItem(envKey) || '{}';
      const parsed = JSON.parse(storedEnv);
      if (!parsed[graphId]) {
        parsed[graphId] = {};
      }
      parsed[graphId][name] = value;
      localStorage.setItem(envKey, JSON.stringify(parsed));
      window.dispatchEvent(
        new StorageEvent('local-storage', {
          key: envKey,
        }),
      );
    },
    get: (name: string) => {
      const storedEnv = localStorage.getItem(envKey) || '{}';
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

export const attachPlaygroundAPI = (graphId: string, requestBody?: any, responseBody?: any) => {
  (window as any).playground = getPlaygroundAPI(graphId, requestBody, responseBody);
};

export const detachPlaygroundAPI = () => {
  delete (window as any).playground;
};

type ScriptType = 'pre-flight' | 'pre-operation' | 'post-operation';

const ScriptEditor = ({ script, close }: { script: PlaygroundScript; close: () => void }) => {
  const selectedTheme = useResolvedTheme();
  const monaco = useMonaco();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const envEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const context = useContext(PlaygroundContext);
  const {
    tabsState: { activeTabIndex, tabs },
  } = context;
  const currentTabId = tabs[activeTabIndex].id;

  useEffect(() => {
    if (!monaco) return;
    if (selectedTheme === 'dark') {
      monaco.editor.setTheme('wg-dark');
    } else {
      monaco.editor.setTheme('light');
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
      const parsedEnv = JSON.parse(value || '{}');
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
    updatedByTabId?: string;
  }>(`playground:${script.type}:selected`, {});

  const [scriptTabState, setScriptTabState] = useLocalStorage<{
    [key: string]: Record<string, any>;
  }>('playground:script:tabState', {});

  const updateOpScripts = useCallback(
    ({ upsert, updatedTitle }: { upsert: boolean; updatedTitle?: string }) => {
      const tempScriptTabState = { ...scriptTabState };

      tabs.forEach((tab) => {
        const tabId = tab.id;

        if (tempScriptTabState[tabId] && tempScriptTabState[tabId][script.type]?.id === script.id) {
          // Update existing script entry
          tempScriptTabState[tabId][script.type] = {
            ...tempScriptTabState[tabId][script.type],
            id: script.id,
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

  const runCode = async (code: string) => {
    const capturedLogs: string[] = [];
    const originalLog = console.log;

    console.log = (...args) => {
      const logString = args
        .map((arg) => {
          if (arg === null) return 'null';
          if (arg === undefined) return 'undefined';
          if (typeof arg === 'object') return JSON.stringify(arg, null, 2);
          return String(arg); // Handle all other types
        })
        .join(' ');

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

  if (!selectedTheme) {
    return null;
  }

  return (
    <div className="flex flex-col">
      <ResizablePanelGroup direction="vertical">
        <ResizablePanel defaultSize={70} minSize={20}>
          <Editor
            key={script.id}
            theme={selectedTheme === 'dark' ? 'wg-dark' : 'light'}
            className="scrollbar-custom h-full text-xs"
            language="javascript"
            defaultValue={script.content}
            loading={null}
            options={{
              automaticLayout: true,
              language: 'javascript',
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

              monaco.editor.defineTheme('wg-dark', schemaViewerDarkTheme);
              if (selectedTheme === 'dark') {
                monaco.editor.setTheme('wg-dark');
              }

              // Fetch and add the crypto-js type definitions
              fetch('https://unpkg.com/@types/crypto-js@4.2.0/index.d.ts')
                .then((response) => response.text())
                .then((typeDefs) => {
                  monaco.languages.typescript.javascriptDefaults.addExtraLib(typeDefs, 'crypto-js.d.ts');

                  monaco.languages.typescript.javascriptDefaults.addExtraLib(
                    `
                      declare module 'crypto-js' {
                        export = CryptoJS;
                      }
                    `,
                    'crypto-js-module.d.ts',
                  );
                })
                .catch((e) => console.error(e));

              monaco.languages.typescript.javascriptDefaults.addExtraLib(monacoExtendedAPI, 'playground.d.ts');
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
                      {!envError ? <CheckIcon className="text-success" /> : <Cross1Icon className="text-destructive" />}
                    </TooltipTrigger>
                    <TooltipContent align="end">{!envError ? 'Valid' : envError}</TooltipContent>
                  </Tooltip>
                </div>
                <Editor
                  key="env-editor"
                  onChange={handleEnvChange}
                  theme={selectedTheme === 'dark' ? 'wg-dark' : 'light'}
                  language="json"
                  value={JSON.stringify(env[context.graphId], null, 2)}
                  loading={null}
                  options={{
                    automaticLayout: true,
                    language: 'json',
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
                    lineNumbers: 'off',
                    folding: false,
                  }}
                  onMount={(editor, monaco) => {
                    envEditorRef.current = editor;

                    monaco.editor.defineTheme('wg-dark', schemaViewerDarkTheme);
                    if (selectedTheme === 'dark') {
                      monaco.editor.setTheme('wg-dark');
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
              updatedByTabId: currentTabId,
            });

            if (script.type !== 'pre-flight') {
              updateOpScripts({ upsert: true });
            }

            close();
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
};

const ScriptsViewer = ({ type }: { type: ScriptType }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeScript, setActiveScript] = useState<PlaygroundScript | undefined>();

  const {
    tabsState: { activeTabIndex, tabs },
  } = useContext(PlaygroundContext);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const defaultScript = {
      id: Date.now().toString(),
      content: '',
      title: '',
      type,
    };

    if (type === 'pre-flight') {
      const stored = localStorage.getItem(`playground:pre-flight:selected`);
      const script = JSON.parse(!stored || stored === 'undefined' ? '{}' : stored);

      setActiveScript(script?.id ? script : defaultScript);
    } else {
      const scriptTabState = JSON.parse(localStorage.getItem(`playground:script:tabState`) || '{}');
      const activeTabId = tabs[activeTabIndex]?.id;

      if (!activeTabId) {
        return;
      }

      const script = scriptTabState[activeTabId]?.[type];

      setActiveScript(script?.id ? script : defaultScript);
    }
  }, [isOpen, activeTabIndex, tabs]);

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
        <div className="grid h-full min-h-0 grid-cols-1 gap-4 divide-x">
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
  const [selectedScript] = useLocalStorage<PlaygroundScript | null>(`playground:${type}:selected`, null);

  const [preFlightEnabled, setPreFlightEnabled] = useLocalStorage(`playground:pre-flight:enabled`, true);

  const [scriptsTabState, setScriptsTabState] = useLocalStorage<{
    [key: string]: Record<string, any>;
  }>('playground:script:tabState', {});

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
        checked={type === 'pre-flight' ? preFlightEnabled : isOpEnabled}
        onCheckedChange={(state) => {
          if (type === 'pre-flight') {
            setPreFlightEnabled(!!state);
          } else {
            setOpEnabled(!!state);
          }
        }}
      />
      <div className="w-28 flex-shrink-0 capitalize">{type}</div>:
      <div className="flex w-full items-center justify-between gap-4 rounded-lg border pl-2">
        <div className="select-none text-sm italic">
          {selectedScript && selectedScript.id ? selectedScript.title || 'untitled script' : 'None Selected'}
        </div>
        <ScriptsViewer type={type} />
      </div>
    </div>
  );
};

export const CustomScripts = () => {
  const {
    tabsState: { activeTabIndex, tabs },
  } = useContext(PlaygroundContext);

  const [scriptsTabState, setScriptsTabState] = useLocalStorage<{
    [key: string]: Record<string, any>;
  }>('playground:script:tabState', {});

  useEffect(() => {
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
  }, [tabs, setScriptsTabState]);

  const [selectedPreOp, setSelectedPreOp] = useLocalStorage<PlaygroundScript | null>(
    `playground:pre-operation:selected`,
    null,
  );
  const [selectedPostOp, setSelectedPostOp] = useLocalStorage<PlaygroundScript | null>(
    `playground:post-operation:selected`,
    null,
  );

  useEffect(() => {
    const activeTabId = tabs[activeTabIndex]?.id;

    if (!activeTabId) {
      return;
    }

    const activeTabScripts = scriptsTabState[activeTabId];

    if (!_.isEqual(selectedPreOp, activeTabScripts?.['pre-operation'])) {
      if (selectedPreOp?.updatedByTabId && selectedPreOp?.updatedByTabId !== activeTabId) {
        setSelectedPreOp(activeTabScripts?.['pre-operation']);
      }
    }

    if (!_.isEqual(selectedPostOp, activeTabScripts?.['post-operation'])) {
      if (selectedPostOp?.updatedByTabId && selectedPostOp?.updatedByTabId !== activeTabId) {
        setSelectedPostOp(activeTabScripts?.['post-operation']);
      }
    }
  }, [tabs, activeTabIndex, scriptsTabState, selectedPreOp, selectedPostOp, setSelectedPreOp, setSelectedPostOp]);

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
