import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FiShare2 } from "react-icons/fi";
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { Tooltip } from "@/components/ui/tooltip";
import { TooltipContent, TooltipTrigger } from "@radix-ui/react-tooltip";
import { CopyIcon } from '@radix-ui/react-icons';
import { useState } from 'react';

const MAX_URL_LENGTH = 2000;

const SHARE_OPTIONS = [
  // operation is always checked and disabled
  { id: 'operation', label: 'Operation', isChecked: true, isDisabled: true },
  { id: 'variables', label: 'Variables', isChecked: false, isDisabled: false },
  { id: 'headers', label: 'Headers', isChecked: false, isDisabled: false },
  { id: 'preFlight', label: 'Pre-Flight Script', isChecked: false, isDisabled: false },
  { id: 'preOperation', label: 'Pre-request Script', isChecked: false, isDisabled: false },
  { id: 'postOperation', label: 'Post-request Script', isChecked: false, isDisabled: false },
] as const;

type ShareOptionId = typeof SHARE_OPTIONS[number]['id'];

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
  const [shareableUrl, setShareableUrl] = useState('');

  // Reset state when modal is opened
  useEffect(() => {
    if (!isOpen) return;

    setSelectedOptions(DEFAULT_SELECTED_OPTIONS);
    setShareableUrl('');
  }, [isOpen]);

  const handleCopyLink = () => {
    toast({
        description: 'Playground state URL copied to clipboard',
    });
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
                <label htmlFor={id}>{label}</label>
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
          <p className="text-xs text-amber-500 mt-1">
            Warning: URL is very long and might not work in all browsers.
          </p>
        )}
        {/* if url exists, consider showing the url here */}
        {/* consider showing warning here
        1. when the url is too long
        2. when the url is stale due to changes in checkbox state */}
      </DialogContent>
    </Dialog>
  );
}; 