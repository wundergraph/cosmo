import { ChartTooltip } from "@/components/analytics/charts";
import { UserContext } from "@/components/app-provider";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import { Separator } from "@/components/ui/separator";
import { Toolbar } from "@/components/ui/toolbar";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { calURL } from "@/lib/constants";
import { formatMetric } from "@/lib/format-metric";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getOrganizationRequestsCount } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext, useEffect } from "react";
import { CgDanger } from "react-icons/cg";
import { IoWarningOutline } from "react-icons/io5";
import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

const valueFormatter = (number: number) => `${formatMetric(number)}`;

const FeatureLimit = ({
  id,
  fallback,
  multiplier,
}: {
  id: string;
  fallback?: number;
  multiplier?: number;
}) => {
  const limit = useFeatureLimit(id, fallback);

  if (limit === -1) {
    return "Unlimited";
  }

  if (limit && multiplier) {
    return <>{limit * multiplier}</>;
  }

  return <>{limit}</>;
};

export const CustomBarChart = ({
  data,
}: {
  data: { usage: number; capacity?: number; name: string }[];
}) => {
  return (
    <ResponsiveContainer width="100%" height={175} className="my-auto text-xs">
      <BarChart layout="vertical" data={data}>
        <XAxis
          type="number"
          domain={[0, (data[0].capacity || 0) + data[0].usage]}
          tickFormatter={valueFormatter}
        />
        <YAxis type="category" hide />
        <Bar dataKey="usage" stackId="a" fill="#82ca9d" name="Usage" />
        {data[0].capacity ? (
          <Bar dataKey="capacity" stackId="a" fill="#8884d8" name="Capacity" />
        ) : null}
        <ChartTooltip
          formatter={valueFormatter}
          labelFormatter={() => "Requests"}
        />
        <Legend />
      </BarChart>
    </ResponsiveContainer>
  );
};

