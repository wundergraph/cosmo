import { identifyKoala, resetKoala } from "@/lib/koala";
import { Transport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { useRouter } from "next/router";
import { ReactNode, createContext, useEffect, useState } from "react";
import { useCookies } from "react-cookie";

export const UserContext = createContext<User | undefined>(undefined);

const queryClient = new QueryClient();

const publicPaths = ["/login", "/signup"];

export interface User {
  id: string;
  email: string;
  currentOrganization: Organization;
  organizations: Organization[];
  invitations: InvitedOrgs[];
}

export interface InvitedOrgs {
  id: string;
  name: string;
  slug: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan?: string;
  creatorUserId: string;
  roles: string[];
  createdAt: string;
  features: {
    id: string;
    enabled?: boolean;
    limit?: number;
  }[];
  billing: {
    plan: string;
    email?: string;
  };
  subscription?: {
    status:
      | "active"
      | "canceled"
      | "trialing"
      | "incomplete"
      | "incomplete_expired"
      | "past_due";
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    trialEnd: string;
  };
}

export interface Session {
  id: string;
  email: string;
  organizations: Organization[];
  invitations: InvitedOrgs[];
}

export class UnauthorizedError extends Error {
  constructor() {
    super();
    this.name = "UnauthorizedError";
  }
}

const fetchSession = async () => {
  try {
    const response = await fetch(
      process.env.NEXT_PUBLIC_COSMO_CP_URL + "/v1/auth/session",
      {
        method: "GET",
        mode: "cors",
        credentials: "include",
      },
    );
    if (response.status === 200) {
      const body = await response.json();
      return body;
    } else if (response.status === 401) {
      throw new UnauthorizedError();
    }
    return null;
  } catch (e) {
    // Reset koala if user is not authenticated
    resetKoala();
    throw e;
  }
};

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const router = useRouter();
  const currentOrgSlug = router.query.organizationSlug;

  // we store the current org slug in a cookie, so that we can redirect to the correct org after login
  // as well as being able to access the cookie on the server.
  const [cookies, setCookie] = useCookies(["cosmo_org"]);

  useEffect(() => {
    if (!router.isReady) return;
    if (
      currentOrgSlug &&
      currentOrgSlug !== "undefined" &&
      currentOrgSlug !== cookies.cosmo_org
    ) {
      setCookie("cosmo_org", currentOrgSlug, {
        path: "/",
        maxAge: 3600 * 24 * 365, // 1 year
        sameSite: "lax",
      });
    }
  }, [currentOrgSlug, router, cookies.cosmo_org, setCookie]);

  const { data, error, isFetching } = useQuery<
    Session | null,
    UnauthorizedError | Error
  >(
    {
      queryKey: ["user", router.asPath],
      queryFn: () => fetchSession(),
      retry(failureCount, error) {
        if (error instanceof UnauthorizedError) return false;
        return failureCount < 3;
      },
    },
    queryClient,
  );

  const [user, setUser] = useState<User>();
  const [transport, setTransport] = useState<Transport>();

  useEffect(() => {
    if (isFetching || !router.isReady) return;
    if (
      error &&
      error instanceof UnauthorizedError &&
      !publicPaths.includes(router.pathname)
    ) {
      const redirectURL = `${process.env.NEXT_PUBLIC_COSMO_STUDIO_URL}${router.asPath}`;
      router.replace(`/login?redirectURL=${redirectURL}`);
    } else if (data && !error) {
      const currentOrg = data.organizations.find(
        (org) => org.slug === cookies.cosmo_org,
      );

      const organization = currentOrg || data.organizations[0];

      setUser({
        id: data.id,
        email: data.email,
        currentOrganization: {
          ...organization,
        },
        organizations: data.organizations,
        invitations: data.invitations,
      });

      // Identify call for koala script
      identifyKoala({
        id: data.id,
        email: data.email,
        organizationId: organization.id,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        plan: organization.plan,
      });

      const organizationSlug = organization.slug;

      setTransport(
        createConnectTransport({
          baseUrl: process.env.NEXT_PUBLIC_COSMO_CP_URL!,
          useHttpGet: true,
          interceptors: [
            (next) => async (req) => {
              req.header.set("cosmo-org-slug", organizationSlug);
              return await next(req);
            },
          ],
          // Allow cookies to be sent to the server
          credentials: "include",
        }),
      );

      if (
        (router.pathname === "/" ||
          router.pathname === "/login" ||
          !currentOrg) &&
        router.pathname !== "/account/invitations"
      ) {
        const url = new URL(
          window.location.origin + router.basePath + router.asPath,
        );
        const params = new URLSearchParams(url.search);
        router.replace(
          params.size !== 0
            ? `/${organizationSlug}?${params}`
            : `/${organizationSlug}`,
        );
      }
    }
  }, [router, data, isFetching, error, cookies.cosmo_org]);

  if (!transport) {
    return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
  }

  return (
    <TransportProvider transport={transport}>
      <QueryClientProvider client={queryClient}>
        <UserContext.Provider value={user}>{children}</UserContext.Provider>
      </QueryClientProvider>
    </TransportProvider>
  );
};
