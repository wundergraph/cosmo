import { TbHourglass } from 'react-icons/tb';
import { formatMs } from '@/lib/utils';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { DeferStatus } from './types';

export const DeferStatusBadge = ({ defer }: { defer?: DeferStatus }) => {
  if (!defer) {
    return null;
  }

  switch (defer.state) {
    case 'disabled':
      return (
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <button type="button" aria-label="Deferred response status">
              <Badge className="h-8" variant="destructive">
                <TbHourglass className="h-4 w-4" />
              </Badge>
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs rounded-md border bg-background px-2 py-1 !text-foreground text-sm">
            This query uses @defer but defer is disabled on the router. Set engine.enable_defer on the router to enable
            incremental streaming.
          </TooltipContent>
        </Tooltip>
      );
    case 'streaming':
      return (
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <button type="button" aria-label="Deferred response status">
              <Badge className="h-8 border-transparent bg-orange-500 text-white" variant="plain">
                <TbHourglass className="h-4 w-4 animate-spin" />
              </Badge>
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs rounded-md border bg-background px-2 py-1 !text-foreground text-sm">
            Still loading deferred fields
          </TooltipContent>
        </Tooltip>
      );
    case 'complete':
      return (
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <button type="button" aria-label="Deferred response status">
              <Badge className="h-8" variant="success">
                <TbHourglass className="h-4 w-4" />
              </Badge>
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs rounded-md border bg-background px-2 py-1 !text-foreground text-sm">
            {defer.arrived.length
              ? defer.arrived.map((a) => (
                  <div key={a.label}>
                    {a.label}: {formatMs(a.atMs)}
                  </div>
                ))
              : 'No deferred fields'}
          </TooltipContent>
        </Tooltip>
      );
  }
};