const UsagesPage: NextPageWithLayout = () => {
  const user = useContext(UserContext);
  const { data, isLoading, error, refetch } = useQuery(
    getOrganizationRequestsCount,
  );

  const requestLimitRaw = useFeatureLimit("requests", 1000);
  const requestLimit = requestLimitRaw === -1 ? -1 : requestLimitRaw * 10 ** 6;

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve the usages"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  const chartData: { usage: number; capacity?: number; name: string }[] = [
    {
      name: "Requests",
      usage:
        requestLimit > 0 && Number(data.count) > requestLimit
          ? 0
          : Number(data.count),
      capacity:
        requestLimit < 0
          ? undefined
          : Number(data.count) > requestLimit
          ? 0
          : requestLimit - Number(data.count),
    },
  ];
  const currentUsagePct = chartData[0].usage / requestLimit;

  return (
    <div className="flex flex-col gap-y-4">
      {requestLimit > 0 && currentUsagePct === 1 ? (
        <div className="flex items-center gap-x-2 rounded-lg border !border-destructive px-4 py-2 text-destructive">
          <CgDanger size={20} className="text-destructive" />
          <span>
            {
              "Your organization has reached 100% of your request limit. It might affect the product's functionality. "
            }
            Please{" "}
            <a
              className="underline underline-offset-2"
              href={calURL}
              target="_blank"
              rel="noreferrer"
            >
              contact us
            </a>{" "}
            to upgrade.
          </span>
        </div>
      ) : requestLimit > 0 && currentUsagePct >= 0.9 ? (
        <div className="flex items-center gap-x-2 rounded-lg border !border-amber-400 px-4 py-2 text-amber-400">
          <IoWarningOutline size={20} />
          <span>
            {
              "Your organization has crossed 90% of your request limit. Reaching 100% might affect the product's functionality. "
            }
            Please{" "}
            <a
              className="text-amber-500 underline underline-offset-2"
              href={calURL}
              target="_blank"
              rel="noreferrer"
            >
              contact us
            </a>{" "}
            to upgrade.
          </span>
        </div>
      ) : requestLimit > 0 && currentUsagePct >= 0.75 ? (
        <div className="flex items-center gap-x-2 rounded-lg border !border-amber-400 px-4 py-2 text-amber-400">
          <IoWarningOutline size={20} />
          <span>
            {
              "Your organization has crossed 75% of your request limit. Reaching 100% might affect the product's functionality. "
            }
            Please{" "}
            <a
              className="text-amber-500 underline underline-offset-2"
              href={calURL}
              target="_blank"
              rel="noreferrer"
            >
              contact us
            </a>{" "}
            to upgrade.
          </span>
        </div>
      ) : (
        <></>
      )}
      <div className="flex grid-cols-3 flex-col gap-4 lg:grid">
        <Card className="col-span-2 flex flex-col gap-y-3 p-3">
          <div className="flex items-center gap-x-2">
            <h1 className="text-lg font-medium">Requests</h1>
            <Separator orientation="vertical" className="h-6" />
            <span className="text-xs text-muted-foreground">
              {`${
                requestLimit === -1 ? "Unlimited" : formatMetric(requestLimit)
              } / month`}
            </span>
          </div>
          <CustomBarChart data={chartData} />
        </Card>

        <Card className="col-span-1 flex flex-col">
          <CardHeader>
            <CardTitle>Organization Limits</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pt-0">
            <dl className="space-y-2">
              <div className="flex">
                <dt className="flex-1 px-2 text-sm text-muted-foreground">
                  Users
                </dt>
                <dd className="w-1/3 px-2 text-right text-sm font-medium">
                  <FeatureLimit id="users" fallback={25} />
                </dd>
              </div>
              <div className="flex">
                <dt className="flex-1 px-2 text-sm text-muted-foreground">
                  Federated graphs & Monographs
                </dt>
                <dd className="w-1/3 px-2 text-right text-sm font-medium">
                  <FeatureLimit id="federated-graphs" fallback={25} />
                </dd>
              </div>
              <div className="flex">
                <dt className="flex-1 px-2 text-sm text-muted-foreground">
                  Analytics Data Retention
                </dt>
                <dd className="w-1/3 px-2 text-right text-sm font-medium">
                  <FeatureLimit id="analytics-retention" fallback={30} /> days
                </dd>
              </div>
              <div className="flex">
                <dt className="flex-1 px-2 text-sm text-muted-foreground">
                  Tracing Data Retention
                </dt>
                <dd className="w-1/3 px-2 text-right text-sm font-medium">
                  <FeatureLimit id="tracing-retention" fallback={30} /> days
                </dd>
              </div>
              <div className="flex">
                <dt className="flex-1 px-2 text-sm text-muted-foreground">
                  Breaking Changes Retention
                </dt>
                <dd className="w-1/3 px-2 text-right text-sm font-medium">
                  <FeatureLimit id="breaking-change-retention" fallback={30} />{" "}
                  days
                </dd>
              </div>
              <div className="flex">
                <dt className="flex-1 px-2 text-sm text-muted-foreground">
                  Changelog Data Retention
                </dt>
                <dd className="w-1/3 px-2 text-right text-sm font-medium">
                  <FeatureLimit id="changelog-retention" fallback={30} /> days
                </dd>
              </div>
              <div className="flex">
                <dt className="flex-1 px-2 text-sm text-muted-foreground">
                  Field Grace Period Limit
                </dt>
                <dd className="w-1/3 px-2 text-right text-sm font-medium">
                  <FeatureLimit id="field-pruning-grace-period" fallback={30} />{" "}
                  days
                </dd>
              </div>
              <div className="flex">
                <dt className="flex-1 px-2 text-sm text-muted-foreground">
                  Trace Sampling Rate
                </dt>
                <dd className="w-1/3 px-2 text-right text-sm font-medium">
                  <FeatureLimit
                    id="trace-sampling-rate"
                    multiplier={100}
                    fallback={1}
                  />
                  %
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const IncreaseLimits = () => {
  const router = useRouter();

  const slug = router.query.organizationSlug as string;

  return (
    <Button asChild variant="outline">
      <Link href={`/${slug}/billing`}>Increase limits</Link>
    </Button>
  );
};

UsagesPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Usage",
    "Usage and limits of the current billing cycle",
    undefined,
    <Toolbar className="w-auto">
      <IncreaseLimits />
    </Toolbar>,
  );
};

export default UsagesPage;
