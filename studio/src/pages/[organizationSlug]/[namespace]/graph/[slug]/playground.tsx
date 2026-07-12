import { useApplyParams } from '@/components/analytics/use-apply-params';
import { CodeViewer } from '@/components/code-viewer';
import { getGraphLayout, GraphContext, GraphPageLayout } from '@/components/layout/graph-layout';
import { PageHeader } from '@/components/layout/head';
import { CustomScripts, PreFlightScript } from '@/components/playground/custom-scripts';
import { createPlaygroundRequestKey } from '@/components/playground/playground-request-key';
import { PlanView } from '@/components/playground/plan-view';
import { buildQueryPlanBody, buildQueryPlanHeaders } from '@/components/playground/query-plan-request';
import { SharePlaygroundModal } from '@/components/playground/share-playground-modal';
import { TraceContext, TraceView } from '@/components/playground/trace-view';
import { PlaygroundContext, PlaygroundView, QueryPlan, TabsState } from '@/components/playground/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { SubmitHandler, useZodForm } from '@/hooks/use-form';
import { useHydratePlaygroundStateFromUrl } from '@/hooks/use-hydrate-playground-state-from-url';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { usePlaygroundExecution } from '@/components/playground/use-playground-execution';
import { PLAYGROUND_DEFAULT_HEADERS_TEMPLATE, PLAYGROUND_DEFAULT_QUERY_TEMPLATE } from '@/lib/constants';
import { NextPageWithLayout } from '@/lib/page';
import { parseSchema } from '@/lib/schema-helpers';
import { cn } from '@/lib/utils';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import { explorerPlugin } from '@graphiql/plugin-explorer';
import { createLocalStorage, type Storage as GraphiQLStorage } from '@graphiql/toolkit';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { Component2Icon, ExclamationTriangleIcon, MobileIcon } from '@radix-ui/react-icons';
import { TooltipContent, TooltipTrigger } from '@radix-ui/react-tooltip';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { withDeferDirective } from '@wundergraph/cosmo-shared/playground/defer-schema';
import {
  getClients,
  getFeatureFlagsInLatestCompositionByFederatedGraph,
  getFederatedGraphSDLByName,
  getSubgraphSDLFromLatestComposition,
  publishPersistedOperations,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { create } from '@bufbuild/protobuf';
import {
  PersistedOperationSchema,
  PublishedOperationStatus,
  GetFeatureFlagsInLatestCompositionByFederatedGraphResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { sentenceCase } from 'change-case';
import crypto from 'crypto';
import { GraphiQL } from 'graphiql';
import { getOperationAST, parse, validate } from 'graphql';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/router';
import { createContext, PropsWithChildren, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaNetworkWired } from 'react-icons/fa';
import { FiSave } from 'react-icons/fi';
import { LuLayoutDashboard, LuTimer } from 'react-icons/lu';
import { useInlineDeferAdvisor } from '@/components/playground/use-inline-defer-advisor';
import { MdOutlineFeaturedPlayList } from 'react-icons/md';
import { PiBracketsCurly, PiDevices, PiGraphLight } from 'react-icons/pi';
import { TbDevicesCheck } from 'react-icons/tb';
import { useDebounce } from 'use-debounce';
import { z } from 'zod';

class CosmoGraphiqlStorage implements GraphiQLStorage {
  constructor(graphId: string) {
    this.storage = createLocalStorage({ namespace: `cosmo-playground:${graphId}` });
  }

  private storage: GraphiQLStorage;

  public setItem = (key: string, value: string) => this.storage.setItem(key, value);
  public getItem = (key: string) => {
    // GraphiQL matches restored tabs by query, variables, and headers. When it restores headers from a
    // separate empty key, it adds a duplicate tab instead of selecting the matching persisted tab.
    if (key === 'graphiql:headers') {
      const tabState = this.storage.getItem('graphiql:tabState');

      if (tabState) {
        try {
          const parsed = JSON.parse(tabState);
          const activeTab = parsed?.tabs?.[parsed.activeTabIndex];

          if (activeTab && 'headers' in activeTab) {
            return activeTab.headers;
          }
        } catch {
          // Fall back to stored headers.
        }
      }
    }

    return this.storage.getItem(key);
  };
  public removeItem = (key: string) => this.storage.removeItem(key);
  public clear = () => this.storage.clear();
  public get length() {
    return this.storage.length;
  }
}

const FormSchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().trim().min(1, 'The name cannot be empty'),
});

