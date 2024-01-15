import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@tanstack/react-query";
import { getAuditLogs } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { AuditLogTable } from "@/components/audit-log-table";

const AuditLogPage: NextPageWithLayout = () => {
  const { data, isLoading } = useQuery(getAuditLogs.useQuery());

  if (isLoading) return <Loader fullscreen />;

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
