import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FiShare2 } from "react-icons/fi";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { Tooltip } from "@/components/ui/tooltip";
import { TooltipContent, TooltipTrigger } from "@radix-ui/react-tooltip";
import { CopyIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { useState, useContext, useCallback, useEffect } from "react";
import { createCompressedStateUrl } from "@/lib/playground-url-state";
import { PlaygroundUrlState } from "@/types/playground.types";
import { PlaygroundContext } from "./types";

const MAX_URL_LENGTH = 2000;
const WARNING_MESSAGES = {
  URL_TOO_LONG: {
    title: "Warning!",
    description: "The generated URL is too long and may not work in all browsers. Consider removing scripts",
  },
  OPTIONS_CHANGED: {
    title: "Options Changed!",
    description: "You've changed which options to include. Click 'Generate Link' to update",
  },
};

const SHARE_OPTIONS = [
  // operation is always checked and disabled
  { id: "operation", label: "Operation", isChecked: true, isDisabled: true },
  { id: "variables", label: "Variables", isChecked: false, isDisabled: false },
  { id: "headers", label: "Headers", isChecked: false, isDisabled: false },
  { id: "preFlight", label: "Pre-Flight Script", isChecked: false, isDisabled: false },
  { id: "preOperation", label: "Pre-request Script", isChecked: false, isDisabled: false },
  { id: "postOperation", label: "Post-request Script", isChecked: false, isDisabled: false },
] as const;

type ShareOptionId = typeof SHARE_OPTIONS[number]["id"];

const DEFAULT_SELECTED_OPTIONS = SHARE_OPTIONS.reduce((acc, { id, isChecked }) => {
    acc[id] = isChecked;
    return acc;
  }, {} as Record<ShareOptionId, boolean>);

export const SharePlaygroundModal = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<Record<ShareOptionId, boolean>>(
    () => DEFAULT_SELECTED_OPTIONS    
  );
  const { toast } = useToast();
  const [shareableUrl, setShareableUrl] = useState("");
  const [warning, setWarning] = useState<{ title: string; description: string } | null>(null);

  // sharing state only for the active tab
  const { tabsState } = useContext(PlaygroundContext);
  const currentActiveTab = tabsState.tabs[tabsState.activeTabIndex] ?? {};
  const { query, variables, headers } = currentActiveTab;

  // Reset state when modal is opened
  useEffect(() => {
    if (!isOpen) return;

    setSelectedOptions(DEFAULT_SELECTED_OPTIONS);
    setShareableUrl("");
  }, [isOpen]);

  const generateShareableUrl = useCallback(() => {
    try {
      const buildStateToShare = () => {
        const stateToShare: PlaygroundUrlState = {
          // Always include operation
          operation: query ?? "",
        };
  
        if (selectedOptions.variables && variables) {
          stateToShare.variables = variables;
        }
        if (selectedOptions.headers && headers !== null) stateToShare.headers = headers;
        if (selectedOptions.preFlight) {
          const preFlightSelected = localStorage.getItem("playground:pre-flight:selected");
          const preFlightEnabled = localStorage.getItem("playground:pre-flight:enabled");
          const parsedPreFlightSelected = 
            (preFlightSelected && preFlightSelected !== "undefined") ? JSON.parse(preFlightSelected) : {};
  
          stateToShare.preFlight = {
              ...parsedPreFlightSelected,
              enabled: preFlightEnabled === "true",
          };
        }
        if (selectedOptions.preOperation) {
          const scriptsTabState = localStorage.getItem("playground:script:tabState");
          const parsedScriptsTabState = scriptsTabState ? JSON.parse(scriptsTabState) : null;
          const preOperationOfActiveTab = parsedScriptsTabState && parsedScriptsTabState[currentActiveTab.id]?.["pre-operation"];
  
          stateToShare.preOperation = preOperationOfActiveTab;
        }
        if (selectedOptions.postOperation) {
          const scriptsTabState = localStorage.getItem("playground:script:tabState");
          const parsedScriptsTabState = scriptsTabState ? JSON.parse(scriptsTabState) : null;
          const postOperationOfActiveTab = parsedScriptsTabState && parsedScriptsTabState[currentActiveTab.id]?.["post-operation"];
          
          stateToShare.postOperation = postOperationOfActiveTab;
        }
        return stateToShare;
      }

      const stateToShare: PlaygroundUrlState = buildStateToShare();

      const newUrl = createCompressedStateUrl(stateToShare);
      setShareableUrl(newUrl);
      if (newUrl.length > MAX_URL_LENGTH) {
        // todo: add a button in error message to easily remove scripts
        setWarning({
          title: WARNING_MESSAGES.URL_TOO_LONG.title,
          description: WARNING_MESSAGES.URL_TOO_LONG.description,
        });
      } else {
        setWarning(null);
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Something went wrong",
        description: "We couldn't generate the shareable URL. Please try again later",
      });
      if (process.env.NODE_ENV === "development") {
        console.error(error);
      }
    }
  }, [query, variables, headers, selectedOptions]);

  const handleCopyLink = () => {
    try {
      if (!shareableUrl) {
        throw new Error("Failed to generate shareable URL");
      }

      navigator.clipboard.writeText(shareableUrl);
      toast({
        description: "Playground state URL copied to clipboard",
        duration: 3000,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Couldn't copy the link",
        description: "Please try again in a few seconds",
      });
      if (process.env.NODE_ENV === "development") {
        console.error(error);
      }
    }
  };

  const renderFootNote = () => {
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
            onClick={handleCopyLink}
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
            {/* can optionally specify tab title here */}
          <DialogTitle>Share Playground State</DialogTitle>
          <DialogDescription>
            Select which parts of your playground state to include in the shared URL
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-4">
            {SHARE_OPTIONS.map(({ id, label, isDisabled }) => (
              <div key={id} className="flex items-center space-x-2">
                <Checkbox
                  id={id}
                  checked={selectedOptions[id]}
                  disabled={isDisabled}
                  onCheckedChange={(checked) => {
                    setSelectedOptions(prev => ({ ...prev, [id]: !!checked }));
                    shareableUrl && setWarning({
                      title: WARNING_MESSAGES.OPTIONS_CHANGED.title,
                      description: WARNING_MESSAGES.OPTIONS_CHANGED.description,
                    });
                  }}
                />
                <label className="cursor-pointer select-none" htmlFor={id}>{label}</label>
              </div>
            ))}
          </div>
          <div className="flex gap-4">
            <Button onClick={generateShareableUrl} className="basis-1/2 flex-grow-0">
              Generate Link
            </Button>
            {shareableUrl && (
              <Button onClick={handleCopyLink} variant="secondary" className="basis-1/2 flex-grow-0" disabled={!!warning}>
                <CopyIcon className="mr-2 h-4 w-4" />
                Copy Link
              </Button>
            )}
          </div>
          {renderFootNote()}
        </div>
      </DialogContent>
    </Dialog>
  );
}; 