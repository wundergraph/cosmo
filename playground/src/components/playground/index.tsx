import { TraceContext, TraceView } from '@/components/playground/trace-view';
import { explorerPlugin } from '@graphiql/plugin-explorer';
import { GraphiQL } from 'graphiql';
import { GraphQLSchema, getIntrospectionQuery, getOperationAST, parse, validate } from 'graphql';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaNetworkWired } from 'react-icons/fa';
import { PiBracketsCurly } from 'react-icons/pi';
import { TbDevicesCheck } from 'react-icons/tb';
import { LuTimer, LuWand2 } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LuLayoutDashboard } from 'react-icons/lu';
import { sentenceCase } from 'change-case';
import { PlanView } from './plan-view';
import { DeferAdvisorState, DeferAdvisorView } from './defer-advisor-view';
import {
  advanceInlineAdvisorGeneration,
  clearInlineAnnotations,
  inlineAdvisorIdentity,
  isCurrentInlineAdvisorGeneration,
  manualAdvisorContextIdentity,
  renderInlineAnnotations,
  showInlineNotice,
  type InlineAdvisorGeneration,
} from './defer-inline';
import { applyDeferSuggestions, removeDeferredField } from './defer-advisor-rewrite';
import { DeferAdvisorResult } from './types';
import { PlaygroundContext, QueryPlan, TabsState, PlaygroundView } from './types';
import { useDebounce } from 'use-debounce';
import { useLocalStorage } from '@/lib/use-local-storage';
import { CustomScripts, PreFlightScript } from '@/components/playground/custom-scripts';
import { Badge } from '@/components/ui/badge';
import { ExclamationTriangleIcon } from '@radix-ui/react-icons';
import { getActiveTabExecution, usePlaygroundExecution } from './use-playground-execution';
import {
  type GraphiQLScripts,
  buildDeferAdvisorHeaders,
  buildPlaygroundSchema,
  preparePlaygroundHeaders,
  schemaForGraphiQLEditor,
} from './playground-fetcher';
import { buildQueryPlanBody, buildQueryPlanHeaders } from './query-plan-request';
import {
  classifyDeferAdvisorResponse,
  DeferAdvisorRequestGuard,
  prepareDeferAdvisorRequest,
} from './defer-advisor-request';
import 'graphiql/graphiql.css';
import '@graphiql/plugin-explorer/dist/style.css';
import '@/theme.css';

