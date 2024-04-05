import { useCookies } from "react-cookie";
import { useMemo } from "react";

export const useCookieOrganization = () => {
  const [cookies, setCookie] = useCookies(["cosmo_org"]);
  const setOrgSlug = useMemo(() => {
    return (slug: string) => {
      setCookie("cosmo_org", slug, {
        path: "/",
        maxAge: 3600 * 24 * 365, // 1 year
        sameSite: "lax",
      });
    };
  }, [setCookie]);

  // if the slug is a number, we need to stringify it otherwise the comparison will fail
  return [cookies.cosmo_org?.toString(), setOrgSlug];
};
