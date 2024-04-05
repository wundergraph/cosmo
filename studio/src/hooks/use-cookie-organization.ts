import { useCookies } from "react-cookie";
import { useMemo } from "react";

const orgCookieName = "cosmo_org";

export const useCookieOrganization = (): [string, (slug: string) => void] => {
  const [cookies, setCookie] = useCookies([orgCookieName]);
  const setOrgSlug = useMemo(() => {
    return (slug: string) => {
      setCookie(orgCookieName, slug, {
        path: "/",
        maxAge: 3600 * 24 * 365, // 1 year
        sameSite: "lax",
      });
    };
  }, [setCookie]);

  // if the slug is a number, we need to stringify it otherwise the comparison will fail
  return [cookies.cosmo_org?.toString(), setOrgSlug];
};
