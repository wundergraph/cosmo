import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { AlertTabs } from "./webhooks";
import { NextPageWithLayout } from "@/lib/page";
import { getOrganizationWebhookConfigs } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useQuery } from "@tanstack/react-query";
import { UserContext } from "@/components/app-provider";
import { useContext } from "react";
import { EmptyState } from "@/components/empty-state";
import { Loader } from "@/components/ui/loader";
import { docsBaseURL } from "@/lib/constants";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { PiWebhooksLogo } from "react-icons/pi";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const IntegrationsPage: NextPageWithLayout = () => {
  const user = useContext(UserContext);
  const { data, isLoading, error, refetch } = useQuery({
    ...getOrganizationWebhookConfigs.useQuery(),
    queryKey: [
      user?.currentOrganization.slug || "",
      "GetOrganizationWebhookConfigs",
      {},
    ],
  });

  if (isLoading) return <Loader fullscreen />;

  if (error || data.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve webhooks"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  const slackIntegrations = data.configs.filter((w) => w.type === "slack");

  if (slackIntegrations.length === 0) {
    return (
      <EmptyState
        icon={<PiWebhooksLogo />}
        title="Create a new slack integration"
        description={
          <>
            Receive data when certain events occur.{" "}
            <a
              target="_blank"
              rel="noreferrer"
              href={docsBaseURL + "/studio/webhooks"}
              className="text-primary"
            >
              Learn more.
            </a>
          </>
        }
        actions={
          <Button>
            <Link href="https://slack.com/oauth/v2/authorize?client_id=1435676984739.6022357477936&scope=incoming-webhook&user_scope=">
              Integrate Slack
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <p className="ml-1 text-sm text-muted-foreground">
          Webhooks are used to receive certain events from the platform.{" "}
          <Link
            href={docsBaseURL + "/studio/webhooks"}
            className="text-primary"
            target="_blank"
            rel="noreferrer"
          >
            Learn more
          </Link>
        </p>
        {/* <Webhook mode="create" refresh={() => refetch()} /> */}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Endpoint</TableHead>
            <TableHead>Events</TableHead>
            <TableHead aria-label="Actions"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {slackIntegrations.map(({ id, endpoint, events }) => {
            return (
              <TableRow key={id}>
                <TableCell className="font-medium">{endpoint}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    {events.map((event) => {
                      return (
                        <Badge variant="secondary" key={event}>
                          {event}
                        </Badge>
                      );
                    })}
                    {events.length === 0 && <p className="italic">No events</p>}
                  </div>
                </TableCell>
                <TableCell className="flex justify-end space-x-2">
                  {/* <Webhook
                    mode="update"
                    refresh={() => refetch()}
                    existing={{
                      id,
                      endpoint,
                      events,
                    }}
                  />
                  <DeleteWebhook id={id} refresh={() => refetch()} /> */}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

IntegrationsPage.getLayout = (page) => {
  return getDashboardLayout(
    <div className="flex flex-col gap-y-4">
      <AlertTabs tab="integrations" />
      <>{page}</>
    </div>,
    "Webhooks",
    "Configure webhooks for your organization"
  );
};

export default IntegrationsPage;
