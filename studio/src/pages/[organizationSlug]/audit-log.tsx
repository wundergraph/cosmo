import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@tanstack/react-query";
import { getAuditLogs } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { AuditLogTable, Empty } from "@/components/audit-log-table";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { useUser } from "@/hooks/use-user";
import { useRouter } from "next/router";
import { endOfDay, formatISO, startOfDay, subDays } from "date-fns";
import {
  DatePickerWithRange,
  DateRangePickerChangeHandler,
} from "@/components/date-picker-with-range";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { Toolbar } from "@/components/ui/toolbar";
import { useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DoubleArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowRightIcon,
} from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { TableWrapper } from "@/components/ui/table";

const useDateRange = () => {
  const router = useRouter();

  const dateRange = router.query.dateRange
    ? JSON.parse(router.query.dateRange as string)
    : {
        start: subDays(new Date(), 7),
        end: new Date(),
      };
  const startDate = new Date(dateRange.start);
  const endDate = new Date(dateRange.end);

  return {
    startDate,
    endDate,
  };
};

const AuditLogPage: NextPageWithLayout = () => {
  const router = useRouter();
  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;

  const limit = Number.parseInt((router.query.pageSize as string) || "10");

  const { startDate, endDate } = useDateRange();

  const user = useUser();
  const { data, isLoading, error } = useQuery({
    ...getAuditLogs.useQuery({
      limit: limit,
      offset: (pageNumber - 1) * limit,
      startDate: formatISO(startOfDay(startDate)),
      endDate: formatISO(endOfDay(endDate)),
    }),
    queryKey: [router.asPath, "GetAuditLogs", {}],
  });

  const applyNewParams = useCallback(
    (newParams: Record<string, string>) => {
      router.push({
        query: {
          ...router.query,
          ...newParams,
        },
      });
    },
    [router],
  );

  if (isLoading) return <Loader fullscreen />;

  if (data?.response?.code === EnumStatusCode.ERROR_NOT_AUTHORIZED) {
    return <Empty unauthorized={true} />;
  }

  if (!data?.logs.length) return <Empty unauthorized={false} />;

  const noOfPages = Math.ceil(parseInt(data.count) / limit);

  return (
    <div className="flex h-full flex-col gap-y-4">
      <AuditLogTable logs={data?.logs} />
      <div className="mr-2 flex justify-end">
        <div className="flex items-center space-x-2">
          <p className="text-sm font-medium">Rows per page</p>
          <Select
            value={`${limit}`}
            onValueChange={(value) => {
              applyNewParams({ pageSize: value });
            }}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue placeholder={`${limit}`} />
            </SelectTrigger>
            <SelectContent side="top">
              {[10, 20, 30, 40, 50].map((pageSize) => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-[100px] items-center justify-center text-sm font-medium">
          Page {noOfPages === 0 ? "0" : pageNumber} of {noOfPages}
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => {
              applyNewParams({ page: "1" });
            }}
            disabled={pageNumber === 1}
          >
            <span className="sr-only">Go to first page</span>
            <DoubleArrowLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => {
              applyNewParams({ page: (pageNumber - 1).toString() });
            }}
            disabled={pageNumber === 1}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => {
              applyNewParams({ page: (pageNumber + 1).toString() });
            }}
            disabled={pageNumber === noOfPages || noOfPages === 0}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => {
              applyNewParams({ page: noOfPages.toString() });
            }}
            disabled={pageNumber === noOfPages || noOfPages === 0}
          >
            <span className="sr-only">Go to last page</span>
            <DoubleArrowRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

const AuditLogToolbar = () => {
  const router = useRouter();

  const { startDate, endDate } = useDateRange();

  const onDateRangeChange: DateRangePickerChangeHandler = ({ dateRange }) => {
    const stringifiedDateRange = JSON.stringify({
      start: dateRange?.start as Date,
      end: (dateRange?.end as Date) ?? (dateRange?.end as Date),
    });

    router.push({
      query: {
        ...router.query,
        dateRange: stringifiedDateRange,
      },
    });
  };

  const auditLogRetention = useFeatureLimit("analytics-retention", 7);

  return (
    <Toolbar>
      <DatePickerWithRange
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
