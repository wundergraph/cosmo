import {
  ChartTooltip,
  tooltipWrapperClassName,
} from "@/components/analytics/charts";
import { UserContext } from "@/components/app-provider";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  YAxis
} from "recharts";

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
        Number(data.count) > requestLimit
          ? requestLimit
          : Number(data.count),
      capacity:
        Number(data.count) > requestLimit
          ? 0
          : requestLimit - Number(data.count),
    },
  ];

  return (
    <div className="flex flex-col gap-y-4">
      <p className="text-sm text-muted-foreground">
        Usages and limits of the current month. Click{" "}
        <Link
          href={calURL}
          className="text-primary"
          target="_blank"
          rel="noreferrer"
        >
          here
        </Link>{" "}
        to increase the limits.
      </p>
      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2 flex flex-col gap-y-3 p-3">
          <div className="flex items-center gap-x-2">
            <h1 className="text-lg font-medium">Requests Usage</h1>
            <Separator
              orientation="vertical"
              className="h-6"
            />
            <span className="text-xs text-muted-foreground">{`${formatMetric(
              requestLimit,
            )} / month`}</span>
          </div>
          <CustomBarChart data={chartData} />
        </Card>
        <div className="col-span-1">
          <Card className="col-span-2 flex flex-col gap-y-3 p-3">
            <h1 className="text-lg font-medium">Organization Limits</h1>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Limit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Analytics Data Retention</TableCell>
                  <TableCell>{`${
                    user?.currentOrganization.limits.analyticsRetentionLimit ||
                    7
                  } days`}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Tracing Data Retention</TableCell>
                  <TableCell>{`${
                    user?.currentOrganization.limits.tracingRetentionLimit || 7
                  } days`}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Breaking Changes Retention</TableCell>
                  <TableCell>{`${
                    user?.currentOrganization.limits
                      .breakingChangeRetentionLimit || 7
                  } days`}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Changelog Data Retention</TableCell>
                  <TableCell>{`${
                    user?.currentOrganization.limits
                      .changelogDataRetentionLimit || 7
                  } days`}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Trace Sampling Rate</TableCell>
                  <TableCell>{`${
                    (user?.currentOrganization.limits.traceSamplingRateLimit ||
                      0.1) * 100
                  }%`}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
    </div>
  );
};

UsagesPage.getLayout = (page) => {
  return getDashboardLayout(page, "Usage", "View all your usages and limits.");
};

export default UsagesPage;