const formatTimingMs = (ms?: number) => {
  if (ms === undefined) {
    return '—';
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  return `${Math.round(ms)} ms`;
};

// RequestTimingStats shows TTFB next to the total duration of the last
// request, with a micro-timeline of when the first byte landed within the
// total. With @defer the green segment shrinks while the bar stays the same
// length — TTFB improves, total latency doesn't.
const RequestTimingStats = () => {
  const { requestTiming: timing } = useContext(PlaygroundContext);

  if (!timing || (timing.ttfbMs === undefined && !timing.inFlight)) {
    return null;
  }

  const ratio = timing.ttfbMs !== undefined && timing.totalMs ? Math.min(1, timing.ttfbMs / timing.totalMs) : 1;
  const fastFirst = timing.ttfbMs !== undefined && timing.totalMs !== undefined && timing.ttfbMs < timing.totalMs * 0.7;
  const incomplete = timing.state === 'incomplete' || timing.state === 'cancelled' || timing.state === 'error';

  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <div
          className={cn('flex h-9 items-center gap-x-1.5 rounded-md border bg-background px-2.5 text-xs', {
            'animate-pulse': timing.inFlight,
            'border-destructive text-destructive': incomplete,
          })}
        >
          <div className="flex h-1.5 w-14 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', fastFirst ? 'bg-success' : 'bg-muted-foreground/60')}
              style={{ width: `${Math.max(6, ratio * 100)}%` }}
            />
            {/* deferred remainder, same color language as the advisor's delivery timeline */}
            {fastFirst && !timing.inFlight && <div className="h-full flex-1 bg-sky-500/50" />}
          </div>
          <span className="text-muted-foreground">TTFB</span>
          <span className={cn('font-medium tabular-nums', { 'text-success': fastFirst })}>
            {formatTimingMs(timing.ttfbMs)}
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span className="text-muted-foreground">total</span>
          <span className="font-medium tabular-nums">{timing.inFlight ? '…' : formatTimingMs(timing.totalMs)}</span>
          {incomplete && <span className="font-medium">· {timing.state}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent className="rounded-md border bg-background px-2 py-1 !text-foreground text-base">
        {incomplete
          ? timing.message ||
            `The incremental response is ${timing.state}; the trace shown is the latest partial state.`
          : 'TTFB (arrival of the initial response) vs. total duration of the last request. @defer cuts TTFB while the total stays the same — the Defer Advisor view suggests where to put it.'}
      </TooltipContent>
    </Tooltip>
  );
};

const ResponseToolbar = () => {
  const { view, setView } = useContext(PlaygroundContext);

  const onValueChange = (val: PlaygroundView) => {
    const panels: Record<PlaygroundView, HTMLElement | null> = {
      response: document.getElementsByClassName('graphiql-response')[0] as HTMLDivElement,
      'request-trace': document.getElementById('art-visualization'),
      'query-plan': document.getElementById('planner-visualization'),
      'defer-advisor': document.getElementById('advisor-visualization'),
    };

    if (Object.values(panels).some((el) => !el)) {
      return;
    }

    for (const [key, el] of Object.entries(panels)) {
      if (key === val) {
        el!.classList.remove('invisible', '-z-50');
      } else {
        el!.classList.add('invisible', '-z-50');
      }
    }

    setView(val);
  };

  const getIcon = (val: string) => {
    if (val === 'response') {
      return <PiBracketsCurly className="h-4 w-4 flex-shrink-0" />;
    } else if (val === 'request-trace') {
      return <FaNetworkWired className="h-4 w-4 flex-shrink-0" />;
    } else if (val === 'defer-advisor') {
      return <LuWand2 className="h-4 w-4 flex-shrink-0" />;
    } else {
      return <LuLayoutDashboard className="h-4 w-4 flex-shrink-0" />;
    }
  };

  const { status, statusText } = useContext(PlaygroundContext);

  const isSuccess = !!status && status >= 200 && status < 300;

  return (
    <div className="flex items-center gap-x-2">
      <RequestTimingStats />
      {(status || statusText) && (
        <Badge className="h-9" variant={isSuccess ? 'success' : 'destructive'}>
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
          <SelectItem value="defer-advisor">
            <div className="flex items-center gap-x-2">
              {getIcon('defer-advisor')}
              Defer Advisor
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
      <TooltipContent className="rounded-md border bg-background px-2 py-1 !text-foreground text-base">
        {clientValidationEnabled ? 'Client-side validation enabled' : 'Client-side validation disabled'}
      </TooltipContent>
    </Tooltip>
  );
};

const ToggleInlineAdvisor = () => {
  const { inlineAdvisorEnabled, setInlineAdvisorEnabled } = useContext(PlaygroundContext);

  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <Button
          onClick={() => setInlineAdvisorEnabled?.(!inlineAdvisorEnabled)}
          variant="ghost"
          size="icon"
          className="graphiql-toolbar-button"
        >
          <LuTimer className={cn('graphiql-toolbar-icon', inlineAdvisorEnabled ? 'text-success' : 'opacity-40')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="rounded-md border bg-background px-2 py-1 !text-foreground text-base">
        {inlineAdvisorEnabled
          ? 'Inline defer advisor enabled: valid queries are measured in the background and annotated with fetch boundaries, latency, and defer actions'
          : 'Inline defer advisor disabled'}
      </TooltipContent>
    </Tooltip>
  );
};

const PlaygroundPortal = ({
  advisorState,
  onAnalyzeAdvisor,
}: {
  advisorState: DeferAdvisorState;
  onAnalyzeAdvisor: (runs: number) => void;
}) => {
  const responseToolbar = document.getElementById('response-toolbar');
  const artDiv = document.getElementById('art-visualization');
  const plannerDiv = document.getElementById('planner-visualization');
  const advisorDiv = document.getElementById('advisor-visualization');
  const toggleClientValidation = document.getElementById('toggle-client-validation');
  const logo = document.getElementById('graphiql-wg-logo');
  const scriptsSection = document.getElementById('scripts-section');
  const preFlightScriptSection = document.getElementById('pre-flight-script-section');

  if (
    !responseToolbar ||
    !artDiv ||
    !plannerDiv ||
    !advisorDiv ||
    !toggleClientValidation ||
    !logo ||
    !scriptsSection ||
    !preFlightScriptSection
  ) {
    return null;
  }

  return (
    <>
      {createPortal(<ResponseToolbar />, responseToolbar)}
      {createPortal(<PlanView />, plannerDiv)}
      {createPortal(<TraceView />, artDiv)}
      {createPortal(<DeferAdvisorView state={advisorState} onAnalyze={onAnalyzeAdvisor} />, advisorDiv)}
      {createPortal(
        <>
          <ToggleClientValidation />
          <ToggleInlineAdvisor />
        </>,
        toggleClientValidation,
      )}
      {createPortal(<CustomScripts />, scriptsSection)}
      {createPortal(<PreFlightScript />, preFlightScriptSection)}
      {createPortal(
        <a href="https://wundergraph.com">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 1080 1080"
            className="mt-3 mx-auto"
            width="35"
            height="35"
            fill="none"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M447.099 231.913C405.967 244.337 367.742 264.878 334.682 292.323C320.832 268.71 298.796 251.002 272.754 242.557C313.865 205.575 362.202 177.525 414.709 160.178C467.216 142.832 522.751 136.567 577.803 141.781C632.855 146.994 686.227 163.571 734.544 190.465C746.769 197.27 758.603 204.698 770.004 212.711C770.394 212.542 770.785 212.376 771.179 212.213C785.976 206.085 802.259 204.482 817.967 207.607C833.676 210.733 848.105 218.446 859.429 229.771C870.754 241.096 878.465 255.525 881.589 271.233C884.712 286.941 883.107 303.223 876.976 318.018C870.845 332.814 860.464 345.459 847.146 354.355C833.828 363.252 818.171 367.999 802.154 367.997C791.52 367.997 780.991 365.902 771.167 361.833C761.343 357.763 752.417 351.799 744.898 344.28C737.379 336.76 731.415 327.834 727.347 318.01C723.279 308.186 721.186 297.657 721.187 287.024C721.187 282.871 721.506 278.742 722.135 274.672C713.657 268.849 704.889 263.426 695.859 258.426C658.269 237.612 616.889 224.541 574.163 219.988C531.437 215.434 488.232 219.489 447.099 231.913ZM319.489 348.564C319.489 363.809 315.185 378.728 307.094 391.613L323.693 420.326C307.59 439.476 285.501 452.638 260.995 457.683L244.582 429.298C237.31 429.844 229.959 429.408 222.73 427.971C207.024 424.848 192.597 417.138 181.273 405.816C169.949 394.495 162.237 380.069 159.112 364.365C155.986 348.661 157.588 332.382 163.715 317.588C169.841 302.794 180.217 290.149 193.531 281.251C206.845 272.354 222.498 267.604 238.511 267.601C249.145 267.6 259.674 269.693 269.499 273.761C279.324 277.829 288.251 283.793 295.77 291.311C303.29 298.829 309.255 307.755 313.325 317.578C317.394 327.402 319.489 337.931 319.489 348.564ZM260.998 457.685L400.599 699.132L442.692 772.036L484.794 699.132L537.279 608.237L589.621 698.805L631.691 771.687L673.783 698.794L744.391 576.462H859.708C861.079 564.36 861.767 552.19 861.769 540.01C861.771 527.83 861.08 515.66 859.697 503.558H702.288L694.971 516.229L631.67 625.857L579.327 535.278L537.235 462.374L495.208 535.289L442.692 626.184L323.7 420.328C307.596 439.478 285.506 452.64 260.998 457.685ZM861.77 540.003C861.768 552.183 861.08 564.353 859.709 576.455H937.128V503.551H859.709C861.088 515.653 861.776 527.823 861.77 540.003ZM937.154 503.558H938.332C939.411 515.563 940 527.721 940 540.01C940 760.902 760.967 940 540.027 940C319.088 940 140 760.924 140 540.031C139.942 500.879 145.66 461.933 156.968 424.449C175.493 444.394 200.696 456.845 227.794 459.44C221.851 485.163 218.231 515.061 218.231 540.01C218.231 717.668 362.259 861.764 540.038 861.764C705.462 861.764 841.629 736.99 859.731 576.462H937.154V503.558Z"
              className="fill-foreground"
            ></path>
          </svg>
        </a>,
        logo,
      )}
    </>
  );
};

function constructGraphQLURL(location: string, graphqlURL: string, playgroundPath: string): string {
  const normalizePath = (path: string) => path.replace(/\/+$/, ''); // Remove trailing slashes

  let baseURL = location;

  // Remove playgroundPath from the end of location
  if (baseURL.endsWith(playgroundPath)) {
    baseURL = baseURL.slice(0, -playgroundPath.length);
  } else if (baseURL.endsWith(playgroundPath + '/')) {
    baseURL = baseURL.slice(0, -playgroundPath.length - 1);
  }

  baseURL = normalizePath(baseURL);
  graphqlURL = graphqlURL.startsWith('/') ? graphqlURL : `/${graphqlURL}`;

  return baseURL + graphqlURL;
}

// readActiveTabRequest pulls the active GraphiQL tab's serialized variables and
// operationName from persisted state so advisor runs profile the SAME operation
// the user would execute. Without them, a variable-dependent query errors and a
// multi-operation document profiles the wrong (or no) operation. Keeping the
// original variables text lets request preparation surface malformed JSON.
const readActiveTabRequest = (): { serializedVariables?: string; operationName?: string } => {
  try {
    const state = JSON.parse(localStorage.getItem('graphiql:tabState') || '{}');
    const tab = state?.tabs?.[state.activeTabIndex];
    if (!tab) {
      return {};
    }
    return {
      serializedVariables: typeof tab.variables === 'string' ? tab.variables : undefined,
      operationName: tab.operationName || undefined,
    };
  } catch {
    return {};
  }
};

const prepareAdvisorHeaderSnapshot = (serializedHeaders: string, scripts?: GraphiQLScripts) => {
  const parsed = JSON.parse(serializedHeaders || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Headers must be a JSON object.');
  }
  const effective = preparePlaygroundHeaders(parsed, scripts);
  const snapshot = JSON.stringify(
    Object.fromEntries(Object.entries(effective).sort(([left], [right]) => left.localeCompare(right))),
  );
  return { effective, snapshot };
};

export const Playground = (input: {
  routingUrl?: string;
  hideLogo?: boolean;
  theme?: 'light' | 'dark' | undefined;
  scripts?: GraphiQLScripts;
  fetch?: typeof fetch;
}) => {
  const url =
    input.routingUrl ||
    import.meta.env.VITE_ROUTING_URL ||
    constructGraphQLURL(window.location.href, '{{graphqlURL}}', '{{playgroundPath}}');

  const [isMounted, setIsMounted] = useState(false);
  const [view, setView] = useState<PlaygroundView>('response');

  const [schema, setSchema] = useState<GraphQLSchema | null>(null);

  const [query, setQuery] = useState<string | undefined>(undefined);
  const [tabsState, setTabsState] = useState<TabsState>({
    activeTabIndex: 0,
    tabs: [],
  });

  const [storedHeaders, setStoredHeaders] = useLocalStorage('graphiql:headers', '', {
    deserializer(value) {
      return value;
    },
    serializer(value) {
      return value;
    },
  });
  const [tempHeaders, setTempHeaders] = useState<any>();

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
  }, [tempHeaders]);

  const [headers, setHeaders] = useState(`{
  "X-WG-TRACE" : "true"
}`);

  const [plan, setPlan] = useState<QueryPlan | undefined>(undefined);
  const [planError, setPlanError] = useState<string>('');

  const [clientValidationEnabled, setClientValidationEnabled] = useState(true);
  const activeTabExecution = getActiveTabExecution(tabsState, { query, headers });
  const { activateTab, fetcher, requestTiming, status, statusText } = usePlaygroundExecution({
    url,
    schema,
    clientValidationEnabled,
    activeTabId: activeTabExecution.id,
    scripts: input.scripts,
    fetch: input.fetch,
  });
  const onTabChange = useCallback(
    (nextTabsState: TabsState) => {
      activateTab(nextTabsState.tabs[nextTabsState.activeTabIndex]?.id);
      setTabsState(nextTabsState);
    },
    [activateTab],
  );

  useEffect(() => {
    const responseToolbar = document.getElementById('response-toolbar');
    if (responseToolbar && isMounted) {
      return;
    }

    const sidebar = document.getElementsByClassName('graphiql-sidebar-section')[0];

    if (sidebar && !input.hideLogo) {
      const logo = document.createElement('div');
      logo.id = 'graphiql-wg-logo';
      sidebar.prepend(logo);
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

        const advisorWrapper = document.createElement('div');
        advisorWrapper.id = 'advisor-visualization';
        advisorWrapper.className = 'flex flex-1 h-full w-full absolute invisible -z-50';

        responseSectionParent.append(artWrapper);
        responseSectionParent.append(plannerWrapper);
        responseSectionParent.append(advisorWrapper);
      }
    }

    const toolbar = document.getElementsByClassName('graphiql-toolbar')[0] as any as HTMLDivElement;

    if (toolbar) {
      const toggleClientValidation = document.createElement('div');
      toggleClientValidation.id = 'toggle-client-validation';
      toolbar.append(toggleClientValidation);
    }

    setIsMounted(true);
  });

  const getSchema = async () => {
    const fetchFunc = input.fetch ? input.fetch : fetch;
    const res = await fetchFunc(url, {
      body: JSON.stringify({
        operationName: 'IntrospectionQuery',
        query: getIntrospectionQuery({
          inputValueDeprecation: true,
        }),
      }),
      method: 'POST',
      headers: JSON.parse(headers),
    });
    setSchema(buildPlaygroundSchema((await res.json()).data));
  };

  useEffect(() => {
    getSchema();
  }, [headers]);

  const [debouncedQuery] = useDebounce(query, 300);
  const [debouncedHeaders] = useDebounce(headers, 300);
  const [playgroundEnvironment] = useLocalStorage<Record<string, Record<string, unknown>>>('playground:env', {});
  const environmentRevision = JSON.stringify(playgroundEnvironment);
  const [debouncedPlanQuery] = useDebounce(activeTabExecution.query, 300);
  const [debouncedPlanHeaders] = useDebounce(activeTabExecution.headers, 300);
  const [debouncedPlanVariables] = useDebounce(activeTabExecution.variables, 300);
  const planRequestGeneration = useRef(0);

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

    if (!schema || !debouncedPlanQuery || !url || view !== 'query-plan') {
      clearPlan();
      return () => abortController.abort();
    }

    const getPlan = async () => {
      try {
        clearPlan();
        const parsed = parse(debouncedPlanQuery);
        if (!getOperationAST(parsed, activeTabExecution.operationName ?? undefined)) {
          clearPlan(
            activeTabExecution.operationName
              ? `Unknown operation "${activeTabExecution.operationName}"`
              : 'Select an operation',
          );
          return;
        }

        const errors = validate(schema, parsed);
        if (errors.length > 0) {
          clearPlan('Invalid query');
          return;
        }

        const requestHeaders = buildQueryPlanHeaders(debouncedPlanHeaders, input.scripts);
        const requestBody = buildQueryPlanBody({
          query: debouncedPlanQuery,
          operationName: activeTabExecution.operationName,
          serializedVariables: debouncedPlanVariables,
        });

        const response = await (input.fetch ?? fetch)(url, {
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
    activeTabExecution.operationName,
    debouncedPlanHeaders,
    debouncedPlanQuery,
    debouncedPlanVariables,
    environmentRevision,
    input.fetch,
    input.scripts,
    schema,
    url,
    view,
  ]);

  const [advisorState, setAdvisorState] = useState<DeferAdvisorState>({
    loading: false,
    error: '',
    analyzedQuery: '',
  });

  const [inlineAdvisorEnabled, setInlineAdvisorEnabled] = useLocalStorage('playground:inline-advisor:enabled', true);
  const persistedActiveRequest = readActiveTabRequest();
  const activeOperationName = activeTabExecution.id
    ? activeTabExecution.operationName
    : persistedActiveRequest.operationName;
  const activeSerializedVariables = activeTabExecution.id
    ? (activeTabExecution.variables ?? '')
    : (persistedActiveRequest.serializedVariables ?? '');
  const activeAdvisorHeaders = activeTabExecution.headers;
  const activeAdvisorHeaderPreparation = useMemo(() => {
    try {
      return prepareAdvisorHeaderSnapshot(activeAdvisorHeaders, input.scripts);
    } catch {
      return {
        effective: undefined,
        snapshot: `invalid:${JSON.stringify([activeAdvisorHeaders, environmentRevision])}`,
      };
    }
  }, [activeAdvisorHeaders, environmentRevision, input.scripts]);
  const activeAdvisorHeaderSnapshot = activeAdvisorHeaderPreparation.snapshot;
  const activeInlineQuery = activeTabExecution.query ?? query ?? '';
  const activeInlineIdentity = inlineAdvisorIdentity({
    tabId: activeTabExecution.id,
    query: activeInlineQuery,
    operationName: activeOperationName,
    variables: activeSerializedVariables,
    headers: activeAdvisorHeaderSnapshot,
  });
  const activeManualAdvisorContextIdentity = manualAdvisorContextIdentity({
    tabId: activeTabExecution.id,
    operationName: activeOperationName,
    variables: activeSerializedVariables,
    headers: activeAdvisorHeaderSnapshot,
  });
  const inlineGeneration = useRef<InlineAdvisorGeneration>({ identity: '', generation: 0 });
  const inlineRequestGuard = useRef<DeferAdvisorRequestGuard | null>(null);
  const manualRequestGuard = useRef<DeferAdvisorRequestGuard | null>(null);
  if (!inlineRequestGuard.current) {
    inlineRequestGuard.current = new DeferAdvisorRequestGuard();
  }
  if (!manualRequestGuard.current) {
    manualRequestGuard.current = new DeferAdvisorRequestGuard();
  }
  const nextInlineGeneration = advanceInlineAdvisorGeneration(inlineGeneration.current, activeInlineIdentity);
  const inlineResult = useRef<{ generation: InlineAdvisorGeneration; result: DeferAdvisorResult } | null>(null);
  if (nextInlineGeneration !== inlineGeneration.current) {
    inlineGeneration.current = nextInlineGeneration;
    inlineResult.current = null;
  }
  const [inlineQuery] = useDebounce(activeInlineQuery, 1200);
  const [inlineVariables] = useDebounce(activeSerializedVariables, 300);
  const [inlineHeaders] = useDebounce(activeAdvisorHeaderSnapshot, 300);

  useLayoutEffect(() => {
    inlineRequestGuard.current?.invalidate();
    clearInlineAnnotations();
  }, [activeInlineIdentity]);

  useEffect(() => {
    setAdvisorState({ loading: false, error: '', analyzedQuery: '' });
  }, [activeManualAdvisorContextIdentity]);

  useEffect(() => {
    manualRequestGuard.current?.invalidate();
    setAdvisorState((state) => (state.loading ? { ...state, loading: false } : state));
  }, [activeInlineIdentity]);

  useEffect(
    () => () => {
      manualRequestGuard.current?.invalidate();
    },
    [],
  );

  // Inline defer advisor: while the editor holds a valid operation, measure it
  // in the background (a single advisor run, repeated every 3s) and annotate
  // the query with fetch boundaries, per-field latency, and defer/un-defer
  // actions. The router strips existing @defer directives before profiling, so
  // deferred operations keep their live measurements.
  useEffect(() => {
    const cm = (document.querySelector('.graphiql-query-editor .CodeMirror') as any)?.CodeMirror;
    if (!cm) {
      return;
    }
    if (!inlineAdvisorEnabled || !schema) {
      clearInlineAnnotations();
      return;
    }

    let disposed = false;
    let inFlight: InlineAdvisorGeneration | undefined;
    let permanentFailure = false;
    const requestGuard = inlineRequestGuard.current!;
    const tabId = activeTabExecution.id;
    const operationName = activeOperationName;

    const identityForQuery = (queryText: string) =>
      inlineAdvisorIdentity({
        tabId,
        query: queryText,
        operationName,
        variables: inlineVariables,
        headers: inlineHeaders,
      });
    const isCurrent = (generation: InlineAdvisorGeneration, queryText = cm.getValue()) =>
      isCurrentInlineAdvisorGeneration(generation, inlineGeneration.current) &&
      generation.identity === identityForQuery(queryText);

    // Rewrites replace the editor content, which drops all editor marks; the
    // last measurement is re-projected immediately so the pills never blink
    // out, then the refresh loop replaces the numbers.
    const rerender = () => {
      const cached = inlineResult.current;
      if (cached && isCurrent(cached.generation)) {
        renderInlineAnnotations(cm, cm.getValue(), cached.result, callbacks, operationName);
      }
    };
    const callbacks = {
      onDefer: (parentPath: string, field: string, label: string) => {
        try {
          cm.setValue(
            applyDeferSuggestions(cm.getValue(), [{ path: parentPath, fields: [field], label }], operationName),
          );
          rerender();
        } catch {
          // The field is gone from the operation; the next cycle refreshes.
        }
      },
      onUndefer: (parentPath: string, field: string) => {
        try {
          cm.setValue(removeDeferredField(cm.getValue(), parentPath, field, operationName));
          rerender();
        } catch {
          // The fragment is gone from the operation; the next cycle refreshes.
        }
      },
      onApplyAll: (groups: { path: string; fields: string[]; label: string }[]) => {
        try {
          cm.setValue(applyDeferSuggestions(cm.getValue(), groups, operationName));
          rerender();
        } catch {
          // The fields moved since the analysis; the next cycle refreshes.
        }
      },
    };

    const measure = async () => {
      const generation = inlineGeneration.current;
      if (disposed || permanentFailure || (inFlight && isCurrentInlineAdvisorGeneration(inFlight, generation))) {
        return;
      }
      const current = cm.getValue();
      if (!isCurrent(generation, current)) {
        return;
      }
      const prepared = prepareDeferAdvisorRequest({
        schema,
        query: current,
        operationName,
        serializedVariables: inlineVariables,
      });
      if (!prepared.ok) {
        showInlineNotice(cm, `defer advisor: ${prepared.message}`, false);
        return;
      }

      let effectiveHeaders: Record<string, string>;
      try {
        const parsedHeaders = JSON.parse(inlineHeaders);
        if (!parsedHeaders || typeof parsedHeaders !== 'object' || Array.isArray(parsedHeaders)) {
          throw new TypeError();
        }
        effectiveHeaders = parsedHeaders;
      } catch {
        showInlineNotice(cm, 'defer advisor: Headers must be a valid JSON object.', false);
        return;
      }

      inFlight = generation;
      const request = requestGuard.start();
      if (!inlineResult.current || !isCurrentInlineAdvisorGeneration(inlineResult.current.generation, generation)) {
        showInlineNotice(cm, 'measuring query latency…', true);
      }
      try {
        // Inline annotations do not show validation data; skipping that run
        // gets the first stats on screen a full query-duration earlier.
        const requestHeaders = buildDeferAdvisorHeaders(effectiveHeaders, {
          runs: 1,
          skipValidation: true,
        });

        // Use the embedder-provided fetch (Studio injects auth/proxy) when present.
        const response = await (input.fetch ?? fetch)(url, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(prepared.body),
          signal: request.signal,
        });
        let data: unknown;
        try {
          data = await response.json();
        } catch (error) {
          if (response.status < 400) {
            throw error;
          }
        }
        const outcome = classifyDeferAdvisorResponse({
          status: response.status,
          statusText: response.statusText,
          payload: data,
        });
        if (!request.isCurrent() || disposed || !isCurrent(generation)) {
          return;
        }
        if (outcome.kind !== 'success') {
          if (outcome.kind === 'permanent-error') {
            permanentFailure = true;
            showInlineNotice(cm, `defer advisor unavailable: ${outcome.message}`, false);
          }
          return;
        }
        const result = outcome.result as DeferAdvisorResult;
        inlineResult.current = { generation, result };
        renderInlineAnnotations(cm, cm.getValue(), result, callbacks, operationName);
      } catch (error: any) {
        // Network hiccup or the router rejected the advisor request; keep
        // whatever annotations are on screen and retry on the next tick.
        if (error?.name === 'AbortError' || !request.isCurrent() || disposed || !isCurrent(generation)) {
          return;
        }
      } finally {
        request.complete();
        if (inFlight === generation) {
          inFlight = undefined;
        }
      }
    };

    // Toggling on (or re-entering) paints the last result instantly; the
    // measurement that follows replaces the numbers.
    rerender();
    measure();
    const interval = setInterval(measure, 3000);
    return () => {
      disposed = true;
      clearInterval(interval);
      requestGuard.invalidate();
    };
  }, [
    inlineQuery,
    inlineVariables,
    inlineHeaders,
    activeTabExecution.id,
    activeOperationName,
    inlineAdvisorEnabled,
    schema,
    isMounted,
    url,
    input.fetch,
  ]);

  const runAdvisor = useCallback(
    async (runs: number) => {
      const guard = manualRequestGuard.current!;
      guard.invalidate();
      const generation = inlineGeneration.current;
      const analyzedQuery = activeInlineQuery;
      if (!schema) {
        setAdvisorState({ loading: false, error: 'The schema is still loading.', analyzedQuery: '' });
        return;
      }
      const prepared = prepareDeferAdvisorRequest({
        schema,
        query: analyzedQuery,
        operationName: activeOperationName,
        serializedVariables: activeSerializedVariables,
      });
      if (!prepared.ok) {
        setAdvisorState({ loading: false, error: prepared.message, analyzedQuery: '' });
        return;
      }
      if (!activeAdvisorHeaderPreparation.effective) {
        setAdvisorState({
          loading: false,
          error: 'Headers must be a valid JSON object with valid HTTP header names.',
          analyzedQuery: '',
        });
        return;
      }

      const request = guard.start();
      setAdvisorState((state) => ({ ...state, loading: true, error: '' }));
      try {
        const requestHeaders = buildDeferAdvisorHeaders(activeAdvisorHeaderPreparation.effective, { runs });

        const response = await (input.fetch ?? fetch)(url, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(prepared.body),
          signal: request.signal,
        });

        let data: unknown;
        try {
          data = await response.json();
        } catch (error) {
          if (response.status < 400) {
            throw error;
          }
        }

        if (!request.isCurrent() || !isCurrentInlineAdvisorGeneration(generation, inlineGeneration.current)) {
          return;
        }

        const outcome = classifyDeferAdvisorResponse({
          status: response.status,
          statusText: response.statusText,
          payload: data,
        });
        if (outcome.kind !== 'success') {
          throw new Error(outcome.message);
        }

        setAdvisorState({
          loading: false,
          error: '',
          result: outcome.result as DeferAdvisorResult,
          analyzedQuery,
          operationName: prepared.operationName,
        });
      } catch (error: any) {
        if (
          error?.name === 'AbortError' ||
          !request.isCurrent() ||
          !isCurrentInlineAdvisorGeneration(generation, inlineGeneration.current)
        ) {
          return;
        }
        setAdvisorState((state) => ({
          ...state,
          loading: false,
          result: undefined,
          error: error.message || 'Network error',
        }));
      } finally {
        request.complete();
      }
    },
    [
      activeInlineQuery,
      activeOperationName,
      activeSerializedVariables,
      activeAdvisorHeaders,
      activeAdvisorHeaderPreparation,
      activeAdvisorHeaderSnapshot,
      schema,
      url,
      input.fetch,
    ],
  );

  return (
    <TooltipProvider>
      <PlaygroundContext.Provider
        value={{
          graphId: '0',
          tabsState,
          status,
          statusText,
          requestTiming,
          inlineAdvisorEnabled,
          setInlineAdvisorEnabled,
          view,
          setView,
        }}
      >
        <TraceContext.Provider
          value={{
            query: activeTabExecution.query,
            operationName: activeOperationName,
            headers: activeTabExecution.headers,
            response: activeTabExecution.response,
            requestTiming,
            subgraphs: [],
            plan,
            planError,
            clientValidationEnabled,
            setClientValidationEnabled,
            forcedTheme: input.theme,
          }}
        >
          <GraphiQL
            shouldPersistHeaders
            showPersistHeadersSettings={false}
            fetcher={fetcher}
            schema={schemaForGraphiQLEditor(schema)}
            onEditQuery={setQuery}
            defaultHeaders={`{
  "X-WG-TRACE" : "true"
}`}
            onEditHeaders={setHeaders}
            onTabChange={onTabChange}
            plugins={[
              explorerPlugin({
                showAttribution: false,
              }),
            ]}
            forcedTheme={input.theme}
          />
          {isMounted && <PlaygroundPortal advisorState={advisorState} onAnalyzeAdvisor={runAdvisor} />}
        </TraceContext.Provider>
      </PlaygroundContext.Provider>
    </TooltipProvider>
  );
};
