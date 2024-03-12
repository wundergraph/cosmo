import { cn } from "@/lib/utils";
import { CheckIcon, CopyIcon } from "@radix-ui/react-icons";
import copy from "copy-to-clipboard";
import { useEffect, useState } from "react";
import { Button } from "./button";

interface CLIStep {
  description: string;
  command: string;
}

export const CLI = ({
  command,
  className,
  spanClassName,
}: {
  command: string;
  className?: string;
  spanClassName?: string;
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (copied) {
      copy(command);
      const to = setTimeout(setCopied, 1000, false);
      return () => clearTimeout(to);
    }
  }, [command, copied]);

  return (
    <Button
      className={cn(
        "h-auto w-full justify-between text-muted-foreground",
        className,
      )}
      variant="outline"
      onClick={() => setCopied(true)}
    >
      <span
        className={cn(
          "mr-2 whitespace-pre-wrap font-mono text-xs",
          spanClassName,
        )}
      >
        {command}
      </span>
      {copied ? (
        <CheckIcon className="h-4 w-4 flex-shrink-0" />
      ) : (
        <CopyIcon className="h-4 w-4 flex-shrink-0" />
      )}
    </Button>
  );
};

export const CLISteps = ({ steps }: { steps: CLIStep[] }) => {
  return (
    <div className="flex w-full flex-col gap-y-6 rounded border border-dashed p-6 text-sm">
      {steps.map((step, index) => {
        return (
          <div className="flex flex-col items-start gap-y-2" key={index}>
            <p>
              {index + 1}. {step.description}
            </p>
            <CLI
              command={step.command}
              className="w-full max-w-full md:w-full"
            />
          </div>
        );
      })}
    </div>
  );
};
