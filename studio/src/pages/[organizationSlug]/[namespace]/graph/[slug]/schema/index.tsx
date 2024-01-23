import { FieldUsageSheet } from "@/components/analytics/field-usage";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useAnalyticsQueryState } from "@/components/analytics/useAnalyticsQueryState";
import {
  DatePickerWithRange,
  DateRangePickerChangeHandler,
} from "@/components/date-picker-with-range";
import {
  CommentCard,
  NewDiscussion,
} from "@/components/discussions/discussion";
import { ThreadSheet } from "@/components/discussions/thread";
import { EmptyState } from "@/components/empty-state";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import {
  SchemaSettings,
  hideDiscussionsKey,
  hideResolvedDiscussionsKey,
} from "@/components/schema/sdl-viewer";
import { SchemaToolbar } from "@/components/schema/toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Loader } from "@/components/ui/loader";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useUser } from "@/hooks/use-user";
import useWindowSize from "@/hooks/use-window-size";
import { useChartData } from "@/lib/insights-helpers";
import { NextPageWithLayout } from "@/lib/page";
import {
  GraphQLField,
  GraphQLTypeCategory,
  getCategoryDescription,
  getCategoryForType,
  getDeprecatedTypes,
  getRootDescription,
  getTypeCounts,
  getTypesByCategory,
  graphqlRootCategories,
  graphqlTypeCategories,
  mapGraphQLType,
  useParseSchema,
} from "@/lib/schema-helpers";
import { cn } from "@/lib/utils";
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import {
  ArrowRightIcon,
  CheckCircledIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getAllDiscussions,
  getFederatedGraphSDLByName,
  getFieldUsage,
  getOrganizationMembers,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { sentenceCase } from "change-case";
import { useCommandState } from "cmdk";
import { formatISO } from "date-fns";
import { GraphQLSchema } from "graphql";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  Dispatch,
  SetStateAction,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { PiChat } from "react-icons/pi";
import { Line, LineChart, ResponsiveContainer } from "recharts";

const TypeLink = ({
  name,
  ast,
  isHeading = false,
}: {
  name: string;
  ast: GraphQLSchema;
  isHeading?: boolean;
}) => {
  const router = useRouter();
  const cleanName = name.replace(/[\[\]!: ]/g, "");
  const category = getCategoryForType(ast, cleanName);
  const href =
    router.asPath.split("?")[0] + `?category=${category}&typename=${cleanName}`;

  return (
    <Link href={href}>
      <span
        className={cn(
          "font-semibold text-primary underline-offset-2 hover:underline",
          {
            "text-xl text-foreground": isHeading,
          },
        )}
      >
        {name}
      </span>
    </Link>
  );
};

const FieldUsageColumn = ({
  fieldName,
  typename,
}: {
  typename: string;
  fieldName: string;
}) => {
  const { range, dateRange } = useAnalyticsQueryState();
  const graph = useContext(GraphContext);

  const { data: usageData } = useQuery({
    ...getFieldUsage.useQuery({
      field: fieldName,
      typename,
      graphName: graph?.graph?.name,
      namespace: graph?.graph?.namespace,
      range: range,
      dateRange: {
        start: formatISO(dateRange.start),
        end: formatISO(dateRange.end),
      },
    }),
    enabled: !!graph?.graph?.name,
  });

  const { data } = useChartData(range, usageData?.requestSeries ?? []);

  if (!usageData) return null;

  return (
    <div className="h-8">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="totalRequests"
            animationDuration={300}
            animateNewValues={false}
            stroke="#0284C7"
            dot={false}
            strokeWidth={1.5}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

const Fields = (props: {
  typename: string;
  category: GraphQLTypeCategory;
  fields: GraphQLField[];
  ast: GraphQLSchema;
}) => {
  const router = useRouter();

  const hasArgs = props.fields.some((f) => !!f.args);
  const hasDetails = props.fields.some(
    (f) => !!f.description || !!f.deprecationReason,
  );
  const hasUsage = !(["scalars", "enums"] as GraphQLTypeCategory[]).includes(
    props.category,
  );

  const openUsage = (fieldName: string) => {
    const query: Record<string, string> = {};
    if (props.category === "unions") {
      query.showUsage = fieldName;
    } else {
      query.showUsage = `${props.typename || "Query"}.${fieldName}`;
    }

    router.replace({
      pathname: router.pathname,
      query: {
        ...router.query,
        ...query,
      },
    });
  };

  const parentRef = useRef<HTMLTableElement>(null);
  const count = props.fields.length;
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 300,
    measureElement:
      typeof window !== "undefined" &&
      navigator.userAgent.indexOf("Firefox") === -1
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
    overscan: 5,
  });
  const items = virtualizer.getVirtualItems();

  return (
    <TableWrapper ref={parentRef} className="max-h-full">
      <Table className="min-w-[1150px] lg:min-w-full">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead
              className={cn(
                "w-3/12",
                router.query.category !== "deprecated" && "w-4/12",
              )}
            >
              Field
            </TableHead>
            {(hasArgs || hasDetails) && (
              <TableHead
                className={cn(
                  "w-5/2",
                  router.query.category !== "deprecated" && "w-6/12",
                )}
              >
                Details
              </TableHead>
            )}
            {router.query.category === "deprecated" && (
              <TableHead className="w-2/12">Requests</TableHead>
            )}
            {hasUsage && <TableHead className="w-2/12" />}
          </TableRow>
        </TableHeader>
        <TableBody
          className="relative"
          style={{
            height: `${virtualizer.getTotalSize() + 1}px`,
          }}
        >
          {items.map((virtualRow) => {
            const field = props.fields[virtualRow.index];
            return (
              <TableRow
                className="group absolute flex w-full py-1 even:bg-secondary/20 hover:bg-secondary/40"
                key={virtualRow.index}
                data-index={virtualRow.index}
                ref={(node) => virtualizer.measureElement(node)}
                style={{
                  transform: `translateY(${virtualRow.start}px)`, // Should be in style prop
                }}
              >
                <TableCell
                  className={cn(
                    "my-1.5 w-3/12 flex-shrink-0 align-top font-semibold",
                    router.query.category !== "deprecated" && "w-4/12",
                  )}
                >
                  <p className="flex flex-wrap items-center gap-x-1 truncate">
                    {props.category !== "unions" ? (
                      <button
                        disabled={!hasUsage}
                        onClick={() => openUsage(field.name)}
                        className={cn(hasUsage && "hover:underline")}
                      >
                        {field.name}
                      </button>
                    ) : (
                      <TypeLink ast={props.ast} name={field.name} />
                    )}
                    {field.type && (
                      <TypeLink ast={props.ast} name={`: ${field.type}`} />
                    )}
                  </p>
                </TableCell>
                {(hasDetails || hasArgs) && (
                  <TableCell
                    className={cn(
                      "my-1.5 w-5/12",
                      router.query.category !== "deprecated" && "w-6/12",
                    )}
                  >
                    <div
                      className={cn("flex flex-col", {
                        "gap-y-4":
                          hasDetails && field.args && field.args.length > 0,
                      })}
                    >
                      {(!field.args || field.args?.length === 0) &&
                        !hasDetails && <span>-</span>}
                      {hasDetails && (
                        <div className="flex flex-col gap-y-4">
                          {field.description && (
                            <p className="text-muted-foreground group-hover:text-current">
                              {field.description}
                            </p>
                          )}
                          {field.deprecationReason && (
                            <p className="flex flex-col items-start gap-x-1">
                              <span className="flex items-center gap-x-1 font-semibold">
                                <ExclamationTriangleIcon className="h-3 w-3 flex-shrink-0" />
                                Deprecated
                              </span>{" "}
                              {field.deprecationReason}
                            </p>
                          )}
                        </div>
                      )}
                      {field.args && (
                        <div className="flex flex-col gap-y-2">
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
                                    <Badge variant="secondary">
                                      {arg.deprecationReason && (
                                        <ExclamationTriangleIcon className="mr-1 h-3 w-3 flex-shrink-0" />
                                      )}
                                      {arg.name}
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <div className="flex w-96 flex-col gap-y-4">
                                      {arg.description && (
                                        <p>{arg.description}</p>
                                      )}
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

                                <TypeLink
                                  ast={props.ast}
                                  name={`: ${arg.type}`}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </TableCell>
                )}
                {router.query.category === "deprecated" && (
                  <TableCell className="w-2/12 flex-shrink-0">
                    <FieldUsageColumn
                      fieldName={field.name}
                      typename={props.typename}
                    />
                  </TableCell>
                )}
                {hasUsage && (
                  <TableCell className="w-2/12 flex-shrink-0 text-right align-top">
                    <Button
                      onClick={() => openUsage(field.name)}
                      variant="ghost"
                      size="sm"
                      className="table-action"
                    >
                      View usage
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableWrapper>
  );
};

const TypeDiscussions = ({
  name,
  schemaVersionId,
  startLineNo,
  endLineNo,
}: {
  name: string;
  schemaVersionId: string;
  startLineNo: number;
  endLineNo: number;
}) => {
  const router = useRouter();
  const graphData = useContext(GraphContext);

  const [hideResolvedDiscussions] = useLocalStorage(
    hideResolvedDiscussionsKey,
    false,
  );

  const [newDiscussionLine, setNewDiscussionLine] = useState(-1);

  const applyParams = useApplyParams();

  const user = useUser();

  const { data, isLoading, error, refetch } = useQuery({
    ...getAllDiscussions.useQuery({
      targetId: graphData?.graph?.targetId,
      schemaVersionId,
    }),
  });

  const { data: membersData } = useQuery({
    ...getOrganizationMembers.useQuery(),
    queryKey: [
      user?.currentOrganization.slug || "",
      "GetOrganizationMembers",
      {},
    ],
  });

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title={`Could not retrieve discussions for ${name}`}
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  const discussions = data?.discussions
    .filter(
      (d) => d.referenceLine >= startLineNo && d.referenceLine <= endLineNo,
    )
    .filter((ld) => !(ld.isResolved && hideResolvedDiscussions));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between text-lg font-semibold">
        Discussions{" "}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setNewDiscussionLine(startLineNo)}
        >
          <PlusIcon className="mr-2" />
          New
        </Button>
      </div>
      {discussions.length === 0 && newDiscussionLine === -1 && (
        <EmptyState
          icon={<PiChat />}
          title="No discussions found"
          className="my-24 h-auto"
          description={`You can start a new one for type ${name}`}
        />
      )}
      {startLineNo &&
        graphData?.graph?.targetId &&
        newDiscussionLine !== -1 && (
          <div className="mt-4">
            <NewDiscussion
              className="w-auto px-0"
              lineNo={startLineNo}
              versionId={schemaVersionId}
              targetId={graphData.graph.targetId}
              setNewDiscussionLine={setNewDiscussionLine}
              placeholder={`Write something to discuss about \`${name}\``}
              refetch={() => refetch()}
            />
          </div>
        )}
      <div className="scrollbar-custom mt-4 flex h-full flex-col gap-y-4 overflow-y-auto">
        {discussions.map((ld) => {
          return (
            <div
              key={ld.id}
              className="flex h-auto w-full max-w-full flex-col rounded-md border pb-2 pt-4"
            >
              <CommentCard
                isOpeningComment
                discussionId={ld.id}
                comment={ld.openingComment!}
                author={membersData?.members.find(
                  (m) => m.userID === ld.openingComment?.createdBy,
                )}
                onUpdate={() => refetch()}
                onDelete={() => refetch()}
              />
              <Separator className="mb-2 mt-4" />

              <div className="mt-auto flex flex-wrap items-center gap-4 px-4">
                {ld.isResolved && (
                  <Badge variant="outline" className="gap-2 py-1.5">
                    <CheckCircledIcon className="h-4 w-4 text-success" />
                    <span>Resolved</span>
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  className="ml-auto w-max"
                  onClick={() => {
                    applyParams({
                      discussionId: ld.id,
                    });
                  }}
                >
                  View thread <ArrowRightIcon className="ml-2" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Type = (props: {
  name: string;
  category: GraphQLTypeCategory;
  description: string;
  interfaces?: string[];
  fields?: GraphQLField[];
  ast: GraphQLSchema;
  startLineNo?: number;
  endLineNo?: number;
  schemaVersionId: string;
}) => {
  const [hideDiscussions] = useLocalStorage(hideDiscussionsKey, false);

  const router = useRouter();

  const { isMobile } = useWindowSize();

  const showDiscussions =
    !!props.startLineNo && !!props.endLineNo && !isMobile && !hideDiscussions;

  const typeContent = (
    <div
      className={cn(
        "flex h-full flex-col",
        showDiscussions && "scrollbar-custom overflow-auto",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-x-4">
            <div className="flex flex-wrap items-center gap-x-2 text-lg font-semibold tracking-tight">
              <h3>{props.name}</h3>
              {props.interfaces && props.interfaces.length > 0 && (
                <div className="font-normal text-muted-foreground">
                  implements
                </div>
              )}
              {props.interfaces &&
                props.interfaces.map((t, index) => (
                  <div key={index} className="flex items-center gap-x-2">
                    <TypeLink ast={props.ast} name={t} isHeading />
                    {index !== props.interfaces!.length - 1 && (
                      <p className="font-normal text-muted-foreground">&</p>
                    )}
                  </div>
                ))}
            </div>
            <Badge className="w-max">
              <Link
                href={{
                  pathname: `/[organizationSlug]/[namespace]/graph/[slug]/schema`,
                  query: {
                    organizationSlug: router.query.organizationSlug,
                    namespace: router.query.namespace,
                    slug: router.query.slug,
                    category: props.category,
                  },
                }}
              >
                {props.category}
              </Link>
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {props.description || getRootDescription(props.name) || (
              <span className="italic">No description provided</span>
            )}
          </p>
        </div>
      </div>
      <div className="mt-6 h-4/5 flex-1">
        {props.fields && (
          <Fields
            typename={props.name}
            category={props.category}
            fields={props.fields}
            ast={props.ast}
          />
        )}
      </div>
    </div>
  );

  if (!showDiscussions) {
    return typeContent;
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="flex max-w-full">
      <ResizablePanel
        className={cn(showDiscussions && "pr-4")}
        minSize={35}
        defaultSize={isMobile ? 1000 : 65}
      >
        {typeContent}
      </ResizablePanel>
      {showDiscussions && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel className="pl-4" minSize={35} defaultSize={35}>
            <TypeDiscussions
              name={props.name}
              schemaVersionId={props.schemaVersionId}
              startLineNo={props.startLineNo!}
              endLineNo={props.endLineNo!}
            />
            <ThreadSheet schemaVersionId={props.schemaVersionId} />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
};

const TypeWrapper = ({
  ast,
  schemaVersionId,
}: {
  ast: GraphQLSchema;
  schemaVersionId: string;
}) => {
  const router = useRouter();

  const category = router.query.category as GraphQLTypeCategory;
  const typename = router.query.typename as string;
  const list = getTypesByCategory(ast, category);

  const parentRef = useRef<HTMLTableElement>(null);
  const count = list.length;
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    measureElement:
      typeof window !== "undefined" &&
      navigator.userAgent.indexOf("Firefox") === -1
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
    overscan: 5,
  });
  const items = virtualizer.getVirtualItems();

  if (category && !typename) {
    const openUsage = (type: string) => {
      router.replace({
        pathname: router.pathname,
        query: {
          ...router.query,
          showUsage: type,
          isNamedType: category !== "objects",
        },
      });
    };

    if (list.length === 0) {
      return (
        <EmptyState
          icon={<InformationCircleIcon />}
          title="No data found"
          description="There is no data for this type or category. Please adjust your filters."
        />
      );
    }

    return (
      <div className="mt-2 flex h-[90%] flex-col">
        <h3 className="text-lg font-semibold tracking-tight">
          {sentenceCase(category)}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {getCategoryDescription(category)}
        </p>
        <div className="mt-6 h-full">
          <TableWrapper ref={parentRef} className="max-h-full">
            <Table className="min-w-[1150px] lg:min-w-full">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow className="">
                  <TableHead className="w-4/12">Type</TableHead>
                  <TableHead className="w-5/12">Description</TableHead>
                  <TableHead className="w-3/12" />
                </TableRow>
              </TableHeader>
              <TableBody
                className="relative"
                style={{
                  height: `${virtualizer.getTotalSize() + 1}px`,
                }}
              >
                {items.map((virtualRow) => {
                  const l = list[virtualRow.index];
                  return (
                    <TableRow
                      className="group absolute flex w-full py-1 even:bg-secondary/20 hover:bg-secondary/40"
                      key={virtualRow.index}
                      data-index={virtualRow.index}
                      ref={(node) => virtualizer.measureElement(node)}
                      style={{
                        transform: `translateY(${virtualRow.start}px)`, // Should be in style prop
                      }}
                    >
                      <TableCell className="my-1.5 w-4/12 flex-shrink-0 truncate">
                        <TypeLink ast={ast} name={l.name} />
                      </TableCell>
                      <TableCell className="my-1.5 w-5/12 text-muted-foreground group-hover:text-current">
                        {l.description || "-"}
                      </TableCell>
                      <TableCell className="w-3/12 flex-shrink-0 text-right align-top">
                        <Button
                          onClick={() => openUsage(l.name)}
                          variant="ghost"
                          size="sm"
                          className="table-action"
                        >
                          View usage
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableWrapper>
        </div>
      </div>
    );
  }

  const astType = ast.getType(typename || "Query");

  if (!astType) {
    return (
      <EmptyState
        icon={<InformationCircleIcon />}
        title="No data found"
        description="There is no data for this type or category. Please adjust your filters."
      />
    );
  }

  const type = mapGraphQLType(astType);

  return (
    <div className="h-full flex-1 pt-2">
      <Type
        name={type.name}
        category={type.category}
        description={type.description}
        interfaces={type.interfaces}
        fields={type.fields}
        startLineNo={type.loc?.startToken.line}
        endLineNo={type.loc?.endToken.line}
        schemaVersionId={schemaVersionId}
        ast={ast}
      />
    </div>
  );
};

const SearchDescription = ({ ast }: { ast: GraphQLSchema }) => {
  const activeValue = useCommandState((state) => state.value);

  if (!activeValue) {
    return null;
  }

  const [category, index, _] = activeValue?.split("-");
  const types = getTypesByCategory(ast, category as any);
  const type = types[Number(index)];

  return (
    <div className="hidden w-64 flex-shrink-0 flex-col p-4 md:flex">
      <Badge className="w-max">{category}</Badge>
      <p className="mt-4 break-words text-sm text-muted-foreground">
        {type.description || (
          <span className="italic">No description provided</span>
        )}
      </p>
    </div>
  );
};

const SearchType = ({
  ast,
  open,
  setOpen,
}: {
  ast: GraphQLSchema;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}) => {
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [setOpen]);

  const counts = getTypeCounts(ast);

  return (
    <CommandDialog
      commandProps={{
        loop: true,
      }}
      className="max-w-2xl"
      open={open}
      onOpenChange={setOpen}
    >
      <CommandInput placeholder="Search for a type" />
      <div className="flex divide-x">
        <CommandList className="scrollbar-custom w-full">
          <CommandEmpty>No results found.</CommandEmpty>
          {graphqlTypeCategories.map((category) => {
            if (counts[category] === 0) {
              return null;
            }

            const types = getTypesByCategory(ast, category);

            return (
              <CommandGroup key={category} heading={sentenceCase(category)}>
                {types.map((t, i) => {
                  return (
                    <CommandItem
                      onSelect={() => {
                        const newQuery = { ...router.query };
                        newQuery.category = category;
                        newQuery.typename = t.name;
                        setOpen(false);
                        router.push({
                          query: newQuery,
                        });
                      }}
                      key={t.name}
                      value={`${category}-${i}-${t}`}
                      className="subpixel-antialiased"
                    >
                      {t.name}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            );
          })}
        </CommandList>
        <SearchDescription ast={ast} />
      </div>
    </CommandDialog>
  );
};

const Toolbar = ({ ast }: { ast: GraphQLSchema | null }) => {
  const router = useRouter();
  const selectedCategory = (router.query.category as string) ?? "query";
  const [open, setOpen] = useState(false);

  const typeCounts = ast ? getTypeCounts(ast) : undefined;

  const applyParams = useApplyParams();
  const { range, dateRange } = useAnalyticsQueryState();
  const onDateRangeChange: DateRangePickerChangeHandler = ({
    range,
    dateRange,
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

  return (
    <SchemaToolbar tab="explorer">
      <div className="hidden md:ml-auto md:block" />
      {ast && (
        <>
          <SearchType ast={ast} open={open} setOpen={setOpen} />
          <Button
            onClick={() => setOpen(true)}
            variant="outline"
            className="gap-x-2 text-muted-foreground shadow-none"
          >
            <MagnifyingGlassIcon />
            Search <Kbd>Cmd K</Kbd>
          </Button>
        </>
      )}
      <Select
        value={selectedCategory}
        onValueChange={(category) => {
          const newQuery = { ...router.query };
          newQuery.category = category;
          if (graphqlRootCategories.includes(category as any)) {
            newQuery.typename = sentenceCase(category);
          } else {
            delete newQuery["typename"];
          }

          router.push({
            query: newQuery,
          });
        }}
      >
        <SelectTrigger className="flex-1 md:w-[200px] md:flex-none xl:hidden">
          <SelectValue aria-label={selectedCategory}>
            {sentenceCase(selectedCategory)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {graphqlRootCategories.map((category) => (
              <SelectItem key={category} value={category}>
                {sentenceCase(category)}
                {typeCounts && (
                  <Badge variant="secondary" className="ml-2">
                    {typeCounts[category]}
                  </Badge>
                )}
              </SelectItem>
            ))}
          </SelectGroup>
          <Separator className="my-2" />
          <SelectGroup>
            {graphqlTypeCategories.map((gType) => {
              return (
                <SelectItem key={gType} value={gType}>
                  <span>{sentenceCase(gType)}</span>
                  {typeCounts && (
                    <Badge variant="secondary" className="ml-2">
                      {typeCounts[gType]}
                    </Badge>
                  )}
                </SelectItem>
              );
            })}
          </SelectGroup>
          <Separator className="my-2" />
          <SelectGroup>
            <SelectItem value="deprecated">
              <span>Deprecated</span>
              {typeCounts && ast && (
                <Badge variant="secondary" className="ml-2">
                  {getDeprecatedTypes(ast).length}
                </Badge>
              )}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {selectedCategory === "deprecated" && (
        <DatePickerWithRange
          range={range}
          dateRange={dateRange}
          onChange={onDateRangeChange}
          calendarDaysLimit={90}
        />
      )}
      <SchemaSettings />
    </SchemaToolbar>
  );
};

const DeprecatedTypes = ({ ast }: { ast: GraphQLSchema }) => {
  const types = getDeprecatedTypes(ast);

  if (types.length === 0) {
    return (
      <EmptyState
        icon={<InformationCircleIcon />}
        title="No deprecated fields found"
        description="You can view all deprecated fields or fields with deprecated arguments here"
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-y-12 divide-y">
      {types.map((type) => {
        return (
          <div key={type.name} className="h-2/3 pt-12 first:pt-2">
            <Type
              name={type.name}
              category={type.category}
              description={type.description}
              interfaces={type.interfaces}
              fields={type.fields}
              startLineNo={type.loc?.startToken.line}
              endLineNo={type.loc?.endToken.line}
              schemaVersionId={""}
              ast={ast}
            />
          </div>
        );
      })}
    </div>
  );
};

const SchemaExplorerPage: NextPageWithLayout = () => {
  const router = useRouter();

  const organizationSlug = router.query.organizationSlug as string;
  const namespace = router.query.namespace as string;
  const graphName = router.query.slug as string;
  const selectedCategory = (router.query.category as string) ?? "query";
  const typename = router.query.typename as string;

  const { data, isLoading, error, refetch } = useQuery(
    getFederatedGraphSDLByName.useQuery({
      name: graphName,
      namespace,
    }),
  );

  const { ast, isParsing } = useParseSchema(data?.sdl);

  const isLoadingAST = isLoading || isParsing;

  const typeCounts = ast ? getTypeCounts(ast) : undefined;

  let title = "Schema";
  let breadcrumbs = [];
  if (selectedCategory) {
    title = sentenceCase(selectedCategory);
    breadcrumbs.push(
      <Link
        href={`/${organizationSlug}/${namespace}/graph/${graphName}/schema`}
      >
        Schema
      </Link>,
    );
  }

  if (typename && typename.toLowerCase() !== selectedCategory) {
    title = sentenceCase(typename);
    if (selectedCategory) {
      breadcrumbs.push(
        <Link
          href={`/${organizationSlug}/${namespace}/graph/${graphName}/schema?category=${selectedCategory}`}
        >
          {sentenceCase(selectedCategory)}
        </Link>,
      );
    }
  }

  return (
    <GraphPageLayout
      title={title}
      breadcrumbs={breadcrumbs}
      subtitle="Explore schema and field level metrics of your federated graph"
      toolbar={<Toolbar ast={ast} />}
      noPadding
    >
      <div className="flex h-full flex-row">
        <div className="hidden h-full min-w-[200px] max-w-[240px] overflow-y-auto border-r py-2 scrollbar-thin xl:block">
          <div className="flex flex-col items-stretch gap-2 px-4 py-4 lg:px-6 xl:px-8">
            {graphqlRootCategories.map((category) => (
              <Button
                key={category}
                asChild
                variant="ghost"
                className={cn("justify-start px-3", {
                  "bg-accent text-accent-foreground":
                    selectedCategory === category,
                })}
              >
                <Link
                  className="gap-x-4"
                  href={`/${organizationSlug}/${namespace}/graph/${graphName}/schema?category=${category}&typename=${sentenceCase(
                    category,
                  )}`}
                >
                  {sentenceCase(category)}
                  {typeCounts && (
                    <Badge
                      variant="secondary"
                      className="ml-auto bg-accent/50 px-1.5"
                    >
                      {typeCounts[category]}
                    </Badge>
                  )}
                </Link>
              </Button>
            ))}
          </div>
          <Separator className="my-2" />
          <div className="flex flex-col items-stretch gap-2 px-4 py-4 lg:px-8">
            {graphqlTypeCategories.map((gType) => {
              return (
                <Button
                  key={gType}
                  asChild
                  variant="ghost"
                  className={cn("justify-start px-3", {
                    "bg-accent text-accent-foreground":
                      selectedCategory === gType,
                  })}
                >
                  <Link
                    href={`/${organizationSlug}/${namespace}/graph/${graphName}/schema?category=${gType}`}
                  >
                    <span>{sentenceCase(gType)}</span>
                    {typeCounts && (
                      <Badge
                        variant="secondary"
                        className="ml-auto bg-accent/50 px-1.5"
                      >
                        {typeCounts[gType]}
                      </Badge>
                    )}
                  </Link>
                </Button>
              );
            })}
          </div>
          <Separator className="my-2" />
          <div className="flex flex-col items-stretch gap-2 px-4 py-4 lg:px-8">
            <Button
              asChild
              variant="ghost"
              className={cn("justify-start px-3", {
                "bg-accent text-accent-foreground":
                  selectedCategory === "deprecated",
              })}
            >
              <Link
                href={`/${organizationSlug}/${namespace}/graph/${graphName}/schema?category=deprecated`}
              >
                <span>Deprecated</span>
                {typeCounts && ast && (
                  <Badge
                    variant="secondary"
                    className="ml-auto bg-accent/50 px-1.5"
                  >
                    {getDeprecatedTypes(ast).length}
                  </Badge>
                )}
              </Link>
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 scrollbar-thin lg:px-8">
          {isLoadingAST && <Loader fullscreen />}
          {!isLoadingAST &&
            (error || data?.response?.code !== EnumStatusCode.OK || !ast) && (
              <EmptyState
                icon={<ExclamationTriangleIcon />}
                title="Could not retrieve schema"
                description={
                  data?.response?.details ||
                  error?.message ||
                  "Please try again. The schema might be invalid or does not exist"
                }
                actions={<Button onClick={() => refetch()}>Retry</Button>}
              />
            )}
          {ast && selectedCategory === "deprecated" && (
            <DeprecatedTypes ast={ast} />
          )}
          {ast && selectedCategory !== "deprecated" && (
            <TypeWrapper ast={ast} schemaVersionId={data?.versionId ?? ""} />
          )}
          <FieldUsageSheet />
        </div>
      </div>
    </GraphPageLayout>
  );
};

SchemaExplorerPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Schema Explorer",
  });

export default SchemaExplorerPage;
