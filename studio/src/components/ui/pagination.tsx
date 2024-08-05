import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
} from "@radix-ui/react-icons";
import { useRouter } from "next/router";
import { useCallback } from "react";
import { Button } from "./button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

export const Pagination = ({
  limit,
  noOfPages,
  pageNumber,
}: {
  limit: number;
  noOfPages: number;
  pageNumber: number;
}) => {
  const router = useRouter();
  const applyNewParams = useCallback(
    (newParams: Record<string, string>) => {
      router.push({
        query: {
          ...router.query,
          ...newParams,
        },
      });
    },
    [router],
  );

  return (
    <div className="flex justify-end">
      <div className="flex items-center space-x-2">
        <p className="text-sm font-medium">Rows per page</p>
        <Select
          value={`${limit}`}
          onValueChange={(value) => {
            // Reset page when size changes because the number of pages may not be the same
            applyNewParams({ pageSize: value, page: "1" });
          }}
        >
          <SelectTrigger className="h-8 w-[70px]">
            <SelectValue placeholder={`${limit}`} />
          </SelectTrigger>
          <SelectContent side="top">
            {[10, 20, 30, 40, 50].map((pageSize) => (
              <SelectItem key={pageSize} value={`${pageSize}`}>
                {pageSize}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex w-[100px] items-center justify-center text-sm font-medium">
        Page {noOfPages === 0 ? "0" : pageNumber} of {noOfPages}
      </div>
      <div className="flex items-center space-x-2">
        <Button
          variant="outline"
          className="hidden h-8 w-8 p-0 lg:flex"
          onClick={() => {
            applyNewParams({ page: "1" });
          }}
          disabled={pageNumber === 1}
        >
          <span className="sr-only">Go to first page</span>
          <DoubleArrowLeftIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          className="h-8 w-8 p-0"
          onClick={() => {
            applyNewParams({ page: (pageNumber - 1).toString() });
          }}
          disabled={pageNumber === 1}
        >
          <span className="sr-only">Go to previous page</span>
          <ChevronLeftIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          className="h-8 w-8 p-0"
          onClick={() => {
            applyNewParams({ page: (pageNumber + 1).toString() });
          }}
          disabled={pageNumber === noOfPages || noOfPages === 0}
        >
          <span className="sr-only">Go to next page</span>
          <ChevronRightIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          className="hidden h-8 w-8 p-0 lg:flex"
          onClick={() => {
            applyNewParams({ page: noOfPages.toString() });
          }}
          disabled={pageNumber === noOfPages || noOfPages === 0}
        >
          <span className="sr-only">Go to last page</span>
          <DoubleArrowRightIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
