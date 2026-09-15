import { useQueryParam } from '@/hooks/use-query-param';
import { clamp } from '@/lib/utils';

export const usePaginationParams = ({ defaultPageSize = 10 }: { defaultPageSize?: number } = {}) => {
  const pageNumber = clamp(Number.parseInt(useQueryParam('page', '1')), 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clamp(Number.parseInt(useQueryParam('pageSize', String(defaultPageSize))), 10, 50);
  const offset = (pageNumber - 1) * pageSize;
  const search = useQueryParam('search', '');

  return {
    pageNumber,
    pageSize,
    offset,
    search,
  } as const;
};
