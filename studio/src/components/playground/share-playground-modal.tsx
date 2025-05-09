import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { useSharePlaygroundModal } from "@/hooks/use-share-playground-modal";
import { CopyIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { TooltipContent, TooltipTrigger } from "@radix-ui/react-tooltip";
import { useState } from "react";
import { FiShare2 } from "react-icons/fi";
import { OPTION_TYPES } from "@/lib/constants";

interface ShareOptionsListProps {
  options: ReadonlyArray<{
    id: string,
    label: string,
    isDisabled: boolean,
    isChecked: boolean,
    description?: string,
  }>;
  selectedOptions: Record<string, boolean>;
  onOptionChange: (id: string, checked: boolean) => void;
}

interface WarningProps {
  data: { title: string; description: string } | null;
}

interface CopyLinkProps {
  shareableUrl: string;
  isCopyDisabled: boolean;
  onCopy: () => void;
}

const ShareOptionsList = ({ options, selectedOptions, onOptionChange }: ShareOptionsListProps) => {
  const availableOptions = options.filter(opt => opt.id === OPTION_TYPES.OPERATION || !opt.isDisabled);
  const unavailableOptions = options.filter(opt => opt.id !== OPTION_TYPES.OPERATION && opt.isDisabled);

  const renderOption = ({ id, label, description, isDisabled }: typeof options[0]) => {
    const textStyles = `select-none ${isDisabled ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer'}`;

    return (
      <div key={id} className="flex items-start space-x-3">
        <Checkbox
          id={id}
          className="mt-1 h-4 w-4"
          checked={selectedOptions[id]}
          disabled={isDisabled}
          onCheckedChange={(checked) => onOptionChange(id, checked as boolean)}
        />
        <div className="flex-1">
          <label
            htmlFor={id}
            className={`text-sm font-medium ${textStyles}`}
          >
            {label}
          </label>
          <div 
            className={`text-xs text-muted-foreground mt-1 ${textStyles}`}
            onClick={() => !isDisabled && onOptionChange(id, !selectedOptions[id])}
          >
            {description}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h3 className="text-sm text-muted-foreground select-none">
          Select what to share
        </h3>
        {availableOptions.map(renderOption)}
      </div>

      {unavailableOptions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm text-muted-foreground select-none">
            No content available to share. Add content to enable sharing 
            {unavailableOptions.length > 1 ? " these options" : " this option"}.
          </h3>
          {unavailableOptions.map(renderOption)}
        </div>
      )}
    </div>
  );
};

const Warning = ({ data }: WarningProps) => {
  if (!data) return null;

  return (
    <Alert className="bg-red-100 text-red-700 p-4">
      <ExclamationTriangleIcon className="h-4 w-4" />
      <AlertTitle className="font-bold">{data.title}</AlertTitle>
      <AlertDescription>{data.description}</AlertDescription>
    </Alert>
  );
};

const CopyLink = ({ shareableUrl, isCopyDisabled, onCopy }: CopyLinkProps) => (
  <div className="flex items-center gap-4">
    <div className="relative group w-full">
      <Input
        value={shareableUrl}
        readOnly
        disabled={isCopyDisabled}
        className="pr-10 font-mono text-sm w-full"
        onClick={(e) => e.currentTarget.select()}
      />
      <Button
        size="icon"
        variant="ghost"
        className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={onCopy}
        disabled={isCopyDisabled}
        aria-disabled={isCopyDisabled}
        aria-label="Copy URL to clipboard"
      >
        <CopyIcon className="h-4 w-4" />
      </Button>
    </div>
    {shareableUrl && (
      <Button onClick={onCopy} variant="secondary" className="flex-shrink-0" disabled={isCopyDisabled}>
        <CopyIcon className="mr-2 h-4 w-4" />
        Copy Link
      </Button>
    )}
  </div>
);

export const SharePlaygroundModal = () => {
  const [isOpen, setIsOpen] = useState(false);
  const {
    options,
    selectedOptions,
    shareableUrl,
    warning,
    handleCopyLink,
    handleOptionChange,
  } = useSharePlaygroundModal(isOpen);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="graphiql-toolbar-button"
            >
              <FiShare2 className="graphiql-toolbar-icon" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent className="rounded-md border bg-background px-2 py-1">
          Share Playground State
        </TooltipContent>
      </Tooltip>
      <DialogContent>
        <DialogHeader className="space-y-2">
          <DialogTitle className="select-none">Share Playground</DialogTitle>
          <DialogDescription className="select-none">
            Choose what to include in your shared playground URL
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6">
          <Warning data={warning} />
          <ShareOptionsList 
            options={options}
            selectedOptions={selectedOptions}
            onOptionChange={handleOptionChange}
          />
          <CopyLink
            shareableUrl={shareableUrl}
            isCopyDisabled={!!warning}
            onCopy={handleCopyLink}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}; 