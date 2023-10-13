import { useSessionStorage } from "@/hooks/use-session-storage";
import Link from "next/link";
import { useRouter } from "next/router";
import { BiAnalyse } from "react-icons/bi";
import { IoBarcodeSharp } from "react-icons/io5";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

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
    <div className="flex items-center gap-2 px-4 py-2 lg:px-6 lg:py-4">
      <Tabs defaultValue={props.tab}>
        <TabsList>
          <TabsTrigger value="overview" asChild>
            <Link
              href={{
                pathname: "/[organizationSlug]/graph/[slug]/analytics",
                query,
              }}
              className="flex gap-x-2"
            >
              <BiAnalyse />
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
              className="flex gap-x-2"
            >
              <IoBarcodeSharp size="18px" />
              Traces
            </Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {props.children}
    </div>
  );
};
