import { useRouter } from "next/router";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { useSessionStorage } from "@/hooks/use-session-storage";
import Link from "next/link";
import { ParsedUrlQueryInput } from "querystring";

export const AnalyticsToolbar: React.FC<{
  tab: string;
  children?: React.ReactNode;
}> = (props) => {
  const router = useRouter();

  const query: ParsedUrlQueryInput = {
    organizationSlug: router.query.organizationSlug,
    slug: router.query.slug,
  };

  if (router.query.filterState) {
    query.filterState = router.query.filterState;
  }

  const [tracesRoute, setTracesRoute] = useSessionStorage<
    ParsedUrlQueryInput | undefined
  >("analytics.route", query);

  const updateRoute = () => {
    if (!router.query.traceID) {
      setTracesRoute(query);
    }
  };

  return (
    <div className="flex items-center gap-2 border-b px-4 py-2">
      <Tabs value={props.tab}>
        <TabsList>
          <TabsTrigger value="overview" asChild>
            <Link
              href={{
                pathname: "/[organizationSlug]/graph/[slug]/analytics",
                query: tracesRoute || query,
              }}
              onClick={updateRoute}
            >
              Metrics
            </Link>
          </TabsTrigger>
          <TabsTrigger value="traces" asChild>
            <Link
              href={{
                pathname: "/[organizationSlug]/graph/[slug]/analytics/traces",
                query: props.tab === "overview" ? query : tracesRoute,
              }}
              onClick={updateRoute}
            >
              Traces
            </Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {props.children}
    </div>
  );
};
