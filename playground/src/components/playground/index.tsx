import { TraceContext, TraceView } from '@/components/playground/trace-view';
import { explorerPlugin } from '@graphiql/plugin-explorer';
import { createGraphiQLFetcher } from '@graphiql/toolkit';
import { GraphiQL } from 'graphiql';
import { GraphQLSchema, buildClientSchema, getIntrospectionQuery, parse, validate } from 'graphql';
import { useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaNetworkWired } from 'react-icons/fa';
import { PiBracketsCurly } from 'react-icons/pi';
import { TbDevicesCheck } from 'react-icons/tb';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import axios, { AxiosError } from 'axios';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LuLayoutDashboard } from 'react-icons/lu';
import { sentenceCase } from 'change-case';
import { PlanView } from './plan-view';
import { QueryPlan } from './types';
import { useDebounce } from 'use-debounce';
import { useLocalStorage } from '@/lib/use-local-storage';
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
    const headers: Record<string, string> = scripts?.transformHeaders
      ? scripts.transformHeaders(initialHeaders)
      : { ...initialHeaders };

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

    const axiosResponse = await axios({
      method: init.method as 'get' | 'post' | 'put' | 'delete', // adjust method as per init
      url: url.toString(),
      headers,
      data: init.body,
    });

    const response = new Response(JSON.stringify(axiosResponse.data), {
      status: axiosResponse.status,
      statusText: axiosResponse.statusText,
      headers: new Headers(Object.entries(axiosResponse.headers)),
    });

    onFetch(await response.clone().json());
    return response;
  } catch (error: any) {
    if (error instanceof AxiosError) {
      const errorInfo = {
        message: error.message || 'Network Error',
        responseErrorCode: error.code,
        responseStatusCode: error.response?.status,
        responseHeaders: error.response?.headers,
        responseBody: JSON.stringify(error.response?.data),
        errorMessage: error.message,
      };
      const response = new Response(JSON.stringify(errorInfo));
      onFetch(await response.clone().json());
      return response;
    } else {
      throw error;
    }
  }
};

const ResponseViewSelector = () => {
  const [view, setView] = useState('response');

  const onValueChange = (val: string) => {
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

  return (
    <div>
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
  const tabDiv = document.getElementById('response-tabs');
  const artDiv = document.getElementById('art-visualization');
  const plannerDiv = document.getElementById('planner-visualization');
  const toggleClientValidation = document.getElementById('toggle-client-validation');
  const logo = document.getElementById('graphiql-wg-logo');

  if (!tabDiv || !artDiv || !plannerDiv || !toggleClientValidation || !logo) return null;

  return (
    <>
      {createPortal(<ResponseViewSelector />, tabDiv)}
      {createPortal(<PlanView />, plannerDiv)}
      {createPortal(<TraceView />, artDiv)}
      {createPortal(<ToggleClientValidation />, toggleClientValidation)}
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

export const Playground = (input: {
  routingUrl?: string;
  hideLogo?: boolean;
  theme?: 'light' | 'dark' | undefined;
  scripts?: GraphiQLScripts;
  fetch?: typeof fetch;
}) => {
  const url = input.routingUrl || import.meta.env.VITE_ROUTING_URL || '{{graphqlURL}}';

  const [isMounted, setIsMounted] = useState(false);

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
    const responseTabs = document.getElementById('response-tabs');
    if (responseTabs && isMounted) {
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
        div.id = 'response-tabs';
        div.className = 'flex items-center justify-center mx-2';
        header.append(div);
      }
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
        query: getIntrospectionQuery(),
      }),
      method: 'POST',
      headers: JSON.parse(headers),
    });
    setSchema(buildClientSchema((await res.json()).data));
  };

  useEffect(() => {
    getSchema();
  }, [headers]);

  const fetcher = useMemo(() => {
    const onFetch = (response: any) => {
      setResponse(JSON.stringify(response));
    };

    return createGraphiQLFetcher({
      url: url,
      subscriptionUrl: window.location.protocol.replace('http', 'ws') + '//' + window.location.host + url,
      fetch: (...args) =>
        graphiQLFetch(schema, clientValidationEnabled, input.scripts, onFetch, args[0] as URL, args[1] as RequestInit),
    });
  }, [schema, clientValidationEnabled]);

  const [debouncedQuery] = useDebounce(query, 300);
  const [debouncedHeaders] = useDebounce(headers, 300);

  useEffect(() => {
    const getPlan = async () => {
      if (!schema || !debouncedQuery || !url) {
        return;
      }

      try {
        const errors = validate(schema, parse(debouncedQuery));
        if (errors.length > 0) {
          setPlanError('Invalid query');
          return;
        }

        const existingHeaders = JSON.parse(debouncedHeaders || '{}');
        delete existingHeaders['X-WG-TRACE'];
        const requestHeaders: Record<string, string> = {
          ...existingHeaders,
          'X-WG-Include-Query-Plan': 'true',
          'X-WG-Skip-Loader': 'true',
          'X-WG-DISABLE-TRACING': 'true',
        };

        validateHeaders(requestHeaders);

        const response = await axios.post(
          url,
          {
            query: debouncedQuery,
          },
          { headers: requestHeaders },
        );

        if (!response.data?.extensions?.queryPlan) {
          setPlan(undefined);
          return;
        }

        setPlanError('');
        setPlan(response.data.extensions.queryPlan);
      } catch (error: any) {
        setPlan(undefined);
        setPlanError(error.message || 'Network error');
      }
    };

    getPlan();
  }, [debouncedQuery, debouncedHeaders, url, schema]);

  return (
    <TooltipProvider>
      <TraceContext.Provider
        value={{
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
          plugins={[
            explorerPlugin({
              showAttribution: false,
            }),
          ]}
          forcedTheme={input.theme}
        />
        {isMounted && <PlaygroundPortal />}
      </TraceContext.Provider>
    </TooltipProvider>
  );
};
