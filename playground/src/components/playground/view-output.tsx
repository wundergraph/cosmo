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

export const ViewOutput = ({
  output,
  asChild,
}: {
  output: any;
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
            <span className="flex-shrink-0">View Output</span>
          </Button>
        ) : (
          "View Output"
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Output</DialogTitle>
        </DialogHeader>

        <div className="scrollbar-custom h-96 overflow-auto rounded border">
          <CodeViewer code={JSON.stringify(output)} language="json" />
        </div>
      </DialogContent>
    </Dialog>
  );
};
