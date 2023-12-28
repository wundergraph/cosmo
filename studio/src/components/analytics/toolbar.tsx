import { useSessionStorage } from "@/hooks/use-session-storage";
import Link from "next/link";
import { ParsedUrlQueryInput } from "querystring";
import { useRouter } from "next/router";
import { BiAnalyse } from "react-icons/bi";
import { IoBarcodeSharp } from "react-icons/io5";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Toolbar } from "../ui/toolbar";
import { Button } from "../ui/button";
import { calURL } from "@/lib/constants";
import { BsQuestionCircle } from "react-icons/bs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useContext } from "react";
import { UserContext } from "../app-provider";
import { Spacer } from "../ui/spacer";
import { useFeature } from "@/hooks/use-feature";

export const AnalyticsToolbar: React.FC<{
  tab: string;
  children?: React.ReactNode;
}> = (props) => {
  const router = useRouter();
  const user = useContext(UserContext);

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

  const retention = useFeature("analytics-retention");

  return (
    <Toolbar>
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
      <Spacer />
      {retention?.limit ? (
        <Button variant="ghost" className="flex items-center gap-x-2">
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger>
                <BsQuestionCircle />
              </TooltipTrigger>
              <TooltipContent>{`Your current data retention is ${
                retention?.limit || 7
              } days. Please get in touch with us to increase the limit.`}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Link href={calURL}>Increase data retention</Link>
        </Button>
      ) : null}
      {props.children}
    </Toolbar>
  );
};
