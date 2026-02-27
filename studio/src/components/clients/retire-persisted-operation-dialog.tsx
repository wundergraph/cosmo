import type { SyntheticEvent } from "react";
import { Link } from "@/components/ui/link";
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
  operationNames,
  operationHasTraffic,
  metricsLink,
  onSubmitButtonClick,
  onClose,
}: {
  isOpen: boolean;
  operationNames: string[];
  operationHasTraffic: boolean;
  metricsLink: string;
  onSubmitButtonClick?: (event: SyntheticEvent<HTMLButtonElement>) => void;
  onClose?: () => void;
}) => {
  const isPlural = operationNames.length > 1;
  const pluralizedOperation = isPlural ? "operations" : "operation";

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
        {operationHasTraffic ? (
          <Alert variant="warn">
            If you are not sending us analytics, we{" "}
            <span className="font-semibold">cannot guarantee</span> that this
            operation is not receiving traffic. If you are not sure, check the{" "}
            <Link href={metricsLink} className="underline">
              metrics
            </Link>
            .
          </Alert>
        ) : (
          <Alert variant="warn">
            The {pluralizedOperation} {isPlural ? "are" : "is"}{" "}
            <span className="font-semibold">receiving traffic</span>. Visit{" "}
            <Link href={metricsLink} className="underline">
              metrics
            </Link>{" "}
            to learn more.
          </Alert>
        )}

        <div className="flex flex-col gap-y-2">
          <p className="text-sm">
            {operationHasTraffic ? (
              <>
                Are you sure you want to{" "}
                <span className="font-semibold">retire</span> the{" "}
                {pluralizedOperation}?
                <div className="mt-1">
                  <OperationLabel names={operationNames} />
                </div>
              </>
            ) : (
              <>
                Are you sure you want to{" "}
                <span className="font-semibold">
                  retire the following {pluralizedOperation}
                </span>
                ?<br />
                <span className="mt-1 inline-block">
                  <OperationLabel names={operationNames} />
                </span>
              </>
            )}
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

const OperationLabel = ({ names }: { names: string[] }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <code
        className={
          "inline-block max-w-2xl cursor-pointer overflow-hidden text-ellipsis align-middle"
        }
      >
        {names.length > 4 ? names.slice(0, 4).join("\n") : names.join("\n")}
      </code>
    </TooltipTrigger>
    <TooltipContent>{names.join(",")}</TooltipContent>
  </Tooltip>
);
