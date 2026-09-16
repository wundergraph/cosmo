import { ChevronLeftIcon, ChevronRightIcon, DoubleArrowLeftIcon, DoubleArrowRightIcon } from '@radix-ui/react-icons';
import { parseAsInteger, useQueryStates } from 'nuqs';
import { pageParam } from '@/hooks/use-pagination-params';
import { Button } from './button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

export const Pagination = ({
  limit,
  noOfPages,
  pageNumber,
  options,
  defaultPageSize = 10,
}: {
  limit: number;
  noOfPages: number;
  pageNumber: number;
  options?: number[];
  /** Must match the caller's `usePaginationParams`, so a size equal to it clears the param. */
  defaultPageSize?: number;
}) => {
  const [, setPagination] = useQueryStates(
    { page: pageParam, pageSize: parseAsInteger.withDefault(defaultPageSize) },
    { history: 'push', scroll: true },
  );

  const pageSizeOptions = options ?? [10, 20, 30, 40, 50];

  return (
    <div className="flex justify-end space-x-3">
      <div className="flex items-center space-x-2">
        <p className="text-sm font-medium">Rows per page</p>
        <Select
          value={`${limit}`}
          onValueChange={(value) => {
            // Reset page when size changes because the number of pages may not be the same
            setPagination({ pageSize: Number(value), page: 1 });
          }}
        >
          <SelectTrigger className="h-8 w-[70px]">
            <SelectValue placeholder={`${limit}`} />
          </SelectTrigger>
          <SelectContent side="top">
            {pageSizeOptions.map((pageSize) => (
              <SelectItem key={pageSize} value={`${pageSize}`}>
                {pageSize}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-center text-sm font-medium">
        Page {noOfPages === 0 ? '0' : pageNumber} of {noOfPages}
      </div>
      <div className="flex items-center space-x-2">
        <Button
          variant="outline"
          className="hidden h-8 w-8 p-0 lg:flex"
          onClick={() => {
            setPagination({ page: 1 });
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
            setPagination({ page: pageNumber - 1 });
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
            setPagination({ page: pageNumber + 1 });
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
            setPagination({ page: noOfPages });
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
