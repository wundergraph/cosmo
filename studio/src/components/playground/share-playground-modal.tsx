import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FiShare2 } from "react-icons/fi";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { Tooltip } from "@/components/ui/tooltip";
import { TooltipContent, TooltipTrigger } from "@radix-ui/react-tooltip";
import { CopyIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { useState, useContext, useCallback, useEffect } from "react";
import { createStateUrl } from "@/lib/playground-url-state";
import { PlaygroundUrlState } from "@/types/playground.types";
import { PlaygroundContext } from "./types";

const MAX_URL_LENGTH = 2000;

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

  // sharing state only for the active tab
  const { tabsState } = useContext(PlaygroundContext);
  const activeTabId = tabsState.activeTabIndex;
  const { query, variables, headers } = tabsState.tabs[activeTabId] ?? {};

  // Reset state when modal is opened
  useEffect(() => {
    if (!isOpen) return;

    setSelectedOptions(DEFAULT_SELECTED_OPTIONS);
    setShareableUrl("");
  }, [isOpen]);

  const generateShareableUrl = useCallback(() => {
    try {
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

        stateToShare.preFlight = {
            content: (preFlightSelected && preFlightSelected!== "undefined") ? JSON.parse(preFlightSelected)?.content : undefined,
            enabled: preFlightEnabled === "true",
        };
      }
      if (selectedOptions.preOperation) {
        const preOperationSelected = localStorage.getItem("playground:pre-operation:selected");
        const scriptsTabState = localStorage.getItem("playground:script:tabState");
        const parsedScriptsTabState = scriptsTabState ? JSON.parse(scriptsTabState) : null;
        const preOpEnabled = (parsedScriptsTabState && parsedScriptsTabState[activeTabId]?.["pre-operation"]?.enabled) ?? false;

        stateToShare.preOperation = {
            content: (preOperationSelected && preOperationSelected !== "undefined") ? JSON.parse(preOperationSelected)?.content : undefined,
            enabled: preOpEnabled === true,
        };
      }
      if (selectedOptions.postOperation) {
        const postOperationSelected = localStorage.getItem("playground:post-operation:selected");
        const scriptsTabState = localStorage.getItem("playground:script:tabState");
        const parsedScriptsTabState = scriptsTabState ? JSON.parse(scriptsTabState) : null;
        const postOpEnabled = (parsedScriptsTabState && parsedScriptsTabState[activeTabId]?.["post-operation"]?.enabled) ?? false;

        stateToShare.postOperation = {
            content: (postOperationSelected && postOperationSelected !== "undefined") ? JSON.parse(postOperationSelected)?.content : undefined,
            enabled: postOpEnabled === true,
        };
      }

      setShareableUrl(createStateUrl(stateToShare));
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
                  onCheckedChange={(checked) => 
                    setSelectedOptions(prev => ({ ...prev, [id]: !!checked }))
                  }
                />
                <label className="cursor-pointer select-none" htmlFor={id}>{label}</label>
              </div>
            ))}
          </div>
          <Button onClick={generateShareableUrl} className="w-full">
            Generate Link
          </Button>
          {
            shareableUrl && (
              <Button onClick={handleCopyLink} className="w-full">
                <CopyIcon className="mr-2 h-4 w-4" />
                Copy Link
              </Button>
            )
          }
        </div>
        {shareableUrl.length > MAX_URL_LENGTH && (
          <Alert>
            <ExclamationTriangleIcon className="h-4 w-4" />
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription>
              The generated URL is too long and may not work in all browsers.
            </AlertDescription>
          </Alert>
        )}
        {/* if url exists, consider showing the url here */}
        {/* consider showing warning here
        1. when the url is too long
        2. when the url is stale due to changes in checkbox state */}
      </DialogContent>
    </Dialog>
  );
}; 