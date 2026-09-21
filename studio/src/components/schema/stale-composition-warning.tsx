import Link from 'next/link';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Alert } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export const StaleCompositionIcon = () => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ExclamationTriangleIcon className="h-3.5 w-3.5 shrink-0 translate-y-px text-destructive" />
      </TooltipTrigger>
      <TooltipContent>Latest composition failed &mdash; showing the last successful composition.</TooltipContent>
    </Tooltip>
  );
};
