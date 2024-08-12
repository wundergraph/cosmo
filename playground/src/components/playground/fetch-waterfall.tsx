import { nsToTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { CubeIcon, ExclamationTriangleIcon, MinusIcon, PlusIcon } from '@radix-ui/react-icons';
import { sentenceCase } from 'change-case';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { FetchNode } from './types';
import { ViewHeaders } from './view-headers';
import { ViewInput } from './view-input';
import { ViewLoadStats } from './view-load-stats';
import { ViewOutput } from './view-output';

const bigintE3 = BigInt(1e3);
const bigintE2 = BigInt(1e2);
const initialCollapsedSpanDepth = 4;

const Attribute = ({ name, value }: { name: string; value: any }) => {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger>
          <div className="flex w-60 items-center gap-x-1">
            <span className="text-accent-foreground">{name}</span> <span className="text-accent-foreground">=</span>{' '}
            <span className="truncate text-accent-foreground/80">{value}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>{value}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const mapFetchType = (type: string) => {
  switch (type) {
    case 'graphql':
      return 'GraphQL';
    case 'parse':
      return 'Operation - Parse';
    case 'normalize':
      return 'Operation - Normalize';
    case 'validate':
      return 'Operation - Validate';
    case 'plan':
      return 'Operation - Plan';
    case 'execute':
      return 'Operation - Execute';
    default:
      return sentenceCase(type);
  }
};

export const FetchWaterfall = ({
  fetch,
  parentFetch,
  level,
  globalDuration,
  globalStartTime,
  isParentDetailsOpen,
  paneWidth,
}: {
  fetch: FetchNode;
  parentFetch?: FetchNode;
  level: number;
  globalDuration: bigint;
  globalStartTime: bigint;
  isParentDetailsOpen: boolean;
  paneWidth: number;
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const statusCode = fetch.outputTrace?.response?.statusCode ?? 0;

  const hasChildren = fetch.children && fetch.children.length > 0;
  const parentChildrenCount = parentFetch?.children ? parentFetch.children.length : 0;

  const isLoadSkipped = fetch.loadSkipped;

  // Work with smaller units (picosecond) on numerator to circumvent bigint division
  const elapsedDurationPs = BigInt(fetch.durationSinceStart ?? 0) * bigintE3;
  const spanDurationPs = BigInt(fetch.durationLoad ?? 0) * bigintE3;
  const visualOffsetPercentage = Number(((elapsedDurationPs / globalDuration) * bigintE2) / bigintE3);
  const visualWidthPercentage = Number(((spanDurationPs / globalDuration) * bigintE2) / bigintE3);

  const [isOpen, setIsOpen] = useState(() => level <= initialCollapsedSpanDepth);

  const hasChildrenError = (span: FetchNode) => {
    if (statusCode >= 400) {
      return true;
    }

    if (span.children) {
      return span.children.some(hasChildrenError);
    }

    return false;
  };

  const [isError, setIsError] = useState<boolean>(() => statusCode >= 400 || (!isOpen && hasChildrenError(fetch)));

  const getDurationOffset = () => {
    const durationCharCount = (nsToTime(BigInt(fetch.durationLoad ?? 0)) as string).length;

    if (visualWidthPercentage < 10 && durationCharCount < 12) {
      if (visualOffsetPercentage < 90) {
        return `calc(${visualOffsetPercentage + visualWidthPercentage + 2}%)`;
      }
      if (visualOffsetPercentage >= 90) {
        return `calc(${visualOffsetPercentage - visualWidthPercentage - 10}%)`;
      }
    }
    return `${visualOffsetPercentage + 2}%`;
  };

  const toggleTree = () => {
    setIsOpen((prevOpen) => {
      if (hasChildren) {
        if (prevOpen) {
          setIsError(hasChildrenError(fetch));
        } else {
          setIsError(statusCode >= 400);
        }
      }
      return !prevOpen;
    });
  };

  return (
    <ul
      style={{
        marginLeft: `${16}px`,
      }}
      className={cn(`trace-ul relative before:-top-4 before:h-[34px] lg:max-w-none`, {
        'before:top-0 before:h-[18px]': isParentDetailsOpen,
        'before:!h-full': parentChildrenCount > 1,
        'pl-4': level > 1,
      })}
    >
      <li
        className={cn('group relative', {
          'bg-accent pb-2': showDetails,
        })}
      >
        <div className="relative flex w-full flex-wrap">
          <div
            className="ml-2 flex flex-shrink-0 items-start gap-x-1 border-r border-input py-1"
            style={{
              width: `${paneWidth - level * 32}px`,
            }}
          >
            <Button
              size="icon"
              variant="outline"
              onClick={toggleTree}
              disabled={!hasChildren}
              className={cn('mt-1.5 h-min w-min rounded-sm border border-input p-px', {
                'border-none': !hasChildren,
              })}
            >
              <>
                {hasChildren && isOpen && <MinusIcon className="h-3 w-3 flex-shrink-0" />}
                {hasChildren && !isOpen && <PlusIcon className="h-3 w-3 flex-shrink-0" />}
                {!hasChildren && <CubeIcon className="h-4 w-4 flex-shrink-0" />}
              </>
            </Button>
            {[
              'graphql',
              'parse',
              'normalize',
              'validate',
              'plan',
              'execute',
              'parallel',
              'serial',
              'parallelListItem',
              'Parallel',
              'Sequence',
              'ParallelList',
            ].includes(fetch.type) ? (
              <div className="-translate-y-px px-2.5 py-2 text-xs text-muted-foreground">
                {mapFetchType(fetch.type)}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className=" flex flex-nowrap items-start gap-x-2 overflow-hidden rounded-md px-2 py-1 text-left text-sm group-hover:bg-accent group-hover:text-accent-foreground disabled:cursor-not-allowed"
              >
                <TooltipProvider>
                  <Tooltip delayDuration={500}>
                    <TooltipTrigger className="space-y-1">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-x-1">
                          {isError && <ExclamationTriangleIcon className="mt-1 h-4 w-4 text-destructive" />}
                          <div className="flex flex-1 items-center gap-x-1.5 truncate font-medium">
                            {fetch.dataSourceName}
                            {statusCode ? <Badge>{statusCode}</Badge> : <div />}
                          </div>
                        </div>
                      </div>
                      <div
                        style={{
                          width: `${paneWidth - level * 32 - 44}px`,
                        }}
                        className="truncate text-start text-xs"
                      >
                        <div className="text-xs text-muted-foreground">{sentenceCase(fetch.type)} fetch</div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{fetch.dataSourceName || '-'}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            disabled={[
              'graphql',
              'parse',
              'normalize',
              'validate',
              'plan',
              'execute',
              'parallel',
              'serial',
              'parallelListItem',
              'Parallel',
              'Sequence',
              'ParallelList',
            ].includes(fetch.type)}
            className="group relative flex flex-1 items-center group-hover:brightness-90 disabled:cursor-not-allowed "
          >
            {!['parallel', 'serial', 'parallelListItem', 'Parallel', 'Sequence', 'ParallelList'].includes(
              fetch.type,
            ) && (
              <>
                <div className="absolute h-px w-full bg-input" />
                <div
                  style={{
                    minWidth: '2px',
                    maxWidth: '500px !important',
                    width: `${visualWidthPercentage}%`,
                    left: `${visualOffsetPercentage}%`,
                  }}
                  className="z-8 absolute mx-2 h-3/5 max-h-6 rounded bg-primary"
                />
                <div
                  style={{
                    left: getDurationOffset(),
                  }}
                  className={cn('z-8 absolute bg-transparent text-xs', {
                    'px-2': visualWidthPercentage < 8,
                    '!text-white': visualWidthPercentage >= 8,
                  })}
                >
                  {isLoadSkipped ? 'Load Skipped' : nsToTime(BigInt(fetch.durationLoad ?? 0))}
                </div>
              </>
            )}
          </button>
        </div>
        {showDetails && (
          <div className="my-2 flex flex-wrap gap-x-4 gap-y-1 overflow-hidden border-0 px-10 pr-6 text-xs">
            {fetch.outputTrace && <Attribute name="method" value={fetch.outputTrace.request.method} />}
            {fetch.outputTrace && <Attribute name="endpoint" value={fetch.outputTrace.request.url} />}

            <Attribute name="single flight used" value={`${fetch.singleFlightUsed}`} />
            <Attribute name="single flight shared response" value={`${fetch.singleFlightSharedResponse}`} />
            <Attribute name="load skipped" value={`${fetch.loadSkipped}`} />

            <div className="col-span-full mt-4 flex w-full">
              <div className="z-50 flex w-max items-center gap-8">
                {fetch.outputTrace && (
                  <ViewHeaders
                    requestHeaders={JSON.stringify(fetch.outputTrace.request.headers)}
                    responseHeaders={JSON.stringify(fetch.outputTrace.response.headers)}
                  />
                )}
                {(fetch.input || fetch.rawInput) && <ViewInput input={fetch.input} rawInput={fetch.rawInput} />}
                {fetch.output && <ViewOutput output={fetch.output} />}
                {fetch.loadStats && <ViewLoadStats loadStats={fetch.loadStats} />}
              </div>
            </div>
          </div>
        )}
      </li>
      {hasChildren && isOpen && (
        <>
          {fetch.children?.map((child) => (
            <FetchWaterfall
              key={child.id}
              fetch={child}
              parentFetch={fetch}
              level={level + 1}
              globalDuration={globalDuration}
              globalStartTime={globalStartTime}
              isParentDetailsOpen={showDetails}
              paneWidth={paneWidth}
            />
          ))}
        </>
      )}
    </ul>
  );
};
