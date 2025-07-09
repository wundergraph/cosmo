import { TraceContext, TraceView } from '@/components/playground/trace-view';
import { explorerPlugin } from '@graphiql/plugin-explorer';
import { createGraphiQLFetcher } from '@graphiql/toolkit';
import { GraphiQL } from 'graphiql';
import {
  GraphQLSchema,
  Kind,
  OperationTypeNode,
  buildClientSchema,
  getIntrospectionQuery,
  parse,
  validate,
} from 'graphql';
import { useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaNetworkWired } from 'react-icons/fa';
import { PiBracketsCurly } from 'react-icons/pi';
import { TbDevicesCheck } from 'react-icons/tb';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LuLayoutDashboard } from 'react-icons/lu';
import { sentenceCase } from 'change-case';
import { PlanView } from './plan-view';
import { PlaygroundContext, QueryPlan, TabsState, PlaygroundView } from './types';
import { useDebounce } from 'use-debounce';
import { useLocalStorage } from '@/lib/use-local-storage';
import {
  attachPlaygroundAPI,
  CustomScripts,
  detachPlaygroundAPI,
  PreFlightScript,
} from '@/components/playground/custom-scripts';
import { Badge } from '@/components/ui/badge';
import { ExclamationTriangleIcon } from '@radix-ui/react-icons';
import 'graphiql/graphiql.css';
import '@graphiql/plugin-explorer/dist/style.css';
import '@/theme.css';

