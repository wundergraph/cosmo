import { CodeViewer } from "@/components/code-viewer";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader } from "@/components/ui/loader";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@connectrpc/connect-query";
import { getOperationContent } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import graphQLPlugin from "prettier/plugins/graphql";
import * as prettier from "prettier/standalone";
import { useEffect, useState } from "react";
import { PiBracketsCurly } from "react-icons/pi";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

const OperationContent = ({
  hash,
  enabled,
  federatedGraphName,
  namespace,
}: {
  hash: string;
  enabled: boolean;
  federatedGraphName: string;
  namespace: string;
}) => {
  const [content, setContent] = useState("");

  const { data, error, isLoading, refetch } = useQuery(
    getOperationContent,
    {
      hash,
      federatedGraphName,
      namespace,
    },
    {
      enabled: enabled && !!federatedGraphName && !!namespace,
    },
  );

  useEffect(() => {
    const set = async (source: string) => {
      const res = await prettier.format(source, {
        parser: "graphql",
        plugins: [graphQLPlugin],
      });
      setContent(res);
    };

    if (!data) return;
    set(data.operationContent);
  }, [data]);

  if (!federatedGraphName || !namespace) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve content"
        description="Please try again"
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="h-96">
        <Loader fullscreen />
      </div>
    );
  }

  if (error)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve content"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  return (
    <div className="scrollbar-custom h-[50vh] overflow-auto rounded border">
      <CodeViewer code={content} disableLinking />
    </div>
  );
};

export const OperationContentDialog = ({
  hash,
  trigger,
  federatedGraphName,
  namespace,
}: {
  hash: string;
  trigger?: React.ReactNode;
  federatedGraphName: string;
  namespace: string;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(val) => setOpen(val)}>
      <Tooltip delayDuration={100}>
        <DialogTrigger asChild>
          <TooltipTrigger asChild>
            {trigger || (
              <Button size="icon-sm" variant="secondary">
                <PiBracketsCurly />
              </Button>
            )}
          </TooltipTrigger>
        </DialogTrigger>
        <TooltipContent>View operation content</TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Operation Content</DialogTitle>
        </DialogHeader>
        <OperationContent
          hash={hash}
          enabled={open}
          federatedGraphName={federatedGraphName}
          namespace={namespace}
        />
      </DialogContent>
    </Dialog>
  );
};
