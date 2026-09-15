import { useRouter } from 'next/router';

export function useQueryParam(name: string): string | undefined;
export function useQueryParam(name: string, defaultValue: string): string;
export function useQueryParam(name: string, defaultValue?: string): string | undefined {
  const { query } = useRouter();
  const value = query[name];
  return (Array.isArray(value) ? value[0] : value) || defaultValue;
}