const validateHeaders = (headers: Record<string, string>) => {
  for (const headersKey in headers) {
    if (!/^[\^`\-\w!#$%&'*+.|~]+$/.test(headersKey)) {
      throw new TypeError(`Header name must be a valid HTTP token [${headersKey}]`);
    }
  }
};

const substituteHeadersFromEnv = (headers: Record<string, string>, graphId: string) => {
  const env = JSON.parse(localStorage.getItem('playground:env') || '{}');
  const graphEnv: Record<string, any> | undefined = env[graphId];

  if (!graphEnv) {
    return headers;
  }

  const storedHeaders: Record<string, any> = {};

  Object.entries(graphEnv).forEach(([key, value]) => {
    if (value === 'true' || value === 'false') {
      storedHeaders[key] = value === 'true';
    } else if (!isNaN(value as any) && value !== '') {
      storedHeaders[key] = Number(value);
    } else {
      storedHeaders[key] = value;
    }
  });

  for (const key in headers) {
    let value = headers[key];
    const placeholderRegex = /{\s*{\s*(\w+)\s*}\s*}/g;

    if (typeof value !== 'string') {
      continue;
    }

    value = value.replace(placeholderRegex, (match, p1) => {
      if (storedHeaders[p1] !== undefined) {
        return storedHeaders[p1];
      } else {
        console.warn(`No value found for placeholder: ${p1}`);
        return match;
      }
    });

    headers[key] = value;
  }

  return headers;
};

const executeScript = async (code: string | undefined, graphId: string) => {
  if (!code) {
    return;
  }

  try {
    const asyncEval = new Function(`
        return (async () => {
          ${code}
        })();
      `);

    await asyncEval();
  } catch (error: any) {
    console.error(error);
  }
};

const retrieveScriptFromLocalStorage = (key: string) => {
  const selectedScript = localStorage.getItem(key);
  return JSON.parse(!selectedScript || selectedScript === 'undefined' ? '{}' : selectedScript);
};

const executePreScripts = async (graphId: string, requestBody: any) => {
  attachPlaygroundAPI(graphId, requestBody);

  const preflightScript = retrieveScriptFromLocalStorage('playground:pre-flight:selected');

  const preFlightScriptEnabled = localStorage.getItem('playground:pre-flight:enabled');

  const preOpScript = retrieveScriptFromLocalStorage('playground:pre-operation:selected');

  if (!preFlightScriptEnabled || preFlightScriptEnabled === 'true') {
    await executeScript(preflightScript.content, graphId);
  }

  if (preOpScript.enabled) {
    await executeScript(preOpScript.content, graphId);
  }

  detachPlaygroundAPI();
};

const executePostScripts = async (graphId: string, requestBody: any, responseBody: any) => {
  const selectedScript = localStorage.getItem('playground:post-operation:selected');
  const script = JSON.parse(!selectedScript || selectedScript === 'undefined' ? '{}' : selectedScript);

  if (script.enabled) {
    attachPlaygroundAPI(graphId, requestBody, responseBody);
    await executeScript(script.content, graphId);
    detachPlaygroundAPI();
  }
};

type GraphiQLScripts = {
  transformHeaders?: (headers: Record<string, string>) => Record<string, string>;
};

const graphiQLFetch = async (
  schema: GraphQLSchema | null,
  clientValidationEnabled: boolean,
  scripts: GraphiQLScripts | undefined,
  onFetch: any,
  url: URL,
  init: RequestInit,
) => {
  try {
    const initialHeaders = init.headers as Record<string, string>;
    let headers: Record<string, string> = scripts?.transformHeaders
      ? scripts.transformHeaders(initialHeaders)
      : { ...initialHeaders };

    headers = substituteHeadersFromEnv(headers, '0');

    validateHeaders(headers);

    if (schema && clientValidationEnabled) {
      const query = JSON.parse(init.body as string)?.query as string;

      const errors = validate(schema, parse(query));

      if (errors.length > 0) {
        const responseData = {
          message: 'Client-side validation failed. The request was not sent to the Router.',
          errors: errors.map((e) => ({
            message: e.message,
            path: e.path,
            locations: e.locations,
          })),
        };

        const response = new Response(JSON.stringify(responseData), {
          headers: {
            'Content-Type': 'application/json',
          },
        });

        onFetch(await response.clone().json());
        return response;
      }
    }

    const requestBody = JSON.parse(init.body as string);

    await executePreScripts('0', requestBody);

    const response = await fetch(url, {
      ...init,
      headers,
    });

    const responseData = await response.clone().json();

    await executePostScripts('0', requestBody, responseData);

    onFetch(await response.clone().json(), response.status, response.statusText);
    return response;
  } catch (e: any) {
    const customMessage =
      'Failed to fetch from router due to network errors. Please check network activity in browser dev tools for more details.';

    const resp = new Response(
      JSON.stringify(e.message ? (e.message == 'Failed to fetch' ? customMessage : e.message) : customMessage),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    onFetch(await resp.clone().json(), undefined, 'Network Error');

    return resp;
  }
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
      <TooltipContent className="rounded-md border bg-background px-2 py-1 !text-foreground text-base">
        {clientValidationEnabled ? 'Client-side validation enabled' : 'Client-side validation disabled'}
      </TooltipContent>
    </Tooltip>
  );
};

const PlaygroundPortal = () => {
  const responseToolbar = document.getElementById('response-toolbar');
  const artDiv = document.getElementById('art-visualization');
  const plannerDiv = document.getElementById('planner-visualization');
  const toggleClientValidation = document.getElementById('toggle-client-validation');
  const logo = document.getElementById('graphiql-wg-logo');
  const scriptsSection = document.getElementById('scripts-section');
  const preFlightScriptSection = document.getElementById('pre-flight-script-section');

  if (
    !responseToolbar ||
    !artDiv ||
    !plannerDiv ||
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
      {createPortal(<ToggleClientValidation />, toggleClientValidation)}
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

  const [response, setResponse] = useState<string>('');

  const [plan, setPlan] = useState<QueryPlan | undefined>(undefined);
  const [planError, setPlanError] = useState<string>('');

  const [clientValidationEnabled, setClientValidationEnabled] = useState(true);

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

        responseSectionParent.append(artWrapper);
        responseSectionParent.append(plannerWrapper);
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
    setSchema(buildClientSchema((await res.json()).data));
  };

  useEffect(() => {
    getSchema();
  }, [headers]);

  const [status, setStatus] = useState<number>();
  const [statusText, setStatusText] = useState<string>();

  const fetcher = useMemo(() => {
    const onFetch = (response: any, status?: number, statusText?: string) => {
      setResponse(JSON.stringify(response));
      setStatus(status);
      setStatusText(statusText);
    };

    return createGraphiQLFetcher({
      url: url,
      subscriptionUrl: url.replace('http', 'ws'),
      fetch: (...args) =>
        graphiQLFetch(schema, clientValidationEnabled, input.scripts, onFetch, args[0] as URL, args[1] as RequestInit),
    });
  }, [schema, clientValidationEnabled]);

  const [debouncedQuery] = useDebounce(query, 300);
  const [debouncedHeaders] = useDebounce(headers, 300);

  useEffect(() => {
    const getPlan = async () => {
      if (!schema || !debouncedQuery || !url || view !== 'query-plan') {
        return;
      }

      try {
        const parsed = parse(debouncedQuery);

        const errors = validate(schema, parsed);
        if (errors.length > 0) {
          setPlanError('Invalid query');
          return;
        }

        const existingHeaders = JSON.parse(debouncedHeaders || '{}');
        delete existingHeaders['X-WG-TRACE'];
        let requestHeaders: Record<string, string> = {
          ...existingHeaders,
          'X-WG-Include-Query-Plan': 'true',
          'X-WG-Skip-Loader': 'true',
          'X-WG-DISABLE-TRACING': 'true',
        };

        requestHeaders = substituteHeadersFromEnv(requestHeaders, '0');
        validateHeaders(requestHeaders);

        const response = await fetch(url, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify({
            query: debouncedQuery,
          }),
        });

        const data = await response.json();

        if (!data?.extensions?.queryPlan) {
          throw new Error('No query plan found');
        }

        setPlanError('');
        setPlan(data.extensions.queryPlan);
      } catch (error: any) {
        setPlan(undefined);
        setPlanError(error.message || 'Network error');
      }
    };

    getPlan();
  }, [debouncedQuery, debouncedHeaders, url, schema, view]);

  const [tabsState, setTabsState] = useState<TabsState>({
    activeTabIndex: 0,
    tabs: [],
  });

  return (
    <TooltipProvider>
      <PlaygroundContext.Provider
        value={{
          graphId: '0',
          tabsState,
          status,
          statusText,
          view,
          setView,
        }}
      >
        <TraceContext.Provider
          value={{
            query,
            headers,
            response,
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
            onEditQuery={setQuery}
            defaultHeaders={`{
  "X-WG-TRACE" : "true"
}`}
            onEditHeaders={setHeaders}
            onTabChange={setTabsState}
            plugins={[
              explorerPlugin({
                showAttribution: false,
              }),
            ]}
            forcedTheme={input.theme}
          />
          {isMounted && <PlaygroundPortal />}
        </TraceContext.Provider>
      </PlaygroundContext.Provider>
    </TooltipProvider>
  );
};
