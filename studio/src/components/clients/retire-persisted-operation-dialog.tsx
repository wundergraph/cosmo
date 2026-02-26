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

export const RetirePersistedOperationDialog = ({
  isOpen,
  operationId,
  onSubmitButtonClick,
  onClose,
}: {
  isOpen: boolean;
  operationId: string;
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

        <div className="flex flex-col gap-y-2">
          <span className="text-sm">
            Are you sure you want to delete this persisted operation? <br />
            The operation <OperationLabel operationId={operationId} /> is
            receiving traffic.
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

const OperationLabel = ({ operationId }: { operationId: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <code className="inline-block max-w-[120px] cursor-pointer overflow-hidden text-ellipsis align-middle">
        {operationId}
      </code>
    </TooltipTrigger>
    <TooltipContent>{operationId}</TooltipContent>
  </Tooltip>
);
