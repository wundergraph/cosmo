import Link from 'next/link';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Alert } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Shown beside a feature flag in the schema/SDL selector when the flag's latest composition failed, so the schema
 * being served is its last successful composition rather than the newest one.
 *
 * `TooltipProvider` wraps the whole app in `pages/_app.tsx`, so no local provider is needed here.
 */
export const StaleCompositionIcon = () => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ExclamationTriangleIcon className="h-3.5 w-3.5 text-warning" />
      </TooltipTrigger>
      <TooltipContent>Latest composition failed &mdash; showing the last successful composition.</TooltipContent>
    </Tooltip>
  );
};

export const StaleCompositionBanner = ({
  featureFlagName,
  compositionsHref,
  className,
}: {
  featureFlagName: string;
  compositionsHref: string;
  className?: string;
}) => {
  return (
    <Alert variant="warn" className={className}>
      <ExclamationTriangleIcon className="h-5 w-5" />
      <div>
        Showing the last successful composition. The latest composition of{' '}
        <span className="font-semibold">{featureFlagName}</span> failed, so this is not the latest schema.{' '}
        <Link href={compositionsHref} className="underline">
          View compositions
        </Link>
        .
      </div>
    </Alert>
  );
};
