import { useRouter } from "next/router";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { useSessionStorage } from "@/hooks/use-session-storage";

export const AnalyticsToolbar: React.FC<{
  tab: string;
  children?: React.ReactNode;
}> = (props) => {
  const router = useRouter();

  const [operationsRoute, setRouteCache] = useSessionStorage(
    "analytics.route",
    router.pathname
  );

  const query = {
    organizationSlug: router.query.organizationSlug,
    slug: router.query.slug,
  };

  const setTab = (tab: string) => {
    if (tab === "overview") {
      return router.push({
        pathname: "/[organizationSlug]/graph/[slug]/analytics",
        query,
      });
    }

    if (operationsRoute) {
      return router.push(operationsRoute);
    }

    return router.push({
      pathname: "/[organizationSlug]/graph/[slug]/analytics/operations",
      query,
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Tabs defaultValue={props.tab}>
        <TabsList>
          <TabsTrigger value="overview" onClick={() => setTab("overview")}>
            Overview
          </TabsTrigger>
          <TabsTrigger value="operations" onClick={() => setTab("operations")}>
            Operations
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {props.children}
    </div>
  );
};
