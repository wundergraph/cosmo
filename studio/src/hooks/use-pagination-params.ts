import { clamp } from '@/lib/utils';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';

export const usePaginationParams = ({ defaultPageSize = 10 }: { defaultPageSize?: number } = {}) => {
  const [{ page, pageSize: rawPageSize, search }] = useQueryStates({
    page: parseAsInteger.withDefault(1),
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
