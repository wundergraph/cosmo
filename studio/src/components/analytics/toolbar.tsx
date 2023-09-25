import { useRouter } from "next/router";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { useSessionStorage } from "@/hooks/use-session-storage";
import { set } from "lodash";
import Link from "next/link";

export const AnalyticsToolbar: React.FC<{
  tab: string;
  children?: React.ReactNode;
}> = (props) => {
  const router = useRouter();

  const [tracesRoute] = useSessionStorage<string | undefined>(
    "analytics.route",
    router.pathname
  );

  const query = {
    organizationSlug: router.query.organizationSlug,
    slug: router.query.slug,
  };

  return (
    <div className="flex items-center gap-2">
      <Tabs defaultValue={props.tab}>
        <TabsList>
          <TabsTrigger value="overview" asChild>
            <Link
              href={{
                pathname: "/[organizationSlug]/graph/[slug]/analytics",
                query,
              }}
            >
              Metrics
            </Link>
          </TabsTrigger>
          <TabsTrigger value="traces" asChild>
            <Link
              href={
                props.tab === "overview" || !tracesRoute
                  ? {
                      pathname:
                        "/[organizationSlug]/graph/[slug]/analytics/traces",
                      query,
                    }
                  : tracesRoute
              }
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
