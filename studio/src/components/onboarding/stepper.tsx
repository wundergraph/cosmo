import { cn } from '@/lib/utils';
import { CheckIcon } from '@radix-ui/react-icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export interface StepperStep {
  label: string;
}

interface StepperProps {
  steps: StepperStep[];
  currentStep: number;
  className?: string;
}

export function Stepper({ steps, currentStep, className }: StepperProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn('flex items-center', className)}>
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <div key={step.label} className="flex items-center">
              {index > 0 && (
                <div className={cn('h-0.5 w-8 transition-colors', isCompleted ? 'bg-primary' : 'bg-muted')} />
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      'flex h-5 w-5 cursor-default items-center justify-center rounded-full border-2 text-[10px] font-medium transition-colors',
                      isCompleted && 'border-primary bg-primary text-primary-foreground',
                      isCurrent && 'border-primary bg-background text-primary',
                      !isCompleted && !isCurrent && 'border-muted bg-background text-muted-foreground',
                    )}
                  >
                    {isCompleted ? <CheckIcon className="h-3 w-3" /> : index + 1}
                  </div>
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
