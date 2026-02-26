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

export const RetirePersistedOperationDialog = ({
  isOpen,
  operationName,
  operationHasTraffic,
  onSubmitButtonClick,
  onClose,
}: {
  isOpen: boolean;
  operationName: string;
  operationHasTraffic: boolean;
  onSubmitButtonClick?: (event: SyntheticEvent<HTMLButtonElement>) => void;
  onClose?: () => void;
}) => {
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
            If you are not sending us traffic data, we cannot guarantee that
            this operation is not receiving traffic. If you are not sure, check
            the metrics for this operation.
          </Alert>
        )}

        <div className="flex flex-col gap-y-2">
          <span className="text-sm">
            <br />
            {operationHasTraffic ? (
              <>
                The operation <OperationLabel name={operationName} /> is
                receiving traffic.
              </>
            ) : <>Are you sure you want to persisted operation <OperationLabel name={operationName} />?</>}
          </span>
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

const OperationLabel = ({ name }: { name: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <code className="inline-block max-w-[120px] cursor-pointer overflow-hidden text-ellipsis align-middle">
        {name}
      </code>
    </TooltipTrigger>
    <TooltipContent>{name}</TooltipContent>
  </Tooltip>
);
