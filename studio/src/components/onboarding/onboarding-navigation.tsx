import { ArrowLeftIcon, ArrowRightIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import { Link } from '../ui/link';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

export const OnboardingNavigation = ({
  backHref,
  forward,
  forwardLabel = 'Next',
  onSkip,
}: {
  backHref?: string;
  forward: { href: string } | { onClick: () => void; isLoading?: boolean; disabled?: boolean };
  forwardLabel?: string;
  onSkip: () => void;
}) => {
  return (
    <div className="mt-auto flex w-full justify-between pt-8">
      <div className="flex items-center gap-1">
        <Button asChild variant="outline" onClick={onSkip}>
          <Link href="/">Skip</Link>
        </Button>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <InfoCircledIcon className="size-3.5 text-muted-foreground" />
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
          <Button
            className="group"
            onClick={forward.onClick}
            isLoading={forward.isLoading}
            disabled={forward.isLoading || forward.disabled}
          >
            {forwardLabel}
            <ArrowRightIcon className="ml-2 transition-transform group-hover:translate-x-1" />
          </Button>
        )}
      </div>
    </div>
  );
};
