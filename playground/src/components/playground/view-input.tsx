import { cn } from '@/lib/utils';
import { CodeViewer } from '../code-viewer';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

export const ViewInput = ({ rawInput, input, asChild }: { rawInput?: any; input?: any; asChild?: boolean }) => {
  const getDefaultValue = () => {
    if (input && input?.body?.query) {
      return 'query';
    }
    if (rawInput) {
      return 'rawInput';
    }
    return 'input';
  };

  return (
    <Dialog>
      <DialogTrigger asChild={asChild} className={cn(!asChild && 'text-primary')}>
        {asChild ? (
          <Button variant="secondary" size="sm" className="flex-1">
            <span className="flex-shrink-0">View Input</span>
          </Button>
        ) : (
          'View Input'
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Input</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue={getDefaultValue()} className="w-full">
          <TabsList className="w-full">
            {input && input.body?.query && (
              <TabsTrigger className="flex-1" value="query">
                Query
              </TabsTrigger>
            )}
            {rawInput && (
              <TabsTrigger className="flex-1" value="rawInput">
                Raw Input
              </TabsTrigger>
            )}
            {input && (
              <TabsTrigger className="flex-1" value="input">
                Input
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="query">
            <div className="scrollbar-custom h-96 max-w-[calc(42rem_-_3rem)] overflow-auto rounded border">
              <CodeViewer code={input?.body?.query ?? ''} language="graphql" />
            </div>
          </TabsContent>
          <TabsContent value="rawInput">
            <div className="scrollbar-custom h-96 max-w-[calc(42rem_-_3rem)] overflow-auto rounded border">
              <CodeViewer code={JSON.stringify(rawInput)} language="json" />
            </div>
          </TabsContent>
          <TabsContent value="input">
            <div className="scrollbar-custom h-96 max-w-[calc(42rem_-_3rem)] overflow-auto rounded border">
              <CodeViewer code={JSON.stringify(input)} language="json" />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
