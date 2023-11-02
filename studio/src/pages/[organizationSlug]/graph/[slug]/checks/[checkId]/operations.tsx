import { FieldUsageSheet } from "@/components/analytics/field-usage";
import { ChangesTable } from "@/components/checks/changes-table";
import { ChecksToolbar } from "@/components/checks/toolbar";
import { EmptyState } from "@/components/empty-state";
import { GraphContext, getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { SchemaViewer } from "@/components/schema-viewer";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { useToast } from "@/components/ui/use-toast";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { Cross1Icon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getCheckOperations,
  getOperationContent,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import copy from "copy-to-clipboard";
import Fuse from "fuse.js";
import { useRouter } from "next/router";
import graphQLPlugin from "prettier/plugins/graphql";
import * as prettier from "prettier/standalone";
import { useContext, useEffect, useState } from "react";

const OperationContent = ({
  hash,
  enabled,
}: {
  hash: string;
  enabled: boolean;
}) => {
  const [content, setContent] = useState("");

  const { data, error, isLoading, refetch } = useQuery({
    ...getOperationContent.useQuery({
      hash,
    }),
    enabled,
  });

  useEffect(() => {
    const set = async (source: string) => {
      const res = await prettier.format(source, {
        parser: "graphql",
        plugins: [graphQLPlugin],
      });
      setContent(res);
    };

    if (!data) return;
    set(data.operationContent);
  }, [data]);

  if (isLoading) {
    return (
      <div className="h-96">
        <Loader fullscreen />
      </div>
    );
  }

  if (error)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve content"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  return (
    <div className="scrollbar-custom h-[50vh] overflow-auto rounded border">
      <SchemaViewer sdl={content} disableLinking />
    </div>
  );
};

const OperationContentDialog = ({ hash }: { hash: string }) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(val) => setOpen(val)}>
      <DialogTrigger asChild>
        <Button size="sm" className="flex-1 md:flex-none" variant="secondary">
          View Operation Content
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Operation Content</DialogTitle>
        </DialogHeader>
        <OperationContent hash={hash} enabled={open} />
      </DialogContent>
    </Dialog>
  );
};

const CheckOperationsPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();
  const { toast } = useToast();

  const id = router.query.checkId as string;

  const { data, isLoading, error, refetch } = useQuery({
    ...getCheckOperations.useQuery({
      checkId: id,
      graphName: graphContext?.graph?.name,
    }),
    enabled: !!graphContext?.graph?.name,
  });

  const [search, setSearch] = useState(router.query.search as string);

  const applyParams = (search: string) => {
    const query = { ...router.query };
    query.search = search;

    if (!search) {
      delete query.search;
    }

    router.replace({
      query,
    });
  };

  const copyLink = (hash: string) => {
    const [base, _] = window.location.href.split("?");
    const link = base + `?search=${hash}`;
    copy(link);
    toast({ description: "Copied link to clipboard" });
  };

  if (isLoading) return <Loader fullscreen />;

  if (error || data.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve affected operations"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  if (data.operations.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircleIcon className="text-success" />}
        title="Operations Check Successful"
        description="There are no operations that are affected by the proposed changes"
      />
    );
  }

  const fuse = new Fuse(data.operations, {
    keys: ["hash", "name"],
    minMatchCharLength: 1,
  });

  const filteredOperations = search
    ? fuse.search(search).map(({ item }) => item)
    : data.operations;

  return (
    <div>
      <div className="relative">
        <MagnifyingGlassIcon className="absolute bottom-0 left-3 top-0 my-auto" />
        <Input
          placeholder="Search by hash or name"
          className="pl-8 pr-10"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            applyParams(e.target.value);
          }}
        />
        {search && (
          <Button
            variant="ghost"
            className="absolute bottom-0 right-0 top-0 my-auto rounded-l-none"
            onClick={() => {
              setSearch("");
              applyParams("");
            }}
          >
            <Cross1Icon />
          </Button>
        )}
      </div>
      <Accordion type="single" collapsible className="mt-4 w-full">
        {filteredOperations.map(
          ({ hash, name, type, firstSeenAt, lastSeenAt, impactingChanges }) => {
            return (
              <AccordionItem id={hash} key={hash} value={hash}>
                <AccordionTrigger className="px-2 hover:bg-secondary/30 hover:no-underline">
                  <div className="flex flex-1 items-center gap-2">
                    <p className="w-16 text-start text-muted-foreground">
                      {hash.slice(0, 6)}
                    </p>
                    <p>{name}</p>
                    <Badge className="!inline-block !decoration-[none]">
                      {type}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-col gap-y-6 px-2">
                    <p className="text-muted-foreground">
                      First seen at {formatDateTime(new Date(firstSeenAt))} and
                      last seen at {formatDateTime(new Date(lastSeenAt))}
                    </p>
                    <ChangesTable
                      changes={impactingChanges}
                      caption={
                        <>
                          {impactingChanges.length} Impacting Change
                          {impactingChanges.length === 1 ? "" : "s"}
                        </>
                      }
                    />
                    <div className="justify-s flex items-center gap-x-2">
                      <OperationContentDialog hash={hash} />
                      <Button
                        size="sm"
                        className="flex-1 md:flex-none"
                        variant="secondary"
                        onClick={() => copyLink(hash)}
                      >
                        Share link
                      </Button>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          },
        )}
      </Accordion>
      <FieldUsageSheet />
    </div>
  );
};

CheckOperationsPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Studio | Checks">
      <TitleLayout
        title="Check Operations"
        subtitle="View all affected operations for this check run"
        toolbar={<ChecksToolbar tab="operations" />}
      >
        {page}
      </TitleLayout>
    </PageHeader>,
  );

export default CheckOperationsPage;
