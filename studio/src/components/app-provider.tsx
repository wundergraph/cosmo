import { Transport } from "@connectrpc/connect";
import { TransportProvider } from "@connectrpc/connect-query";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { useRouter } from "next/router";
import {
  createContext,
  Dispatch,
  ReactNode,
  SetStateAction,
  useEffect,
  useState,
} from "react";

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
  isFreeTrial: boolean;
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

export const UserContext = createContext<
  [User | undefined, Dispatch<SetStateAction<User | undefined>> | undefined]
>([undefined, undefined]);

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
  const currentOrgSlug = router.query.organizationSlug;
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
    } else if (data && !error) {
      const currentOrg = data.organizations.find(
        (org) => org.slug === currentOrgSlug
      );

      setUser({
        id: data.id,
        email: data.email,
        currentOrganization: currentOrg || data.organizations[0],
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
        })
      );

      if (
        router.pathname === "/" ||
        router.pathname === "/login" ||
        !currentOrg
      ) {
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
  }, [router, data, isFetching, error, currentOrgSlug]);

  if (!transport) {
    return (
      <UserContext.Provider value={[user, setUser]}>
        {children}
      </UserContext.Provider>
    );
  }

  return (
    <TransportProvider transport={transport}>
      <QueryClientProvider client={queryClient}>
        <UserContext.Provider value={[user, setUser]}>
          {children}
        </UserContext.Provider>
      </QueryClientProvider>
    </TransportProvider>
  );
};
