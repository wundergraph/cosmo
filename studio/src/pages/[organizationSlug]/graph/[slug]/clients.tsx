import { EmptyState } from "@/components/empty-state";
import { getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { Button } from "@/components/ui/button";
import { CLI } from "@/components/ui/cli";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { docsBaseURL } from "@/lib/constants";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getClients } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { BiAnalyse } from "react-icons/bi";
import { IoBarcodeSharp } from "react-icons/io5";

const ClientsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const slug = router.query.slug as string;

  const constructLink = (name: string, mode: "metrics" | "traces") => {
    const filters = [];
    const value = {
      label: name,
      value: name,
      operator: 0,
    };

    const filter = {
      id: "clientName",
      value: [JSON.stringify(value)],
    };
    filters.push(filter);

    if (mode === "metrics") {
      return `/${organizationSlug}/graph/${slug}/analytics?filterState=${JSON.stringify(
        filters,
      )}`;
    } else {
      return `/${organizationSlug}/graph/${slug}/analytics/traces?filterState=${JSON.stringify(
        filters,
      )}`;
    }
  };

  const { data, isLoading, error, refetch } = useQuery(
    getClients.useQuery({
      fedGraphName: slug,
    }),
  );

  if (!data) return null;

  if (!data || error || data.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve changelog"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  return (
    <div className="flex flex-col gap-y-4">
      {data.clients.length === 0 ? (
        <EmptyState
          icon={<CommandLineIcon />}
          title="Push new operations to the registry using the CLI"
          description={
            <>
              No clients found. Use the CLI tool to create one.{" "}
              <a
                target="_blank"
                rel="noreferrer"
                href={docsBaseURL + "/router/persisted-operations"}
                className="text-primary"
              >
                Learn more.
              </a>
            </>
          }
          actions={
            <CLI
              command={`npx wgc operations push ${slug} -c <client-name> -f <path-to-file>`}
            />
          }
        />
      ) : (
        <>
          <p className="px-2 text-sm text-muted-foreground">
            Registered clients can be created by publishing persisted operations
            for them.{" "}
            <Link
              href={docsBaseURL + "/router/persisted-operations"}
              className="text-primary"
              target="_blank"
              rel="noreferrer"
            >
              Learn more
            </Link>
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead>Updated By</TableHead>
                <TableHead>Created At</TableHead>
                <TableHead>Last Push</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.clients.map(
                ({
                  id,
                  name,
                  createdAt,
                  lastUpdatedAt,
                  createdBy,
                  lastUpdatedBy,
                }) => {
                  return (
                    <TableRow key={id}>
                      <TableCell className="font-medium">
                        <p className="flex w-48 items-center truncate">
                          {name}
                        </p>
                      </TableCell>
                      <TableCell className="font-medium">{createdBy}</TableCell>
                      <TableCell className="font-medium">
                        <p
                          className={cn({
                            "flex w-20 items-center justify-center":
                              lastUpdatedBy === "",
                          })}
                        >
                          {lastUpdatedBy !== "" ? lastUpdatedBy : "-"}
                        </p>
                      </TableCell>
                      <TableCell>
                        {formatDistanceToNow(new Date(createdAt))}
                      </TableCell>
                      <TableCell>
                        {lastUpdatedAt
                          ? formatDistanceToNow(new Date(lastUpdatedAt))
                          : "Never"}
                      </TableCell>
                      <TableCell className="flex items-center justify-end gap-x-3 pr-8">
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger>
                            <Link href={constructLink(name, "metrics")}>
                              <BiAnalyse size="24px" className="text-primary" />
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent>Metrics</TooltipContent>
                        </Tooltip>
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger>
                            <Link href={constructLink(name, "traces")}>
                              <IoBarcodeSharp
                                size="28px"
                                className="text-primary"
                              />
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent>Traces</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                },
              )}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
};

ClientsPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Studio | Clients">
      <TitleLayout
        title="Clients"
        subtitle="View the clients of this federated graph"
      >
        {page}
      </TitleLayout>
    </PageHeader>,
  );

export default ClientsPage;
