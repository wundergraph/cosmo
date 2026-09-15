import { useQueryParam } from '@/hooks/use-query-param';
import { clamp } from '@/lib/utils';

export const usePaginationParams = () => {
  const pageNumber = Math.max(Number.parseInt(useQueryParam('page', '1')), 1);
  const pageSize = clamp(Number.parseInt(useQueryParam('pageSize', '20')), 10, 50);
  const offset = (pageNumber - 1) * pageSize;
  const search = useQueryParam('search', '');

  return {
    pageNumber,
    pageSize,
    offset,
    search,
  } as const;
};
