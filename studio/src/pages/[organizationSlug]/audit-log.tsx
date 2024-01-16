import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@tanstack/react-query";
import { getAuditLogs } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { AuditLogTable, Empty } from "@/components/audit-log-table";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";

const AuditLogPage: NextPageWithLayout = () => {
  const { data, isLoading, error } = useQuery(
    getAuditLogs.useQuery({
      limit: 100,
    }),
  );

  if (isLoading) return <Loader fullscreen />;

  if (data?.response?.code === EnumStatusCode.ERROR_NOT_AUTHORIZED) {
    return <Empty unauthorized={true} />;
  }

  if (!data?.logs.length) return <Empty unauthorized={false} />;

  return (
    <div className="flex flex-col gap-y-4 pt-2">
      <AuditLogTable logs={data?.logs} />
    </div>
  );
};

AuditLogPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Audit log",
    "Audit log of your organization",
  );
};

export default AuditLogPage;
