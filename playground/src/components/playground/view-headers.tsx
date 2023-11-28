import { cn } from "@/lib/utils";
import { CodeViewer } from "../code-viewer";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

export const ViewHeaders = ({
  requestHeaders,
  responseHeaders,
  asChild,
}: {
  requestHeaders: string;
  responseHeaders: string;
  asChild?: boolean;
}) => {
  return (
    <Dialog>
      <DialogTrigger
        asChild={asChild}
        className={cn(!asChild && "text-primary")}
      >
        {asChild ? (
          <Button variant="secondary" size="sm" className="flex-1">
            <span className="flex-shrink-0">View Headers</span>
          </Button>
        ) : (
          "View Headers"
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Headers</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="request" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="request">Request</TabsTrigger>
            <TabsTrigger value="response">Response</TabsTrigger>
          </TabsList>
          <TabsContent value="request">
            <div className="scrollbar-custom h-96 overflow-auto rounded border">
              <CodeViewer code={requestHeaders} language="json" />
            </div>
          </TabsContent>
          <TabsContent value="response">
            <div className="scrollbar-custom h-96 overflow-auto rounded border">
              <CodeViewer code={responseHeaders} language="json" />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
