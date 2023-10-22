import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export const CompositionErrorsDialog = ({ errors }: { errors: string }) => {
  return (
    <Dialog>
      <DialogTrigger>
        <Button className="w-full" variant={"destructive"} size={"sm"}>
          Details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Composition Errors</DialogTitle>
        </DialogHeader>
        <div className="scrollbar-custom overflow-auto">
          <div>
            <p className="pb-2 text-sm">
              This version of the graph is not ready because the composition
              failed. The router will continue to serve the latest valid version
              of the graph. Please fix the following errors:
            </p>
          </div>
          <div className="mt-6 space-y-2">
            <pre className="scrollbar-custom overflow-auto rounded-md bg-secondary p-4 text-sm text-secondary-foreground">
              {errors}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
