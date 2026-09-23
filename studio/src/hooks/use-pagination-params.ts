import { clamp } from '@/lib/utils';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';

export const DEFAULT_PAGE_SIZE = 10;

export const pageParam = parseAsInteger.withDefault(1);

export const usePaginationParams = ({ defaultPageSize = DEFAULT_PAGE_SIZE }: { defaultPageSize?: number } = {}) => {
  const [{ page, pageSize: rawPageSize, search }] = useQueryStates({
    page: pageParam,
    pageSize: parseAsInteger.withDefault(defaultPageSize),
    search: parseAsString.withDefault(''),
  });

  const pageNumber = Math.max(page, 1);
  const pageSize = clamp(rawPageSize, 10, 50);
  const offset = (pageNumber - 1) * pageSize;

  return {
    pageNumber,
    pageSize,
    offset,
    search,
  } as const;
};
