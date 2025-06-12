import { PlaygroundContext, ShareOptionId } from '@/components/playground/types';
import { useToast } from '@/components/ui/use-toast';
import { OPTION_TYPES, SHARE_OPTIONS } from '@/lib/constants';
import { buildStateToShare, createCompressedStateUrl } from '@/lib/playground-url-state-encoding';
import { PlaygroundUrlState } from '@/components/playground/types';
import { useCallback, useContext, useEffect, useState, useMemo } from 'react';
import { useLocalStorage } from '@/hooks/use-local-storage';

const MAX_URL_LENGTH = 2000;
const WARNING_MESSAGES = {
  URL_TOO_LONG: {
    title: "Warning!",
    description: "The generated URL is too long and may not work in all browsers. Consider removing some options.",
  },
};

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
  const currentActiveTab = useMemo(() => tabsState.tabs[tabsState.activeTabIndex] ?? {}, [tabsState]);

  // Use useLocalStorage for scripts
  const [scriptsTabState] = useLocalStorage<{ [key: string]: Record<string, any> }>('playground:script:tabState', {});
  const [preFlightScript] = useLocalStorage<any>('playground:pre-flight:selected', null);

  // Helper to check if a script is valid
  const isValidScript = (script: any) => script && typeof script === 'object' && typeof script.id === 'string' && !!script.id && typeof script.content === 'string' && !!script.content;

  // Compute which options should be disabled based on available values
  const optionsWithDisabledState = useMemo(() => {
    return SHARE_OPTIONS.map(option => {
      let isDisabled = option.isDisabled;
      
      if (!isDisabled) {
        switch (option.id) {
          case OPTION_TYPES.OPERATION:
            break;
            
          case OPTION_TYPES.VARIABLES:
            isDisabled = !currentActiveTab.variables;
            break;

          case OPTION_TYPES.HEADERS:
            isDisabled = !currentActiveTab.headers;
            break;

          case OPTION_TYPES.PRE_FLIGHT: {
            isDisabled = !isValidScript(preFlightScript);
            break;
          }

          case OPTION_TYPES.PRE_OPERATION: {
            const script = currentActiveTab.id ? scriptsTabState[currentActiveTab.id]?.['pre-operation'] : null;
            isDisabled = !currentActiveTab.id || !isValidScript(script);
            break;
          }

          case OPTION_TYPES.POST_OPERATION: {
            const script = currentActiveTab.id ? scriptsTabState[currentActiveTab.id]?.['post-operation'] : null;
            isDisabled = !currentActiveTab.id || !isValidScript(script);
            break;
          }

          default:
            break;
        }
      }

      return {
        ...option,
        isDisabled,
      };
    });
  }, [currentActiveTab, scriptsTabState, preFlightScript]);

  // Reset state when modal is opened
  useEffect(() => {
    if (!isOpen) return;

    setSelectedOptions(DEFAULT_SELECTED_OPTIONS);
    generateShareableUrl(DEFAULT_SELECTED_OPTIONS);
  }, [isOpen]);

  const generateShareableUrl = useCallback((options: Record<ShareOptionId, boolean>) => {
    try {
      const stateToShare: PlaygroundUrlState = buildStateToShare(options, currentActiveTab);

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
  }, [toast, currentActiveTab]);

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
    setSelectedOptions(prev => {
      const updatedOptions = { ...prev, [id]: !!checked };

      // generate a new shareable URL on every change
      generateShareableUrl(updatedOptions);

      return updatedOptions;
    });
  }, [generateShareableUrl]);

  return {
    options: optionsWithDisabledState,
    selectedOptions,
    shareableUrl,
    warning,
    handleCopyLink,
    handleOptionChange,
  };
}