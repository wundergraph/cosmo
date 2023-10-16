import { EmptyState } from "@/components/empty-state";
import { getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { SchemaToolbar } from "@/components/schema/toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
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
import { NextPageWithLayout } from "@/lib/page";
import { GraphQLField, parseSchema } from "@/lib/schemaParser";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getFederatedGraphSDLByName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";

const Fields = (props: { fields: GraphQLField[] }) => {
  return (
    <Table className="min-w-[1100px]">
      <TableHeader>
        <TableRow>
          <TableHead className="w-3/12">Field</TableHead>
          <TableHead className="w-4/12">Input</TableHead>
          <TableHead className="w-2/12">Requests</TableHead>
          <TableHead className="w-1/12">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.fields.map((field) => (
          <TableRow
            className="py-1 even:bg-secondary/30 hover:bg-transparent even:hover:bg-secondary/30"
            key={field.name}
          >
            <TableCell className="align-top font-semibold">
              <p className="mt-2 flex flex-wrap items-center gap-x-1">
                <span>{field.name}</span>
                <span className="text-muted-foreground">: {field.type}</span>
              </p>
            </TableCell>
            <TableCell className="flex flex-col gap-y-2 py-4">
              {field.args.length === 0 && <span>-</span>}
              {field.args.map((arg) => {
                return (
                  <div
                    key={arg.name}
                    className="flex flex-wrap items-center gap-x-1"
                  >
                    <Tooltip
                      delayDuration={200}
                      open={
                        !arg.description && !arg.deprecationReason
                          ? false
                          : undefined
                      }
                    >
                      <TooltipTrigger>
                        <Badge variant="secondary">{arg.name}</Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="flex w-96 flex-col gap-y-4">
                          {arg.description && <p>{arg.description}</p>}
                          {arg.deprecationReason && (
                            <p className="flex flex-col items-start gap-x-1">
                              <span className="flex items-center gap-x-1 font-semibold">
                                <ExclamationTriangleIcon className="h-3 w-3 flex-shrink-0" />
                                Deprecated
                              </span>{" "}
                              {arg.deprecationReason}
                            </p>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                    <span className="font-semibold text-muted-foreground">
                      : {arg.type}
                    </span>
                  </div>
                );
              })}
            </TableCell>
            <TableCell></TableCell>
            <TableCell className="align-top text-primary">
              <Link href={`#`}>
                <p className="mt-2">View Usage</p>
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const Type = (props: {
  name: string;
  kind: string;
  description: string;
  interfaces: string[];
  fields: GraphQLField[];
}) => {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-x-4">
        <div className="flex items-center gap-x-2 text-xl font-semibold tracking-tight">
          <h3 className="">{props.name}</h3>
          {props.interfaces.length > 0 && (
            <div className="font-normal text-muted-foreground">implements</div>
          )}
          {props.interfaces.map((t, index) => (
            <>
              <p key={index}>{t}</p>
              {index !== props.interfaces.length - 1 && (
                <p className="font-normal text-muted-foreground">&</p>
              )}
            </>
          ))}
        </div>
        <Badge className="w-max">{props.kind}</Badge>
      </div>
      <p>{props.description}</p>
      <div className="mt-6">
        <Fields fields={props.fields} />
      </div>
    </div>
  );
};

const SchemaExplorerPage: NextPageWithLayout = () => {
  const router = useRouter();
  const graphName = router.query.slug as string;

  const { data, isLoading, error, refetch } = useQuery(
    getFederatedGraphSDLByName.useQuery({
      name: graphName,
    })
  );

  const [selected, setSelected] = useState("Query");

  if (isLoading) {
    return <Loader fullscreen />;
  }

  if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        className="order-2 h-72 border lg:order-last"
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve schema"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  const { ast, query, mutation, subscription } = parseSchema(data.sdl ?? "");

  return (
    <div className="mt-2 flex-1">
      {query && (
        <Type
          name={query.name}
          kind={query.kind}
          description={query.description}
          interfaces={query.interfaces}
          fields={query.fields}
        />
      )}
    </div>
  );
};

SchemaExplorerPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Studio | SDL">
      <TitleLayout
        title="Schema Explorer"
        subtitle="Explore schema and field level metrics of your federated graph"
        toolbar={<SchemaToolbar tab="explorer" />}
      >
        {page}
      </TitleLayout>
    </PageHeader>
  );

export default SchemaExplorerPage;
