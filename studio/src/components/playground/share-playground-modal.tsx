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

interface ShareOptionsListProps {
  options: ReadonlyArray<{
    id: string,
    label: string,
    isDisabled: boolean,
    isChecked: boolean,
  }>;
  selectedOptions: Record<string, boolean>;
  onOptionChange: (id: string, checked: boolean) => void;
}

interface ShareUrlDisplayProps {
  shareableUrl: string;
  warning: { title: string; description: string } | null;
  onCopy: () => void;
}

interface ShareActionButtonsProps {
  showCopyButton: boolean;
  isCopyDisabled: boolean;
  onGenerate: () => void;
  onCopy: () => void;
}

const ShareOptionsList = ({ options, selectedOptions, onOptionChange }: ShareOptionsListProps) => {
  return (
    <div className="space-y-4">
      {options.map(({ id, label, isDisabled }) => (
        <div key={id} className="flex items-center space-x-2">
          <Checkbox
            id={id}
            checked={selectedOptions[id]}
            disabled={isDisabled}
            onCheckedChange={(checked) => onOptionChange(id, checked as boolean)}
          />
          <label className="cursor-pointer select-none" htmlFor={id}>{label}</label>
        </div>
      ))}
    </div>
  )
}

const ShareUrlDisplay = ({ shareableUrl, warning, onCopy }: ShareUrlDisplayProps) => {
  if (!shareableUrl) return null;

  return (
    <>
      <div className="relative group">
        <Input
          value={shareableUrl}
          readOnly
          disabled={!!warning}
          className="pr-10 font-mono text-sm"
          onClick={(e) => e.currentTarget.select()}
        />
        <Button
          size="icon"
          variant="ghost"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={onCopy}
          disabled={!!warning}
          aria-disabled={!!warning}
          aria-label="Copy URL to clipboard"
        >
          <CopyIcon className="h-4 w-4" />
        </Button>
      </div>
      {warning && (
        <Alert>
          <ExclamationTriangleIcon className="h-4 w-4" />
          <AlertTitle>{warning.title}</AlertTitle>
          <AlertDescription>{warning.description}</AlertDescription>
        </Alert>
      )}
    </>
  )
}

const ShareActionButtons = ({ showCopyButton, isCopyDisabled, onGenerate, onCopy }: ShareActionButtonsProps) => {
  return (
    <div className="flex gap-4">
      <Button onClick={onGenerate} className="basis-1/2 flex-grow-0">
        Generate Link
      </Button>
      {showCopyButton && (
        <Button onClick={onCopy} variant="secondary" className="basis-1/2 flex-grow-0" disabled={isCopyDisabled}>
          <CopyIcon className="mr-2 h-4 w-4" />
          Copy Link
        </Button>
      )}
    </div>
  );
}

export const SharePlaygroundModal = () => {
  const [isOpen, setIsOpen] = useState(false);
  const {
    options,
    selectedOptions,
    shareableUrl,
    warning,
    generateShareableUrl,
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
        <DialogHeader>
          <DialogTitle>Share Playground State</DialogTitle>
          <DialogDescription>
            Select which parts of your playground state to include in the shared URL
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <ShareOptionsList 
            options={options}
            selectedOptions={selectedOptions}
            onOptionChange={handleOptionChange}
          />
          <ShareActionButtons
            showCopyButton={!!shareableUrl}
            isCopyDisabled={!!warning}
            onGenerate={generateShareableUrl}
            onCopy={handleCopyLink}
          />
          <ShareUrlDisplay
            shareableUrl={shareableUrl}
            warning={warning}
            onCopy={handleCopyLink}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}; 