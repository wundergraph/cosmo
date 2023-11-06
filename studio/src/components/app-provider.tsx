import { Transport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { addDays } from "date-fns";
import { useRouter } from "next/router";
import { createContext, ReactNode, useEffect, useState } from "react";

interface User {
  id: string;
  email: string;
  currentOrganization: Organization;
  organizations: Organization[];
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  isFreeTrial: boolean;
  isFreeTrialExpired: boolean;
  roles: string[];
  createdAt: string;
}

interface Session {
  id: string;
  email: string;
  organizations: Organization[];
}

class UnauthorizedError extends Error {
  constructor() {
    super();
    this.name = "UnauthorizedError";
  }
}

const queryClient = new QueryClient();

export const UserContext = createContext<User | undefined>(undefined);

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
  const { data, error, isFetching } = useQuery<
    Session | null,
    UnauthorizedError | Error
  >({
    queryKey: ["user", router.asPath],
    queryFn: () => fetchSession(),
    retry(failureCount, error) {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
  const [user, setUser] = useState<User>();
  const [transport, setTransport] = useState<Transport>();

  useEffect(() => {
    if (isFetching) return;
    if (
      error &&
      error instanceof UnauthorizedError &&
      router.pathname !== "/login"
    ) {
      const redirectURL = `${process.env.NEXT_PUBLIC_COSMO_STUDIO_URL}${router.asPath}`;
      router.replace(`/login?redirectURL=${redirectURL}`);
    } else if (data && !error) {
      const currentOrg = data.organizations.find(
        (org) => org.slug === currentOrgSlug,
      );

      const organization = currentOrg || data.organizations[0];

      setUser({
        id: data.id,
        email: data.email,
        currentOrganization: {
          ...organization,
          isFreeTrialExpired:
            organization.isFreeTrial &&
            new Date() > addDays(new Date(organization.createdAt), 10),
        },
        organizations: data.organizations,
      });
      const organizationSlug = currentOrg?.slug || data.organizations[0].slug;

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
        router.pathname === "/" ||
        router.pathname === "/login" ||
        !currentOrg
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
  }, [router, data, isFetching, error, currentOrgSlug]);

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
