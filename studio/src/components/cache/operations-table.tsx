import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";
import { CacheWarmerOperation } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow, isValid } from "date-fns";
import { useRouter } from "next/router";
import { Button } from "../ui/button";
import { Pagination } from "../ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "../ui/table";
import Link from "next/link";
import { useContext, useState } from "react";
import { GraphContext } from "../layout/graph-layout";
import { useUser } from "@/hooks/use-user";
import { nanoTimestampToTime } from "@/components/analytics/charts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { useToast } from "../ui/use-toast";
import { useMutation } from "@connectrpc/connect-query";
import { deleteCacheWarmerOperation } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";

export const CacheOperationsTable = ({
  operations,
  totalCount,
  refetch,
}: {
  operations: CacheWarmerOperation[];
  totalCount: number;
  refetch: () => void;
}) => {
  const router = useRouter();
  const user = useUser();
  const checkUserAccess = useCheckUserAccess();
  const { toast } = useToast();
  const graphData = useContext(GraphContext);
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [operationId, setOperationId] = useState<string | undefined>();
  const { mutate, isPending } = useMutation(deleteCacheWarmerOperation);

  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;
  const limit = Number.parseInt((router.query.pageSize as string) || "10");
  const noOfPages = Math.ceil(totalCount / limit);

  return (
    <>
      {operationId &&
        checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] }) && (
          <Dialog open={openDeleteDialog} onOpenChange={setOpenDeleteDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Cache Operation</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-y-2">
                <span className="text-sm">
                  Are you sure you want to delete this cache operation?
                </span>
              </div>
              <div className="mt-2 flex justify-end gap-x-4">
                <Button
                  variant="outline"
                  onClick={() => setOpenDeleteDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  isLoading={isPending}
                  onClick={() => {
                    mutate(
                      {
                        id: operationId,
                        federatedGraphName: graphData?.graph?.name,
                        namespace: graphData?.graph?.namespace,
                      },
                      {
                        onSuccess: (d) => {
                          toast({
                            description:
                              d.response?.details ||
                              "Cache operation deleted successfully.",
                            duration: 2000,
                          });
                          refetch();
                        },
                        onError: (error) => {
                          toast({
                            description:
                              "Could not delete an cache operation. Please try again.",
                            duration: 2000,
                          });
                        },
                      },
                    );
                    setOpenDeleteDialog(false);
                  }}
                >
                  Delete
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      <TableWrapper className="mb-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Name</TableHead>
              <TableHead className="px-4">Created At</TableHead>
              <TableHead className="px-4">Actor</TableHead>
              <TableHead className="text-center">Is Persisted</TableHead>
              <TableHead className="text-center">Is Manually Added</TableHead>
              <TableHead className="px-4">Planning Time P90</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {operations.length ? (
              operations.map(
                ({
                  id,
                  operationName,
                  operationPersistedId,
                  createdAt,
                  createdBy,
                  planningTime,
                  isManuallyAdded,
                }) => (
                  <TableRow
                    key={id}
                    className=" group cursor-pointer py-1 hover:bg-secondary/30"
                  >
                    <TableCell className="px-5">
                      {operationName || "-"}
                    </TableCell>
                    <TableCell className="px-5">
                      {formatDistanceToNow(new Date(createdAt), {
                        addSuffix: true,
                      })}
                    </TableCell>
                    <TableCell className="px-5">{createdBy || "-"}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center">
                        {operationPersistedId ? (
                          <CheckCircledIcon className="h-5 w-5" />
                        ) : (
                          <CrossCircledIcon className="h-5 w-5" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center">
                        {isManuallyAdded ? (
                          <CheckCircledIcon className="h-5 w-5" />
                        ) : (
                          <CrossCircledIcon className="h-5 w-5" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-5">
                      {planningTime
                        ? nanoTimestampToTime(planningTime * 1000000)
                        : "-"}
                    </TableCell>
                    <TableCell className="flex items-center justify-end gap-x-4 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="table-action"
                      >
                        <Link
                          href={{
                            pathname: `/${user?.currentOrganization.slug}/${graphData?.graph?.namespace}/graph/${graphData?.graph?.name}/cache-operations`,
                            query: {
                              ...router.query,
                              operationId: id,
                            },
                          }}
                        >
                          Details
                        </Link>
                      </Button>
                      <DropdownMenu>
                        <div className="flex justify-center">
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <EllipsisVerticalIcon className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                        </div>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setOperationId(id);
                              setOpenDeleteDialog(true);
                            }}
                            disabled={
                              !checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] }) ||
                              !isManuallyAdded
                            }
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ),
              )
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-20 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableWrapper>
      <Pagination limit={limit} noOfPages={noOfPages} pageNumber={pageNumber} />
    </>
  );
};
