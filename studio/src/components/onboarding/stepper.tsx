import { cn } from '@/lib/utils';
import { CheckIcon } from '@radix-ui/react-icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRouter } from 'next/router';
import type { StepperStep } from './onboarding-steps';

export function Stepper({
  steps,
  currentStep,
  className,
}: {
  steps: StepperStep[];
  currentStep: number;
  className?: string;
}) {
  const router = useRouter();

  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn('flex items-center', className)}>
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;
          const canNavigate = isCompleted && !isCurrent;

          return (
            <div key={step.number} className="flex items-center">
              {index > 0 && (
                <div className="h-0.5 w-8 bg-muted">
                  <div
                    className={cn(
                      'h-full origin-left bg-primary transition-transform duration-300 ease-in-out',
                      isCompleted || isCurrent ? 'scale-x-100' : 'scale-x-0',
                    )}
                  />
                </div>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={!canNavigate}
                    onClick={canNavigate ? () => router.push(`/onboarding/${step.number}`) : undefined}
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-medium transition-all duration-300',
                      isCompleted && 'border-primary bg-primary text-primary-foreground',
                      isCurrent && 'border-primary bg-background text-primary',
                      !isCompleted && !isCurrent && 'border-muted bg-background text-muted-foreground',
                      canNavigate ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
                    )}
                  >
                    {isCompleted ? <CheckIcon className="h-3 w-3 duration-200 animate-in zoom-in-0" /> : step.number}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{step.label}</TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
