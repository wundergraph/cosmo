import { PlaygroundContext } from '@/components/playground/types';
import { useToast } from '@/components/ui/use-toast';
import { createCompressedStateUrl } from '@/lib/playground-url-state';
import { PlaygroundUrlState } from '@/types/playground.types';
import { useCallback, useContext, useEffect, useState } from 'react';

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

export const useSharePlaygroundModal = (isOpen: boolean) => {
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

  const buildStateToShare = useCallback(() => {
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
  }, [query, variables, headers, selectedOptions, currentActiveTab.id]);

  const generateShareableUrl = useCallback(() => {
    try {
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
  }, [buildStateToShare, toast]);

  const handleCopyLink = useCallback(() => {
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
  }, [shareableUrl, toast]);

  const handleOptionChange = useCallback((id: string, checked: boolean) => {
    setSelectedOptions(prev => ({ ...prev, [id]: !!checked }));
    if (shareableUrl) {
      setWarning({
        title: WARNING_MESSAGES.OPTIONS_CHANGED.title,
        description: WARNING_MESSAGES.OPTIONS_CHANGED.description,
      });
    }
  }, [shareableUrl]);

  return {
    options: SHARE_OPTIONS,
    selectedOptions,
    shareableUrl,
    warning,
    generateShareableUrl,
    handleCopyLink,
    handleOptionChange,
  };
}