import { useSessionStorage } from "@/hooks/use-session-storage";
import Link from "next/link";
import { ParsedUrlQueryInput } from "querystring";
import { useRouter } from "next/router";
import { BiAnalyse } from "react-icons/bi";
import { IoBarcodeSharp } from "react-icons/io5";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Button } from "../ui/button";
import { calURL } from "@/lib/constants";

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

  if (router.query.range) {
    query.range = router.query.range;
  }

  if (router.query.dateRange) {
    query.dateRange = router.query.dateRange;
  }

  const [tracesRoute, setTracesRoute] = useSessionStorage<
    ParsedUrlQueryInput | undefined
  >("analytics.route", query);

  const isTracePage = router.query.traceID;

  const updateRoute = () => {
    if (!isTracePage) {
      setTracesRoute(query);
    }
  };

  return (
    <div className="flex items-center justify-between border-b px-4 py-2">
      <div className="flex items-center gap-2">
        <Tabs value={props.tab} className="w-full md:w-auto">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview" asChild>
              <Link
                href={{
                  pathname: "/[organizationSlug]/graph/[slug]/analytics",
                  query: isTracePage ? tracesRoute : query,
                }}
                onClick={updateRoute}
                className="flex gap-x-2"
              >
                <BiAnalyse />
                Metrics
              </Link>
            </TabsTrigger>
            <TabsTrigger value="traces" asChild>
              <Link
                href={{
                  pathname: "/[organizationSlug]/graph/[slug]/analytics/traces",
                  query: isTracePage ? tracesRoute : query,
                }}
                onClick={updateRoute}
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
      <Button variant="outline">
        <Link href={calURL}>Increase data retention</Link>
      </Button>
    </div>
  );
};
