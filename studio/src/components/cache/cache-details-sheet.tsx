import { PlayIcon } from "@radix-ui/react-icons";
import { useHotkeys } from "@saas-ui/use-hotkeys";
import { CacheWarmerOperation } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import Link from "next/link";
import { useRouter } from "next/router";
import { FiChevronDown, FiChevronUp } from "react-icons/fi";
import { CodeViewer } from "../code-viewer";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import { Kbd } from "../ui/kbd";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { Spacer } from "../ui/spacer";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export const CacheDetailsSheet: React.FC<any> = ({
  operations,
}: {
  operations: CacheWarmerOperation[];
}) => {
  const router = useRouter();

  const operationId = router.query.operationId as string;

  const index = operations.findIndex(
    (r: CacheWarmerOperation) => r.id === operationId,
  );

  const nextTrace = () => {
    if (index + 1 < operations.length) {
      const newQuery = { ...router.query };
      newQuery["operationId"] = operations[index + 1].id;
      router.replace({
        query: newQuery,
      });
    }
  };

  const previousTrace = () => {
    if (index - 1 >= 0) {
      const newQuery = { ...router.query };
      newQuery["operationId"] = operations[index - 1].id;
      router.replace({
        query: newQuery,
      });
    }
  };

  useHotkeys(
    "K",
    () => {
      previousTrace();
    },
    {},
    [operationId],
  );

  useHotkeys(
    "J",
    () => {
      nextTrace();
    },
    {},
    [operationId],
  );

  return (
    <Sheet
      modal={false}
      open={!!operationId}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          const newQuery = { ...router.query };
          delete newQuery["operationId"];
          router.replace({
            query: newQuery,
          });
        }
      }}
    >
      <SheetContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        hideOverlay
        className="scrollbar-custom w-full max-w-full overflow-y-scroll shadow-xl sm:max-w-full lg:max-w-3xl xl:max-w-6xl"
      >
        <SheetHeader className="mb-12 flex flex-row items-center space-x-2 space-y-0">
          <div className="space-x-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => previousTrace()}
                  disabled={index === 0}
                >
                  <FiChevronUp />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Previous Trace • <Kbd>K</Kbd>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => nextTrace()}
                  disabled={index === operations.length - 1}
                >
                  <FiChevronDown />
                </Button>
              </TooltipTrigger>

              <TooltipContent>
                Next Trace • <Kbd>J</Kbd>
              </TooltipContent>
            </Tooltip>
          </div>

          <SheetTitle className="m-0 flex flex-wrap items-center gap-x-1.5 text-sm">
            <code className="break-all px-1.5 text-left text-sm text-secondary-foreground">
              {operationId}
            </code>
            <CopyButton
              tooltip="Copy cache warmer operation id"
              value={operationId || ""}
            />
          </SheetTitle>

          <Spacer />
        </SheetHeader>
        {operationId && <CacheOperationDetails operation={operations[index]} />}
      </SheetContent>
    </Sheet>
  );
};

export const CacheOperationDetails = ({
  operation,
}: {
  operation: CacheWarmerOperation;
}) => {
  const { query } = useRouter();
  const organizationSlug = query.organizationSlug as string;
  const namespace = query.namespace as string;
  const slug = query.slug as string;
  const {
    operationContent,
    clientName,
    clientVersion,
    operationHash,
    operationName,
    operationPersistedId,
  } = operation;

  return (
    <div>
      <div className=" rounded-md border p-3 text-sm">
        <table className="table-auto">
          <tbody>
            <tr>
              <td className="pr-6">Operation Name</td>
              <td>
                <div className="flex items-center gap-x-3">
                  <span>:</span>
                  <span>{operationName || "-"}</span>
                </div>
              </td>
            </tr>
            <tr>
              <td className="pr-6">Operation Hash</td>
              <td>
                <div className="flex items-center gap-x-3">
                  <span>:</span>
                  <div className="flex flex-wrap gap-x-3">
                    {operationHash || "-"}
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td className="pr-6">Operation Persisted Id</td>
              <td>
                <div className="flex items-center gap-x-3">
                  <span>:</span>
                  <div className="flex flex-wrap gap-x-3">
                    {operationPersistedId || "-"}
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td className="pr-6">Client Name</td>
              <td>
                <div className="flex items-center gap-x-3">
                  <span>:</span>
                  <div className="flex flex-wrap gap-x-3">
                    {clientName || "-"}
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td className="pr-6">Client Version</td>
              <td>
                <div className="flex items-center gap-x-3">
                  <span>:</span>
                  <div className="flex flex-wrap gap-x-3">
                    {clientVersion || "-"}
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {operationContent && (
        <>
          <div className="mb-3 mt-4">
            <div className="mb-1">Operation Content</div>
          </div>
          <div className="flex justify-between rounded border">
            <CodeViewer
              code={operationContent}
              language="graphql"
              disableLinking
              className="scrollbar-custom w-3/6 overflow-auto"
            />

            <div className="px-2 py-2">
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" asChild>
                    <Link
                      href={`/${organizationSlug}/${namespace}/graph/${slug}/playground?operation=${encodeURIComponent(
                        operationContent || "",
                      )}}`}
                    >
                      <PlayIcon className="h-5" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Run in playground</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