type Input = z.infer<typeof FormSchema>;

const PersistOperation = () => {
  const router = useRouter();
  const slug = router.query.slug as string;
  const namespace = router.query.namespace as string;

  const { query } = useContext(TraceContext);

  const [isOpen, setIsOpen] = useState(false);

  const [isNew, setIsNew] = useState(false);

  const { toast } = useToast();

  const { mutate, isPending } = useMutation(publishPersistedOperations, {
    onSuccess(data) {
      if (data.response?.code !== EnumStatusCode.OK) {
        toast({
          variant: 'destructive',
          title: 'Could not save operation',
          description: data.response?.details ?? 'Please try again',
        });
        return;
      }

      if (data.operations.length > 0 && data.operations[0].status === PublishedOperationStatus.CONFLICT) {
        toast({
          variant: 'destructive',
          title: 'Could not save operation',
          description: 'There were conflicts detected while saving',
        });
        return;
      }

      toast({
        title: 'Operation persisted successfully',
      });

      setIsOpen(false);
    },
  });

  const { data, refetch } = useQuery(getClients, {
    fedGraphName: slug,
    namespace,
  });

  useEffect(() => {
    if (isOpen) {
      refetch();
    }
  }, [isOpen, refetch]);

  const form = useZodForm<Input>({
    schema: FormSchema,
  });

  const onSubmit: SubmitHandler<Input> = (formData) => {
    const clientName = formData.clientId
      ? data?.clients.find((c) => c.id === formData.clientId)?.name
      : formData.clientName;

    if (!query) {
      toast({
        description: 'Please save a valid query',
      });
      return;
    }

    if (!clientName) {
      toast({
        description: 'Please use a valid client name',
      });
      return;
    }

    const operations = [
      create(PersistedOperationSchema, {
        id: crypto.createHash('sha256').update(query).digest('hex'),
        contents: query,
      }),
    ];

    mutate({
      fedGraphName: slug,
      clientName,
      operations,
      namespace,
    });
  };

  if (!query) return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="graphiql-toolbar-button">
              <FiSave className="graphiql-toolbar-icon" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent className="rounded-md border bg-background px-2 py-1">Persist Operation</TooltipContent>
      </Tooltip>
      <DialogContent className="grid max-w-4xl grid-cols-5 items-start divide-x">
        <div className="scrollbar-custom col-span-3 h-full max-h-[450px] overflow-auto">
          <CodeViewer code={query} />
        </div>
        <div className="col-span-2 flex h-full w-full flex-col pl-4">
          <DialogHeader>
            <DialogTitle>Persist Operation</DialogTitle>
            <DialogDescription>Save query to persisted operations</DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex-1">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex h-full flex-col gap-y-6">
                <FormField
                  control={form.control}
                  name="clientId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client</FormLabel>
                      <Select
                        onValueChange={(val) => {
                          if (!val) {
                            setIsNew(true);
                            form.setValue('clientName', '');
                          } else {
                            setIsNew(false);
                            form.setValue('clientName', data?.clients.find((c) => c.id === val)?.name ?? '');
                          }

                          field.onChange(val);
                        }}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a client" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="">
                            <span className="flex items-center gap-x-2">
                              <SparklesIcon className="h-4 w-4" /> Create New
                            </span>
                          </SelectItem>
                          {data?.clients?.map((c) => {
                            return (
                              <SelectItem key={c.id} value={c.id}>
                                <span className="flex items-center gap-x-2">
                                  <PiDevices className="h-4 w-4" /> {c.name}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>

                      <FormMessage />
                    </FormItem>
                  )}
                />
                {isNew && (
                  <FormField
                    control={form.control}
                    name="clientName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Enter name</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter new client name" {...field} />
                        </FormControl>

                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <Button
                  isLoading={isPending}
                  disabled={!form.formState.isValid}
                  className="mt-auto w-full"
                  type="submit"
                >
                  Save
                </Button>
              </form>
            </Form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ResponseToolbar = () => {
  const { view, setView } = useContext(PlaygroundContext);

  const onValueChange = (val: PlaygroundView) => {
    const response = document.getElementsByClassName('graphiql-response')[0] as HTMLDivElement;

    const art = document.getElementById('art-visualization') as HTMLDivElement;

    const plan = document.getElementById('planner-visualization') as HTMLDivElement;

    if (!response || !art || !plan) {
      return;
    }

    if (val === 'request-trace') {
      response.classList.add('invisible');
      response.classList.add('-z-50');
      plan.classList.add('invisible');
      plan.classList.add('-z-50');

      art.classList.remove('invisible');
      art.classList.remove('-z-50');
    } else if (val === 'query-plan') {
      response.classList.add('invisible');
      response.classList.add('-z-50');
      art.classList.add('invisible');
      art.classList.add('-z-50');

      plan.classList.remove('invisible');
      plan.classList.remove('-z-50');
    } else {
      response.classList.remove('invisible');
      response.classList.remove('-z-50');

      art.classList.add('invisible');
      art.classList.add('-z-50');
      plan.classList.add('invisible');
      plan.classList.add('-z-50');
    }

    setView(val);
  };

  const getIcon = (val: string) => {
    if (val === 'response') {
      return <PiBracketsCurly className="h-4 w-4 flex-shrink-0" />;
    } else if (val === 'request-trace') {
      return <FaNetworkWired className="h-4 w-4 flex-shrink-0" />;
    } else {
      return <LuLayoutDashboard className="h-4 w-4 flex-shrink-0" />;
    }
  };

  const { status, statusText } = useContext(PlaygroundContext);

  const isSuccess = !!status && status >= 200 && status < 300;

  return (
    <div className="flex items-center gap-x-2">
      {(status || statusText) && (
        <Badge className="h-8" variant={isSuccess ? 'success' : 'destructive'}>
          {!isSuccess && <ExclamationTriangleIcon className="mr-1 h-4 w-4" />}
          {status || statusText}
        </Badge>
      )}
      <Select onValueChange={onValueChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue>
            <div className="flex items-center gap-x-2">
              {getIcon(view)}
              {sentenceCase(view)}
            </div>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="response">
            <div className="flex items-center gap-x-2">
              {getIcon('response')}
              Response
            </div>
          </SelectItem>
          <SelectItem value="request-trace">
            <div className="flex items-center gap-x-2">
              {getIcon('request-trace')}
              Request Trace
            </div>
          </SelectItem>
          <SelectItem value="query-plan">
            <div className="flex items-center gap-x-2">
              {getIcon('query-plan')}
              Query Plan
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};

const ToggleClientValidation = () => {
  const { clientValidationEnabled, setClientValidationEnabled } = useContext(TraceContext);

  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <Button
          onClick={() => setClientValidationEnabled(!clientValidationEnabled)}
          variant="ghost"
          size="icon"
          className="graphiql-toolbar-button"
        >
          <TbDevicesCheck
            className={cn('graphiql-toolbar-icon', {
              'text-success': clientValidationEnabled,
            })}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="rounded-md border bg-background px-2 py-1">
        {clientValidationEnabled ? 'Client-side validation enabled' : 'Client-side validation disabled'}
      </TooltipContent>
    </Tooltip>
  );
};

const ToggleInlineAdvisor = () => {
  const { inlineAdvisorEnabled, setInlineAdvisorEnabled } = useContext(TraceContext);

  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <Button
          onClick={() => setInlineAdvisorEnabled(!inlineAdvisorEnabled)}
          variant="ghost"
          size="icon"
          className="graphiql-toolbar-button"
        >
          <LuTimer className={cn('graphiql-toolbar-icon', inlineAdvisorEnabled ? 'text-success' : 'opacity-40')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="rounded-md border bg-background px-2 py-1">
        {inlineAdvisorEnabled
          ? 'Inline defer advisor enabled: valid queries are measured and annotated with per-field latency and defer actions'
          : 'Inline defer advisor disabled'}
      </TooltipContent>
    </Tooltip>
  );
};

const ConfigSelect = () => {
  const router = useRouter();

  const graphContext = useContext(GraphContext);
  const subgraphs = graphContext?.subgraphs;
  const compositionFlagsData = useCompositionFlags();
  const featureFlags = compositionFlagsData?.featureFlags ?? [];

  const selected = (router.query.load as string) || graphContext?.graph?.id || '';
  const type = (router.query.type as string) || 'graph';

  const applyParams = useApplyParams();

  return (
    <div className="ml-1 flex items-center gap-x-2 pl-3">
      <span className="text-sm text-muted-foreground">
        Querying {type === 'featureFlag' ? 'Feature flag' : type === 'subgraph' ? 'Subgraph' : 'Graph'} :
      </span>
      <Select
        value={`{ "load": "${selected}", "type": "${type}" }`}
        onValueChange={(value) => {
          applyParams(JSON.parse(value));
        }}
      >
        <SelectTrigger className="ml-1 mr-4 flex h-8 w-auto gap-x-2 border-0 bg-transparent pl-3 pr-1 shadow-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:ring-0 md:ml-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
              <PiGraphLight className="h-3 w-3" /> Graph
            </SelectLabel>
            <SelectItem value={`{ "load": "${graphContext?.graph?.id ?? ''}", "type": "graph" }`}>
              {graphContext?.graph?.name}
            </SelectItem>
          </SelectGroup>

          {featureFlags && featureFlags.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                  <MdOutlineFeaturedPlayList className="h-3 w-3" /> Feature Flags
                </SelectLabel>
                {featureFlags.map(({ name, id }) => (
                  <SelectItem key={id} value={`{ "load": "${id}", "type": "featureFlag" }`}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
          {subgraphs && subgraphs.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                  <Component2Icon className="h-3 w-3" /> Subgraphs
                </SelectLabel>
                {subgraphs.map(({ name, id }) => (
                  <SelectItem key={id} value={`{ "load": "${id}", "type": "subgraph" }`}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
        </SelectContent>
      </Select>
    </div>
  );
};

const PlaygroundPortal = () => {
  const responseToolbar = document.getElementById('response-toolbar');
  const artDiv = document.getElementById('art-visualization');
  const plannerDiv = document.getElementById('planner-visualization');
  const saveDiv = document.getElementById('save-button');
  const toggleClientValidation = document.getElementById('toggle-client-validation');
  const toggleInlineAdvisor = document.getElementById('toggle-inline-advisor');
  const scriptsSection = document.getElementById('scripts-section');
  const preFlightScriptSection = document.getElementById('pre-flight-script-section');
  const shareButton = document.getElementById('share-button');

  if (
    !responseToolbar ||
    !artDiv ||
    !plannerDiv ||
    !saveDiv ||
    !toggleClientValidation ||
    !toggleInlineAdvisor ||
    !scriptsSection ||
    !shareButton ||
    !preFlightScriptSection
  ) {
    return null;
  }

  return (
    <>
      {createPortal(<ResponseToolbar />, responseToolbar)}
      {createPortal(<PlanView />, plannerDiv)}
      {createPortal(<TraceView />, artDiv)}
      {createPortal(<PersistOperation />, saveDiv)}
      {createPortal(<ToggleClientValidation />, toggleClientValidation)}
      {createPortal(<ToggleInlineAdvisor />, toggleInlineAdvisor)}
      {createPortal(<CustomScripts />, scriptsSection)}
      {createPortal(<PreFlightScript />, preFlightScriptSection)}
      {createPortal(<SharePlaygroundModal />, shareButton)}
    </>
  );
};

const PlaygroundPage: NextPageWithLayout = () => {
  const router = useRouter();
  const operation = router.query.operation as string;
  const variables = router.query.variables as string;

  const graphContext = useContext(GraphContext);

  const loadSchemaGraphId = (router.query.load as string) || graphContext?.graph?.id || '';
  const type = (router.query.type as string) || 'graph';

  const compositionFlagsData = useCompositionFlags();

  const { data, isLoading: isLoadingGraphSchema } = useQuery(getFederatedGraphSDLByName, {
    name: graphContext?.graph?.name,
    namespace: graphContext?.graph?.namespace,
    featureFlagName:
      type === 'featureFlag'
        ? (compositionFlagsData?.featureFlags ?? []).find((f) => f.id === loadSchemaGraphId)?.name
        : undefined,
  });

  const { data: subgraphData, isLoading: isLoadingSubgraphSchema } = useQuery(
    getSubgraphSDLFromLatestComposition,
    {
      name: graphContext?.subgraphs.find((s) => s.id === loadSchemaGraphId)?.name,
      fedGraphName: graphContext?.graph?.name,
      namespace: graphContext?.graph?.namespace,
    },
    {
      enabled: !!loadSchemaGraphId && loadSchemaGraphId !== graphContext?.graph?.id && type === 'subgraph',
    },
  );

  const isLoading = isLoadingGraphSchema || isLoadingSubgraphSchema;

  const schema = useMemo(() => {
    const schemaSDL = type === 'subgraph' ? subgraphData?.sdl : data?.clientSchema;
    const parsed = parseSchema(schemaSDL)?.ast ?? null;
    return parsed && type !== 'subgraph' ? withDeferDirective(parsed) : parsed;
  }, [data?.clientSchema, subgraphData?.sdl, type]);

  const [query, setQuery] = useState<string | undefined>(operation ? decodeURIComponent(operation) : undefined);

  const [updatedVariables, setUpdatedVariables] = useState<string | undefined>(
    variables ? decodeURIComponent(variables) : undefined,
  );

  const [storedHeaders, setStoredHeaders] = useLocalStorage('graphiql:headers', '', {
    deserializer(value) {
      return value;
    },
    serializer(value) {
      return value;
    },
  });
  const [tempHeaders, setTempHeaders] = useState<any>();

  const graphId = graphContext?.graph?.id ?? 'unknown';
  const graphRequestToken = graphContext?.graphRequestToken ?? '';

  const graphiqlStorage = useMemo(() => new CosmoGraphiqlStorage(graphId), [graphId]);

  useEffect(() => {
    if (!storedHeaders || tempHeaders) {
      return;
    }
    setTempHeaders(storedHeaders);
  }, [storedHeaders, tempHeaders]);

  useEffect(() => {
    if (!tempHeaders) {
      return;
    }
    setStoredHeaders(tempHeaders);
  }, [setStoredHeaders, tempHeaders]);

  const [headers, setHeaders] = useState(PLAYGROUND_DEFAULT_HEADERS_TEMPLATE);

  const [plan, setPlan] = useState<QueryPlan | undefined>(undefined);
  const [planError, setPlanError] = useState<string>('');

  const [clientValidationEnabled, setClientValidationEnabled] = useState(true);
  const [inlineAdvisorEnabled, setInlineAdvisorEnabled] = useLocalStorage('playground:inline-advisor:enabled', true);
  const [playgroundEnvironment] = useLocalStorage<Record<string, Record<string, unknown>>>('playground:env', {});
  const environmentRevision = JSON.stringify(playgroundEnvironment);

  const [isGraphiqlRendered, setIsGraphiqlRendered] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const [view, setView] = useState<PlaygroundView>('response');

  const [tabsState, setTabsState] = useState<TabsState>({
    activeTabIndex: 0,
    tabs: [],
  });

  const [isHydrated, setIsHydrated] = useState(false);
  const shouldPassEditorStateProps = !!operation;
  useHydratePlaygroundStateFromUrl(
    tabsState,
    setQuery,
    setUpdatedVariables,
    setHeaders,
    setTabsState,
    isGraphiqlRendered,
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const responseToolbar = document.getElementById('response-toolbar');
    if (responseToolbar && isMounted) {
      return;
    }

    const header = document.getElementsByClassName('graphiql-session-header-right')[0] as any as HTMLDivElement;

    if (header) {
      const logo = document.getElementsByClassName('graphiql-logo')[0];
      if (logo) {
        logo.classList.add('hidden');
        const div = document.createElement('div');
        div.id = 'response-toolbar';
        div.className = 'flex items-center justify-center mx-2';
        header.append(div);
      }
    }

    const editorToolsTabBar = document.getElementsByClassName('graphiql-editor-tools')[0] as any as HTMLDivElement;

    const editorToolsSection = document.getElementsByClassName('graphiql-editor-tool')[0] as any as HTMLDivElement;

    if (editorToolsTabBar && editorToolsSection && !document.getElementById('scripts-tab')) {
      const tabs = [editorToolsTabBar.childNodes[0], editorToolsTabBar.childNodes[1]];
      const sections = Array.from(editorToolsSection.childNodes);

      const scriptsButton = document.createElement('button');
      scriptsButton.id = 'scripts-tab';
      scriptsButton.className = 'graphiql-un-styled';
      scriptsButton.textContent = 'Operation Scripts';

      const scriptsSection = document.createElement('div');
      scriptsSection.id = 'scripts-section';
      scriptsSection.className = 'graphiql-editor hidden';

      tabs.forEach((e, index) =>
        e.addEventListener('click', () => {
          (e as HTMLButtonElement).className = 'graphiql-un-styled active';
          (sections[index] as HTMLDivElement).className = 'graphiql-editor';
          scriptsSection.className = 'graphiql-editor hidden';
        }),
      );

      scriptsButton.onclick = (e) => {
        (tabs[0] as HTMLButtonElement).className = 'graphiql-un-styled';
        (tabs[1] as HTMLButtonElement).className = 'graphiql-un-styled';
        (sections[0] as HTMLDivElement).className = 'graphiql-editor hidden';
        (sections[1] as HTMLDivElement).className = 'graphiql-editor hidden';
        scriptsSection.className = 'graphiql-editor';

        scriptsButton.className = 'graphiql-un-styled active';
      };

      editorToolsTabBar.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement)?.closest(`#${scriptsButton.id}`)) {
          scriptsButton.className = 'graphiql-un-styled';
        }
      });

      editorToolsTabBar.insertBefore(scriptsButton, editorToolsTabBar.childNodes[2]);
      editorToolsSection.appendChild(scriptsSection);
    }

    const editors = document.getElementsByClassName('graphiql-editors')[0] as any as HTMLDivElement;

    if (editors) {
      const preFlightScriptSection = document.createElement('div');
      preFlightScriptSection.id = 'pre-flight-script-section';
      editors.appendChild(preFlightScriptSection);
    }

    const responseSection = document.getElementsByClassName('graphiql-response')[0];
    if (responseSection) {
      const responseSectionParent = responseSection.parentElement as any as HTMLDivElement;

      if (responseSectionParent) {
        responseSectionParent.id = 'response-parent';
        responseSectionParent.classList.add('relative');

        const artWrapper = document.createElement('div');
        artWrapper.id = 'art-visualization';
        artWrapper.className = 'flex flex-1 h-full w-full absolute invisible -z-50';

        const plannerWrapper = document.createElement('div');
        plannerWrapper.id = 'planner-visualization';
        plannerWrapper.className = 'flex flex-1 h-full w-full absolute invisible -z-50';

        responseSectionParent.append(artWrapper);
        responseSectionParent.append(plannerWrapper);
      }
    }

    const toolbar = document.getElementsByClassName('graphiql-toolbar')[0] as any as HTMLDivElement;

    if (toolbar) {
      const saveButton = document.createElement('div');
      saveButton.id = 'save-button';
      toolbar.append(saveButton);

      const toggleClientValidation = document.createElement('div');
      toggleClientValidation.id = 'toggle-client-validation';
      toolbar.append(toggleClientValidation);

      const toggleInlineAdvisor = document.createElement('div');
      toggleInlineAdvisor.id = 'toggle-inline-advisor';
      toolbar.append(toggleInlineAdvisor);

      const shareButton = document.createElement('div');
      shareButton.id = 'share-button';
      toolbar.append(shareButton);
    }

    // remove settings button
    const sidebarSection = document.getElementsByClassName('graphiql-sidebar-section')[1];
    if (sidebarSection) {
      const children = Array.from(sidebarSection.childNodes.values());
      sidebarSection.removeChild(children[2]);
    }

    setIsMounted(true);
  });

  useEffect(() => {
    if (!isGraphiqlRendered && typeof query === 'string') {
      if (!query) {
        // query is empty - fill it with template
        setQuery(PLAYGROUND_DEFAULT_QUERY_TEMPLATE);
      }
      // set first render flag to true - to prevent opening new tab / filling data while user is editing
      setIsGraphiqlRendered(true);
    }
  }, [query, isGraphiqlRendered]);

  const { routingUrl, subscriptionUrl } = useMemo(() => {
    if (!loadSchemaGraphId || type === 'graph' || type === 'featureFlag') {
      const url = graphContext?.graph?.routingURL ?? '';
      return { routingUrl: url, subscriptionUrl: url.replace('http', 'ws') };
    }

    const subgraph = graphContext?.subgraphs?.find((s) => s.id === loadSchemaGraphId);
    if (!subgraph) {
      return { routingUrl: '', subscriptionUrl: '' };
    }

    return {
      routingUrl: subgraph.routingURL,
      subscriptionUrl: subgraph.subscriptionUrl,
    };
  }, [graphContext?.graph?.routingURL, graphContext?.subgraphs, loadSchemaGraphId, type]);

  const target = type === 'subgraph' ? 'subgraph' : type === 'featureFlag' ? 'featureFlag' : 'graph';
  const featureFlagName =
    target === 'featureFlag'
      ? (compositionFlagsData?.featureFlags ?? []).find((flag) => flag.id === loadSchemaGraphId)?.name
      : undefined;
  const activeTab = tabsState.tabs[tabsState.activeTabIndex];
  const activeQuery = activeTab?.query ?? query;
  const activeHeaders = activeTab?.headers ?? headers;
  const activeVariables = activeTab?.variables ?? updatedVariables;
  const activeOperationName = activeTab?.operationName;
  const activeResponse = activeTab?.response ?? '';
  const activeRequestKey = createPlaygroundRequestKey(
    activeTab,
    {
      headers,
      query,
      variables: updatedVariables,
    },
    {
      featureFlagName,
      loadSchemaGraphId,
      routingUrl,
      target,
    },
  );
  const { execution, fetcher, status, statusText } = usePlaygroundExecution({
    activeRequestKey,
    clientValidationEnabled,
    featureFlagName,
    graphId,
    graphRequestToken,
    routingUrl,
    schema,
    subscriptionUrl,
    target,
  });

  const [debouncedPlanQuery] = useDebounce(activeQuery, 300);
  const [debouncedPlanHeaders] = useDebounce(activeHeaders, 300);
  const [debouncedPlanVariables] = useDebounce(activeVariables, 300);
  const planRequestGeneration = useRef(0);

  // Inline defer advisor: the same annotator as the router-direct playground,
  // measuring the query in the background and annotating fields with per-field
  // latency and defer actions. No-op unless the router supports the advisor.
  useInlineDeferAdvisor({
    enabled: inlineAdvisorEnabled,
    environmentRevision,
    featureFlagName,
    graphId,
    graphRequestToken,
    headers: activeHeaders,
    operationName: activeOperationName,
    query: activeQuery,
    ready: isMounted,
    schema,
    target,
    url: routingUrl,
    variables: activeVariables,
  });

  useEffect(() => {
    const generation = ++planRequestGeneration.current;
    const abortController = new AbortController();
    const isCurrent = () => generation === planRequestGeneration.current && !abortController.signal.aborted;
    const clearPlan = (error = '') => {
      if (!isCurrent()) {
        return;
      }
      setPlan(undefined);
      setPlanError(error);
    };

    if (
      !schema ||
      !debouncedPlanQuery ||
      !routingUrl ||
      !graphRequestToken ||
      graphId === 'unknown' ||
      target === 'subgraph' ||
      view !== 'query-plan'
    ) {
      clearPlan();
      return () => abortController.abort();
    }

    const getPlan = async () => {
      try {
        clearPlan();
        const parsed = parse(debouncedPlanQuery);
        if (!getOperationAST(parsed, activeOperationName ?? undefined)) {
          clearPlan(activeOperationName ? `Unknown operation "${activeOperationName}"` : 'Select an operation');
          return;
        }

        const errors = validate(schema, parsed);
        if (errors.length > 0) {
          clearPlan('Invalid query');
          return;
        }

        const requestHeaders = buildQueryPlanHeaders({
          serializedHeaders: debouncedPlanHeaders,
          graphId,
          graphRequestToken,
          featureFlagName,
        });
        const requestBody = buildQueryPlanBody({
          query: debouncedPlanQuery,
          operationName: activeOperationName,
          serializedVariables: debouncedPlanVariables,
        });

        const response = await fetch(routingUrl, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        });

        const data = await response.json();
        if (!isCurrent()) {
          return;
        }

        if (!data?.extensions?.queryPlan) {
          throw new Error(data?.errors?.[0]?.message || 'No query plan found');
        }

        setPlanError('');
        setPlan(data.extensions.queryPlan);
      } catch (error: any) {
        if (error?.name !== 'AbortError' && isCurrent()) {
          clearPlan(error.message || 'Network error');
        }
      }
    };

    void getPlan();
    return () => abortController.abort();
  }, [
    activeOperationName,
    debouncedPlanHeaders,
    debouncedPlanQuery,
    debouncedPlanVariables,
    environmentRevision,
    featureFlagName,
    graphId,
    graphRequestToken,
    routingUrl,
    schema,
    target,
    view,
  ]);

  const { theme } = useTheme();

  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('graphiql-light');
      document.body.classList.remove('graphiql-dark');
    } else {
      document.body.classList.add('graphiql-dark');
      document.body.classList.remove('graphiql-light');
    }

    return () => {
      document.body.classList.remove('graphiql-dark');
      document.body.classList.remove('graphiql-light');
    };
  }, [theme]);

  if (!graphContext?.graph) return null;

  return (
    <PlaygroundContext.Provider
      value={{
        graphId: graphContext.graph.id,
        tabsState,
        status,
        statusText,
        view,
        setView,
        isHydrated,
        setIsHydrated,
      }}
    >
      <TraceContext.Provider
        value={{
          query: activeQuery ?? undefined,
          operationName: activeTab?.operationName,
          headers: activeHeaders,
          response: activeResponse,
          plan,
          planError,
          subgraphs: graphContext.subgraphs,
          clientValidationEnabled,
          setClientValidationEnabled,
          inlineAdvisorEnabled,
          setInlineAdvisorEnabled,
          execution,
        }}
      >
        <div className="hidden h-full flex-1 pl-2.5 md:flex">
          <GraphiQL
            key={graphId}
            shouldPersistHeaders
            showPersistHeadersSettings={false}
            fetcher={fetcher}
            query={shouldPassEditorStateProps ? query : undefined}
            variables={shouldPassEditorStateProps || variables ? updatedVariables : undefined}
            onEditQuery={setQuery}
            headers={headers === PLAYGROUND_DEFAULT_HEADERS_TEMPLATE ? undefined : headers}
            defaultHeaders={PLAYGROUND_DEFAULT_HEADERS_TEMPLATE}
            onEditHeaders={setHeaders}
            plugins={[
              explorerPlugin({
                showAttribution: false,
              }),
            ]}
            // null stops introspection and undefined forces introspection if schema is null
            schema={isLoading ? null : (schema ?? undefined)}
            storage={graphiqlStorage}
            onTabChange={setTabsState}
          />
          {isMounted && <PlaygroundPortal />}
        </div>
        <div className="flex flex-1 items-center justify-center md:hidden">
          <Alert className="m-8">
            <MobileIcon className="h-4 w-4" />
            <AlertTitle>Heads up!</AlertTitle>
            <AlertDescription>
              Cosmo GraphQL Playground is not available on mobile devices. Please open this page on your desktop.
            </AlertDescription>
          </Alert>
        </div>
      </TraceContext.Provider>
    </PlaygroundContext.Provider>
  );
};

const CompositionFlagsContext = createContext<GetFeatureFlagsInLatestCompositionByFederatedGraphResponse | undefined>(
  undefined,
);

function useCompositionFlags() {
  return useContext(CompositionFlagsContext);
}

const CompositionFlagsProvider = ({ children }: PropsWithChildren) => {
  const graphContext = useContext(GraphContext);
  const { data: compositionFlagsData } = useQuery(
    getFeatureFlagsInLatestCompositionByFederatedGraph,
    {
      federatedGraphName: graphContext?.graph?.name,
      namespace: graphContext?.graph?.namespace,
    },
    {
      enabled: !!graphContext?.graph?.name,
    },
  );

  return <CompositionFlagsContext.Provider value={compositionFlagsData}>{children}</CompositionFlagsContext.Provider>;
};

PlaygroundPage.getLayout = (page: ReactNode) => {
  return getGraphLayout(
    <PageHeader title="Playground | Studio">
      <CompositionFlagsProvider>
        <GraphPageLayout
          title="Playground"
          subtitle="Execute queries against your graph"
          noPadding
          toolbar={<ConfigSelect />}
        >
          {page}
        </GraphPageLayout>
      </CompositionFlagsProvider>
    </PageHeader>,
  );
};

export default PlaygroundPage;
