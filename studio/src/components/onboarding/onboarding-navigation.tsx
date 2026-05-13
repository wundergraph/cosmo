import { ArrowLeftIcon, ArrowRightIcon, InfoCircledIcon, UpdateIcon } from '@radix-ui/react-icons';
import { cn } from '@/lib/utils';
import { Link } from '../ui/link';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

export const OnboardingNavigation = ({
  backHref,
  forward,
  forwardLabel = 'Next',
  onSkip,
  className,
}: {
  backHref?: string;
  forward: { href: string } | { onClick: () => void; isLoading?: boolean; disabled?: boolean };
  forwardLabel?: string;
  onSkip: () => void;
  className?: string;
}) => {
  return (
    <div className={cn('mt-auto flex w-full justify-between pt-8', className)}>
      <div className="flex items-center gap-1">
        <Button asChild variant="outline" onClick={onSkip}>
          <Link href="/">Skip</Link>
        </Button>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Open onboarding tooltip"
              className="rounded-sm border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <InfoCircledIcon className="ml-2 size-3.5 text-muted-foreground" />
            </button>
          </TooltipTrigger>
          <TooltipContent>You can always get back to this wizard from the application. Safe to skip.</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex gap-2">
        {backHref ? (
          <Button className="group" asChild variant="outline">
            <Link href={backHref}>
              <ArrowLeftIcon className="mr-2 transition-transform group-hover:-translate-x-1" />
              Back
            </Link>
          </Button>
        ) : (
          <Button variant="outline" disabled>
            <ArrowLeftIcon className="mr-2" />
            Back
          </Button>
        )}
        {'href' in forward ? (
          <Button className="group" asChild>
            <Link href={forward.href}>
              {forwardLabel}
              <ArrowRightIcon className="ml-2 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        ) : (
          <Button className="group relative" onClick={forward.onClick} disabled={forward.isLoading || forward.disabled}>
            {forward.isLoading && (
              <span className="absolute inset-0 flex items-center justify-center">
                <UpdateIcon className="animate-spin" />
              </span>
            )}
            <span className={cn('inline-flex items-center justify-center', forward.isLoading && 'opacity-0')}>
              {forwardLabel}
              <ArrowRightIcon className="ml-2 transition-transform group-hover:translate-x-1" />
            </span>
          </Button>
        )}
      </div>
    </div>
  );
};
