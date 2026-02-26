import type { SyntheticEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export const RetirePersistedOperationDialog = ({
  isOpen,
  operationNames,
  operationHasTraffic,
  onSubmitButtonClick,
  onClose,
}: {
  isOpen: boolean;
  operationNames: string[];
  operationHasTraffic: boolean;
  onSubmitButtonClick?: (event: SyntheticEvent<HTMLButtonElement>) => void;
  onClose?: () => void;
}) => {
  const isPlural = operationNames.length > 1;
  const pluralizedOperation = isPlural ? 'operations' : 'operation';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(willOpen) => {
        if (!willOpen) {
          onClose?.();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retire persisted operation</DialogTitle>
        </DialogHeader>

        {!operationHasTraffic && (
          <Alert variant="warn">
            If you are not sending us analytics, we <span className='font-semibold'>cannot guarantee</span> that
            this operation is not receiving traffic. If you are not sure, check
            the metrics.
          </Alert>
        )}

        <div className="flex flex-col gap-y-2">
          <p className="text-sm">
            {operationHasTraffic ? (
              <>
                The {pluralizedOperation} <OperationLabel names={operationNames} /> {isPlural ? 'are' : 'is'} <span className='font-semibold'>receiving traffic</span>.<br />
                Are you sure you want to <span className='font-semibold'>retire</span> the {pluralizedOperation}?
              </>
            ) : (<>
              Are you sure you want to <span className='font-semibold'>retire the following {pluralizedOperation}</span>?<br /><span className='mt-1 inline-block'><OperationLabel names={operationNames} inline={false} /></span></>)
            }
          </p>
        </div>
        <Button
          className="mt-2"
          type="submit"
          variant="destructive"
          onClick={onSubmitButtonClick}
        >
          Retire
        </Button>
      </DialogContent>
    </Dialog>
  );
};

const OperationLabel = ({ names, inline = true }: { names: string[]; inline?: boolean }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <code className={cn('inline-block cursor-pointer overflow-hidden text-ellipsis align-middle', {
        'max-w-[180px]': inline,
        'max-w-2xl': !inline,
      })}>
        {names.length > 4 ? names.slice(0, 4).join(inline ? ',' : '\n') : names.join(inline ? ',' : '\n')}
      </code>
    </TooltipTrigger>
    <TooltipContent>{names.join(',')}</TooltipContent>
  </Tooltip>
);
