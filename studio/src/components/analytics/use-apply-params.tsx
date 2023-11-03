import { useRouter } from "next/router";
import { useCallback } from "react";

export const useApplyParams = () => {
  const router = useRouter();
  return useCallback(
    (newParams: Record<string, string | null>, unset?: string[]) => {
      const q = Object.fromEntries(
        Object.entries(router.query).filter(
          ([key]) => !unset?.includes(key) && newParams[key] !== null
        )
      );
      const params = Object.fromEntries(
        Object.entries(newParams).filter(([_, value]) => value !== null)
      );
      router.push({
        query: {
          ...q,
          ...params,
        },
      });
    },
    [router]
  );
};
