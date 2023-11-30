import { UserContext } from "@/components/app-provider";
import { EmptyState } from "@/components/empty-state";
import { getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { Button } from "@/components/ui/button";
import { CLI } from "@/components/ui/cli";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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
import { useToast } from "@/components/ui/use-toast";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { docsBaseURL } from "@/lib/constants";
import { NextPageWithLayout } from "@/lib/page";
import { checkUserAccess, cn } from "@/lib/utils";
import { CommandLineIcon } from "@heroicons/react/24/outline";
import { ExclamationTriangleIcon, PlusIcon } from "@radix-ui/react-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getClients,
  publishPersistedOperations,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext, useState } from "react";
import { BiAnalyse } from "react-icons/bi";
import { IoBarcodeSharp } from "react-icons/io5";
import { z } from "zod";

const FormSchema = z.object({
  clientName: z.string().trim().min(1, "The name cannot be empty"),
});

type Input = z.infer<typeof FormSchema>;

const CreateClient = ({ refresh }: { refresh: () => void }) => {
  const router = useRouter();
  const slug = router.query.slug as string;
  const [isOpen, setIsOpen] = useState(false);

  const { toast } = useToast();

  const form = useZodForm<Input>({
    schema: FormSchema,
  });

  const { mutate, isPending } = useMutation({
    ...publishPersistedOperations.useMutation(),
    onSuccess(data) {
      if (data.response?.code !== EnumStatusCode.OK) {
        toast({
          variant: "destructive",
          title: "Could not create client",
          description: data.response?.details ?? "Please try again",
        });
        return;
      }

      toast({
        title: "Client created successfully",
      });

      form.setValue("clientName", "");
      refresh();
      setIsOpen(false);
    },
  });

  const onSubmit: SubmitHandler<Input> = (formData) => {
    mutate({
      fedGraphName: slug,
      clientName: formData.clientName,
      operations: [],
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon className="mr-2" />
          Create Client
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Client</DialogTitle>
          <DialogDescription>
            Create a new client to store persisted operations by providing a
            name
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <FormField
                control={form.control}
                name="clientName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter new client name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                disabled={!form.formState.isValid}
                className="w-full"
                type="submit"
              >
                Submit
              </Button>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ClientsPage: NextPageWithLayout = () => {
  const user = useContext(UserContext);
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
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <p className="text-sm text-muted-foreground">
              Create and view clients to which you can publish persisted
              operations.{" "}
              <Link
                href={docsBaseURL + "/router/persisted-operations"}
                className="text-primary"
                target="_blank"
                rel="noreferrer"
              >
                Learn more
              </Link>
            </p>
            {checkUserAccess({
              rolesToBe: ["admin", "developer"],
              userRoles: user?.currentOrganization.roles || [],
            }) && <CreateClient refresh={() => refetch()} />}
          </div>

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
                            <Button variant="secondary" size="icon-sm">
                              <Link href={constructLink(name, "metrics")}>
                                <BiAnalyse />
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Metrics</TooltipContent>
                        </Tooltip>
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger>
                            <Button variant="secondary" size="icon-sm">
                              <Link href={constructLink(name, "traces")}>
                                <IoBarcodeSharp />
                              </Link>
                            </Button>
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
