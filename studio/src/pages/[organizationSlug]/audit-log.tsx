import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useDateRangeQueryState } from "@/components/analytics/useAnalyticsQueryState";
import { AuditLogTable, Empty } from "@/components/audit-log-table";
import {
  DatePickerWithRange,
  DateRangePickerChangeHandler,
} from "@/components/date-picker-with-range";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toolbar } from "@/components/ui/toolbar";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { createDateRange } from "@/lib/insights-helpers";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
} from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getAuditLogs } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { formatISO } from "date-fns";
import { useRouter } from "next/router";
import { useCallback } from "react";

const AuditLogPage: NextPageWithLayout = () => {
  const router = useRouter();
  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;

  const limit = Number.parseInt((router.query.pageSize as string) || "10");

  const {
    dateRange: { start, end },
    range,
  } = useDateRangeQueryState();

  const startDate = range ? createDateRange(range).start : start;
  const endDate = range ? createDateRange(range).end : end;

  const { data, isLoading, error, refetch } = useQuery({
    ...getAuditLogs.useQuery({
      limit: limit > 50 ? 50 : limit,
      offset: (pageNumber - 1) * limit,
      startDate: formatISO(startDate),
      endDate: formatISO(endDate),
    }),
    queryKey: [router.asPath, "GetAuditLogs", {}],
  });

  if (isLoading) return <Loader fullscreen />;

  if (data?.response?.code === EnumStatusCode.ERROR_NOT_AUTHORIZED) {
    return <Empty unauthorized={true} />;
  }

  if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve audit logs"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  if (!data?.logs.length) return <Empty unauthorized={false} />;

  const noOfPages = Math.ceil(data.count / limit);

  return (
    <div className="flex h-full flex-col gap-y-4">
      <AuditLogTable logs={data?.logs} />
      <Pagination limit={limit} noOfPages={noOfPages} pageNumber={pageNumber} />
    </div>
  );
};

const AuditLogToolbar = () => {
  const applyParams = useApplyParams();

  const {
    dateRange: { start: startDate, end: endDate },
    range,
  } = useDateRangeQueryState();

  const onDateRangeChange: DateRangePickerChangeHandler = ({
    dateRange,
    range,
  }) => {
    if (range) {
      applyParams({
        range: range.toString(),
        dateRange: null,
      });
    } else if (dateRange) {
      const stringifiedDateRange = JSON.stringify({
        start: formatISO(dateRange.start),
        end: formatISO(dateRange.end ?? dateRange.start),
      });

      applyParams({
        range: null,
        dateRange: stringifiedDateRange,
      });
    }
  };

  const auditLogRetention = useFeatureLimit("analytics-retention", 7);

  return (
    <Toolbar>
      <DatePickerWithRange
        range={range}
        dateRange={{ start: startDate, end: endDate }}
        onChange={onDateRangeChange}
        calendarDaysLimit={auditLogRetention}
      />
    </Toolbar>
  );
};

AuditLogPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Audit log",
    "Audit log of your organization",
    undefined,
    <AuditLogToolbar />,
  );
};

export default AuditLogPage;
