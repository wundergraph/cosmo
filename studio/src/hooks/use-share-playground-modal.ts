import { PlaygroundContext, ShareOptionId } from '@/components/playground/types';
import { useToast } from '@/components/ui/use-toast';
import { SHARE_OPTIONS } from '@/lib/constants';
import { buildStateToShare, createCompressedStateUrl } from '@/lib/playground-url-state-encoding';
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

const DEFAULT_SELECTED_OPTIONS = SHARE_OPTIONS.reduce((acc, { id, isChecked }) => {
    acc[id] = isChecked;
    return acc;
  }, {} as Record<ShareOptionId, boolean>);

export const useSharePlaygroundModal = (isOpen: boolean) => {
  const [selectedOptions, setSelectedOptions] = useState<Record<ShareOptionId, boolean>>(
    () => DEFAULT_SELECTED_OPTIONS    
  );
  const [lastOptionsSelected, setLastOptionsSelected] = useState<Record<ShareOptionId, boolean>>(
    () => DEFAULT_SELECTED_OPTIONS
  );
  const { toast } = useToast();
  const [shareableUrl, setShareableUrl] = useState("");
  const [warning, setWarning] = useState<{ title: string; description: string } | null>(null);

  // sharing state only for the active tab
  const { tabsState } = useContext(PlaygroundContext);
  const currentActiveTab = tabsState.tabs[tabsState.activeTabIndex] ?? {};

  // Reset state when modal is opened
  useEffect(() => {
    if (!isOpen) return;

    setSelectedOptions(DEFAULT_SELECTED_OPTIONS);
    setShareableUrl("");
  }, [isOpen]);

  const generateShareableUrl = useCallback(() => {
    try {
      const stateToShare: PlaygroundUrlState = buildStateToShare(selectedOptions, currentActiveTab);

      const newUrl = createCompressedStateUrl(stateToShare);
      setShareableUrl(newUrl);
      setLastOptionsSelected(selectedOptions);

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
  }, [buildStateToShare, toast, selectedOptions]);

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

      // Check if options have changed and shareableUrl exists
      if (shareableUrl) {
        // Check if any option has changed
        const hasOptionsChanged = Object.keys(updatedOptions).some(
          key => updatedOptions[key as ShareOptionId] !== lastOptionsSelected[key as ShareOptionId]
        );
      
        if (hasOptionsChanged) {
          setWarning({
            title: WARNING_MESSAGES.OPTIONS_CHANGED.title,
            description: WARNING_MESSAGES.OPTIONS_CHANGED.description,
          });
        } else {
          // If options are back to their original state, remove the warning
          setWarning(null);
        }
      }

      return updatedOptions;
    });
  }, [shareableUrl, lastOptionsSelected]);

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