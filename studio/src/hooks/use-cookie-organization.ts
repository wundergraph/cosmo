import { useMemo } from "react";
import useCookie from "@/hooks/use-cookie";

const orgCookieName = "cosmo_org";

export const useCookieOrganization = (): [
  string | null,
  (slug: string) => void,
  (slug: string) => void,
] => {
  const [value, update, remove] = useCookie(orgCookieName);
  const set = useMemo(() => {
    return (slug: string) => {
      update(slug, {
        path: "/",
        expires: 365, // 1 year
        sameSite: "lax",
      });
    };
  }, [update]);

  return [value, set, remove];
};
