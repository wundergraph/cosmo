import type { ReactNode } from 'react';
import { TbHourglass } from 'react-icons/tb';
import { formatMs } from '@/lib/utils';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { DeferStatus } from './types';

type Look = { variant: 'destructive' | 'plain' | 'success'; className: string; spin: boolean; tip: ReactNode };

const describe = (defer: DeferStatus): Look => {
  switch (defer.state) {
    case 'disabled':
      return {
        variant: 'destructive',
        className: '',
        spin: false,
        tip: 'This query uses @defer but defer is disabled on the router. Set engine.enable_defer on the router to enable incremental streaming.',
      };
    case 'streaming':
      return {
        variant: 'plain',
        className: 'border-transparent bg-orange-500 text-white',
        spin: true,
        tip: 'Still loading deferred fields',
      };
    case 'complete':
      return {
        variant: 'success',
        className: '',
        spin: false,
        tip: defer.arrived.length
          ? defer.arrived.map((a) => (
              <div key={a.label}>
                {a.label}: {formatMs(a.atMs)}
              </div>
            ))
          : 'No deferred fields',
      };
  }
};

export const DeferStatusBadge = ({ defer }: { defer?: DeferStatus }) => {
  if (!defer) {
    return null;
  }

  const { variant, className, spin, tip } = describe(defer);
  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <Badge className={`h-8 ${className}`} variant={variant}>
          <TbHourglass className={`h-4 w-4 ${spin ? 'animate-spin' : ''}`} />
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs rounded-md border bg-background px-2 py-1 !text-foreground text-sm">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
};
