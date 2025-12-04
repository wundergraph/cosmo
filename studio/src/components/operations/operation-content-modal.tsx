import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader } from "@/components/ui/loader";
import { useQuery } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getOperationContent } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useContext } from "react";
import { GraphContext } from "@/components/layout/graph-layout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { CodeViewer } from "@/components/code-viewer";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PlayIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCurrentOrganization } from "@/hooks/use-current-organization";
import { useWorkspace } from "@/hooks/use-workspace";
import { CopyButton } from "@/components/ui/copy-button";

interface OperationContentModalProps {
  operationHash: string;
  operationName?: string;
  isOpen: boolean;
  onClose: () => void;
}

export const OperationContentModal = ({
  operationHash,
  operationName,
  isOpen,
  onClose,
}: OperationContentModalProps) => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();
  const {
    namespace: { name: namespace },
  } = useWorkspace();
  const organizationSlug = useCurrentOrganization()?.slug;
  const slug = router.query.slug as string;

  const { data, isLoading, error, refetch } = useQuery(
    getOperationContent,
    {
      namespace: graphContext?.graph?.namespace,
      federatedGraphName: graphContext?.graph?.name,
      hash: operationHash,
      name: operationName,
    },
    {
      enabled: isOpen && !!operationHash && !!graphContext?.graph?.name,
    },
  );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[80vh] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Operation Content</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader />
            </div>
          ) : error || data?.response?.code !== EnumStatusCode.OK ? (
            <EmptyState
              icon={<ExclamationTriangleIcon />}
              title="Could not retrieve operation content"
              description={
                data?.response?.details || error?.message || "Please try again"
              }
              actions={<Button onClick={() => refetch()}>Retry</Button>}
            />
          ) : (
            <div className="scrollbar-custom relative overflow-auto rounded-lg border">
              <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
                <Tooltip delayDuration={100}>
                  <TooltipTrigger asChild>
                    <Button variant="secondary" size="icon-sm" asChild>
                      <Link
                        href={`/${organizationSlug}/${namespace}/graph/${slug}/playground?operation=${encodeURIComponent(
                          data?.operationContent || "",
                        )}`}
                      >
                        <PlayIcon />
                      </Link>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Run in Playground</TooltipContent>
                </Tooltip>
                <CopyButton
                  value={data?.operationContent || ""}
                  tooltip="Copy operation"
                  variant="secondary"
                  size="icon-sm"
                />
              </div>
              <CodeViewer
                code={data?.operationContent || "No content available"}
                language="graphql"
                disableLinking
                className="max-h-[60vh]"
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
