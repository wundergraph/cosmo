import { PlaygroundContext } from '@/components/playground/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { buildCurlCommand } from '@/lib/playground-curl';
import { CopyIcon } from '@radix-ui/react-icons';
import { TooltipContent, TooltipTrigger } from '@radix-ui/react-tooltip';
import { useCallback, useContext, useMemo } from 'react';

export const CopyOperation = () => {
  const { toast } = useToast();
  const { tabsState, routingUrl, featureFlagName, graphId } = useContext(PlaygroundContext);

  const activeTab = useMemo(() => tabsState.tabs[tabsState.activeTabIndex], [tabsState]);
  const query = activeTab?.query ?? '';

  const copyToClipboard = useCallback(
    async (value: string, description: string) => {
      try {
        await navigator.clipboard.writeText(value);
        toast({ description, duration: 3000 });
      } catch (error) {
        toast({
          variant: 'destructive',
          title: "Couldn't copy to clipboard",
          description: 'Please try again in a few seconds',
        });
        if (process.env.NODE_ENV === 'development') {
          console.error(error);
        }
      }
    },
    [toast],
  );

  const copyQuery = useCallback(() => {
    if (!query) {
      toast({ description: 'There is no operation to copy', duration: 3000 });
      return;
    }

    copyToClipboard(query, 'Query copied to clipboard');
  }, [copyToClipboard, query, toast]);

  const copyCurl = useCallback(() => {
    if (!query) {
      toast({ description: 'There is no operation to copy', duration: 3000 });
      return;
    }

    if (!routingUrl) {
      toast({
        variant: 'destructive',
        title: "Couldn't build the cURL request",
        description: 'No routing url is available for the selected graph',
      });
      return;
    }

    const { command, warnings } = buildCurlCommand({
      url: routingUrl,
      query,
      variables: activeTab?.variables,
      headers: activeTab?.headers,
      operationName: activeTab?.operationName,
      graphId,
      // the feature flag is picked in the playground toolbar, so it has to be sent explicitly
      extraHeaders: featureFlagName ? { 'X-Feature-Flag': featureFlagName } : undefined,
    });

    copyToClipboard(command, 'cURL request copied to clipboard');

    warnings.forEach((warning) => {
      toast({ variant: 'destructive', title: 'Heads up!', description: warning, duration: 5000 });
    });
  }, [activeTab, copyToClipboard, featureFlagName, graphId, query, routingUrl, toast]);

  return (
    <DropdownMenu>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="graphiql-toolbar-button">
              <CopyIcon className="graphiql-toolbar-icon" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent className="rounded-md border bg-background px-2 py-1">Copy</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={copyQuery}>Copy query</DropdownMenuItem>
        <DropdownMenuItem onSelect={copyCurl}>Copy cURL request</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
