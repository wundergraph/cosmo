import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";
import { CacheWarmerOperation } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow } from "date-fns";
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

export const CacheOperationsTable = ({
  operations,
  totalCount,
}: {
  operations: CacheWarmerOperation[];
  totalCount: number;
}) => {
  const router = useRouter();

  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;
  const limit = Number.parseInt((router.query.pageSize as string) || "10");
  const noOfPages = Math.ceil(totalCount / limit);

  return (
    <>
      <TableWrapper className="mb-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Name</TableHead>
              <TableHead className="px-4">Created At</TableHead>
              <TableHead className="px-4">Added By</TableHead>
              <TableHead className="text-center">Is Persisted</TableHead>
              <TableHead className="text-center">Is Manually Added</TableHead>
              <TableHead className="px-4">Planning Time (in secs)</TableHead>
              <TableHead className="text-center">Details</TableHead>
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
                      {planningTime || "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="table-action"
                      >
                        <Link
                          href={`/${router.query.organizationSlug}/${router.query.namespace}/graph/${router.query.slug}/cache-operations?operationId=${id}`}
                        >
                          Details
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ),
              )
            ) : (
              <TableRow>
                <TableCell className="h-24 text-center">No results.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableWrapper>
      <Pagination limit={limit} noOfPages={noOfPages} pageNumber={pageNumber} />
    </>
  );
};
