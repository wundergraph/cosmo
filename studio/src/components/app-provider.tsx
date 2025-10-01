import { identify, resetTracking } from "@/lib/track";
import { Transport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { createConnectTransport } from "@connectrpc/connect-web";
import { QueryClient, useQuery, useQueryClient, } from "@tanstack/react-query";
import { useRouter } from "next/router";
import { ReactNode, createContext, useEffect, useState } from "react";
import { useCookieOrganization } from "@/hooks/use-cookie-organization";
import { setUser as setSentryUser } from "@sentry/nextjs";
import { OrganizationRole } from "@/lib/constants";
import { WorkspaceProvider } from "@/components/dashboard/workspace-provider";

const sessionQueryClient = new QueryClient();

export const UserContext = createContext<User | undefined>(undefined);
export const SessionClientContext =
  createContext<QueryClient>(sessionQueryClient);

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
  creatorUserId?: string;
  groups: {
    groupId: string;
    name: string;
    rules: {
      role: OrganizationRole;
      resources: string[];
    }[];
  }[];
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
  deactivation?: {
    reason?: string;
    initiatedAt: string;
  };
  deletion?: {
    queuedAt: string;
    queuedBy?: string;
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
    throw e;
  }
};

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const router = useRouter();
  const currentOrgSlug = router.query.organizationSlug;

  // we store the current org slug in a cookie, so that we can redirect to the correct org after login
  // as well as being able to access the cookie on the server.
  const [cookieOrgSlug, setOrgSlugCookie] = useCookieOrganization();

  // On initial load or page reload, the transport is set and available already.
  // So only when the transport changes again, we need to reset queries.
  // URL slug changes -> update cookie -> update verified slug -> changes transport -> updates reset counter -> resets queries
  const [verifiedOrganizationSlug, setVerifiedOrganizationSlug] =
    useState<string>();
  const [transport, setTransport] = useState<Transport>();
  const [queryResetCounter, setQueryResetCounter] = useState(-1);
  const queryClient = useQueryClient();

  const [user, setUser] = useState<User>();

  useEffect(() => {
    if (!router.isReady) return;
    if (currentOrgSlug && typeof currentOrgSlug === "string") {
      setOrgSlugCookie(currentOrgSlug);
    }
  }, [currentOrgSlug, router, setOrgSlugCookie]);

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
    sessionQueryClient,
  );

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
        (org) => org.slug === cookieOrgSlug,
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

      if (process.env.NEXT_PUBLIC_SENTRY_ENABLED) {
        setSentryUser({
          id: data.id,
          email: data.email,
          organization: organization.name,
          organizationId: organization.id,
          organizationSlug: organization.slug,
          plan: organization.plan,
        });
      }

      // Identify call for tracking script
      identify({
        id: data.id,
        email: data.email,
        organizationId: organization.id,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        plan: organization.plan,
      });

      setVerifiedOrganizationSlug(organization.slug);

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
            ? `/${organization.slug}?${params}`
            : `/${organization.slug}`,
        );
      }
    }
  }, [router, data, isFetching, error, cookieOrgSlug]);

  useEffect(() => {
    if (!verifiedOrganizationSlug) {
      return;
    }

    const newTransport = createConnectTransport({
      baseUrl: process.env.NEXT_PUBLIC_COSMO_CP_URL!,
      useHttpGet: true,
      interceptors: [
        (next) => async (req) => {
          req.header.set("cosmo-org-slug", verifiedOrganizationSlug);
          return await next(req);
        },
      ],
      // Allow cookies to be sent to the server
      credentials: "include",
    });

    setTransport(newTransport);
  }, [verifiedOrganizationSlug]);

  useEffect(() => {
    if (!transport) {
      return;
    }
    setQueryResetCounter((prev) => prev + 1);
  }, [transport]);

  useEffect(() => {
    if (!queryResetCounter) {
      return;
    }

    queryClient.resetQueries();
  }, [queryResetCounter, queryClient]);

  if (!transport) {
    return (
      <UserContext.Provider value={user}>
        <SessionClientContext.Provider value={sessionQueryClient}>
          <WorkspaceProvider>
            {children}
          </WorkspaceProvider>
        </SessionClientContext.Provider>
      </UserContext.Provider>
    );
  }

  return (
    <TransportProvider transport={transport}>
      <UserContext.Provider value={user}>
        <SessionClientContext.Provider value={sessionQueryClient}>
          <WorkspaceProvider>
            {children}
          </WorkspaceProvider>
        </SessionClientContext.Provider>
      </UserContext.Provider>
    </TransportProvider>
  );
};
