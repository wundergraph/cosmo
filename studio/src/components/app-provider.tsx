import { Transport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { useRouter } from "next/router";
import { createContext, ReactNode, useEffect, useState } from "react";

interface User {
  id: string;
  email: string;
  organization: Organization;
  roles: ("admin" | "member")[];
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  isFreeTrial: boolean;
}

interface Session {
  id: string;
  email: string;
  organizations: Organization[];
  roles: ("admin" | "member")[];
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
      }
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
  const { data, error, isFetching } = useQuery<
    Session | null,
    UnauthorizedError | Error
  >(["user"], () => fetchSession(), {
    refetchOnWindowFocus: true,
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
      router.replace("/login");
    } else if (data) {
      setUser({
        id: data.id,
        email: data.email,
        organization: data.organizations[0],
        roles: data.roles,
      });
      const organizationSlug = data.organizations[0].slug;

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
        })
      );

      if (router.pathname === "/" || router.pathname === "/login") {
        const url = new URL(
          window.location.origin + router.basePath + router.asPath
        );
        const params = new URLSearchParams(url.search);
        router.replace(
          params.size !== 0
            ? `/${organizationSlug}?${params}`
            : `/${organizationSlug}`
        );
      }
    }
  }, [router, data, isFetching, error]);

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
