import {
  ChartTooltip,
  tooltipWrapperClassName,
} from "@/components/analytics/charts";
import { UserContext } from "@/components/app-provider";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { calURL } from "@/lib/constants";
import { formatMetric } from "@/lib/format-metric";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getOrganizationRequestsCount } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useContext } from "react";
import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { CgDanger } from "react-icons/cg";
import { IoWarningOutline } from "react-icons/io5";

const valueFormatter = (number: number) => `${formatMetric(number)}`;

export const CustomBarChart = ({
  data,
}: {
  data: { usage: number; capacity: number }[];
}) => {
  return (
    <ResponsiveContainer width="100%" height={175} className="my-auto text-xs">
      <BarChart layout="vertical" data={data}>
        <XAxis
          type="number"
          domain={[0, data[0].capacity + data[0].usage]}
          tickFormatter={valueFormatter}
        />
        <YAxis type="category" hide={true} />
        <Bar dataKey="usage" stackId="a" fill="#82ca9d" name="Usage" />
        <Bar dataKey="capacity" stackId="a" fill="#8884d8" name="Capacity" />
        <ChartTooltip
          formatter={valueFormatter}
          position={{ y: 100 }}
          content={
            <div
              className={cn(tooltipWrapperClassName, "flex flex-col gap-y-2")}
            >
              <p className="text-[#82ca9d]">
                Usage: {formatMetric(data[0].usage)}
              </p>
              <p className="text-[#8884d8]">
                Capacity: {formatMetric(data[0].capacity)}
              </p>
            </div>
          }
        />
        <Legend />
      </BarChart>
    </ResponsiveContainer>
  );
};

const UsagesPage: NextPageWithLayout = () => {
  const user = useContext(UserContext);
  const { data, isLoading, error, refetch } = useQuery({
    ...getOrganizationRequestsCount.useQuery(),
    queryKey: [
      user?.currentOrganization.slug || "",
      "GetOrganizationRequestsCount",
      {},
    ],
  });

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

  const requestLimit =
    (user?.currentOrganization.limits.requestsLimit || 10) * 10 ** 6;

  const chartData: { usage: number; capacity: number }[] = [
    {
      usage:
        Number(data.count) > requestLimit ? requestLimit : Number(data.count),
      capacity:
        Number(data.count) > requestLimit
          ? 0
          : requestLimit - Number(data.count),
    },
  ];

  return (
    <div className="flex flex-col gap-y-4">
      {chartData[0].usage / requestLimit === 1 ? (
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
      ) : chartData[0].usage / requestLimit >= 0.9 ? (
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
      ) : chartData[0].usage / requestLimit >= 0.75 ? (
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
              Max {`${formatMetric(requestLimit)} / month`}
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
                  Analytics Data Retention
                </dt>
                <dd className="w-1/3 px-2 text-right text-sm font-medium">
                  {`${
                    user?.currentOrganization.limits.analyticsRetentionLimit ||
                    7
                  } days`}
                </dd>
              </div>
              <div className="flex">
                <dt className="flex-1 px-2 text-sm text-muted-foreground">
                  Tracing Data Retention
                </dt>
                <dd className="w-1/3 px-2 text-right text-sm font-medium">
                  {`${
                    user?.currentOrganization.limits.tracingRetentionLimit || 7
                  } days`}
                </dd>
              </div>
              <div className="flex">
                <dt className="flex-1 px-2 text-sm text-muted-foreground">
                  Breaking Changes Retention
                </dt>
                <dd className="w-1/3 px-2 text-right text-sm font-medium">
                  {`${
                    user?.currentOrganization.limits
                      .breakingChangeRetentionLimit || 7
                  } days`}
                </dd>
              </div>
              <div className="flex">
                <dt className="flex-1 px-2 text-sm text-muted-foreground">
                  Changelog Data Retention
                </dt>
                <dd className="w-1/3 px-2 text-right text-sm font-medium">
                  {`${
                    user?.currentOrganization.limits
                      .changelogDataRetentionLimit || 7
                  } days`}
                </dd>
              </div>
              <div className="flex">
                <dt className="flex-1 px-2 text-sm text-muted-foreground">
                  Trace Sampling Rate
                </dt>
                <dd className="w-1/3 px-2 text-right text-sm font-medium">
                  {`${
                    (user?.currentOrganization.limits.traceSamplingRateLimit ||
                      0.1) * 100
                  }%`}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

UsagesPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Usage",
    "Usage and limits of the current billing cycle",
    <>
      <Button asChild variant="outline">
        <Link href={calURL} target="_blank" rel="noreferrer">
          Increase limits
        </Link>
      </Button>
    </>,
  );
};

export default UsagesPage;
