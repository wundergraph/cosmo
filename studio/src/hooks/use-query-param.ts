import { useRouter } from 'next/router';

export function useQueryParam(name: string): string | undefined;
export function useQueryParam(name: string, defaultValue: string): string;
export function useQueryParam(name: string, defaultValue?: string): string | undefined {
  const { query } = useRouter();
  const value = query[name];
  return (Array.isArray(value) ? value[0] : value) || defaultValue;
}

/**
 * A dynamic route segment, which Next always populates on a route that declares it. Callers must
 * only pass a segment their own route declares.
 */
export const useRouteParam = (name: string): string => useQueryParam(name, '');
