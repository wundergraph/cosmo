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
import { EmptySchema } from "@/components/schema/empty-schema-state";
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
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useSessionStorage } from "@/hooks/use-session-storage";
import { useUser } from "@/hooks/use-user";
import useWindowSize from "@/hooks/use-window-size";
import { useChartData } from "@/lib/insights-helpers";
import { NextPageWithLayout } from "@/lib/page";
import {
  FieldMatch,
  GraphQLTypeCategory,
  ParsedGraphQLField,
  getAllFields,
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
  ChevronUpDownIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import {
  ArrowRightIcon,
  CheckCircledIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import { useQuery } from "@connectrpc/connect-query";
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
import { GraphQLSchema, buildASTSchema, parse } from "graphql";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  Dispatch,
  SetStateAction,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { PiChat, PiGraphLight } from "react-icons/pi";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MdOutlineFeaturedPlayList } from "react-icons/md";

const fallback = buildASTSchema(parse(`type Query { dummy: String! }`));

const ExplorerContext = createContext<{
  schemaVersionId: string;
  ast: GraphQLSchema;
}>({
  schemaVersionId: "",
  ast: fallback,
});

const TypeLink = ({
  name,
  isHeading = false,
}: {
  name: string;
  isHeading?: boolean;
}) => {
  const { ast } = useContext(ExplorerContext);

  const router = useRouter();
  const cleanName = name.replace(/[\[\]!: ]/g, "");
  const category = getCategoryForType(ast, cleanName);

  if (!category) {
    return;
  }

  return (
    <Link
      href={{
        pathname: `${router.pathname}`,
        query: {
          ...router.query,
          category,
          typename: cleanName,
        },
      }}
    >
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
  const router = useRouter();
  const featureFlagName = router.query.featureFlag as string;

  const { data: usageData } = useQuery(
    getFieldUsage,
    {
      field: fieldName,
      typename,
      graphName: graph?.graph?.name,
      namespace: graph?.graph?.namespace,
      range: range,
      dateRange: {
        start: formatISO(dateRange.start),
        end: formatISO(dateRange.end),
      },
      featureFlagName,
    },
    {
      enabled: !!graph?.graph?.name,
    },
  );

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
  fields: ParsedGraphQLField[];
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

  const fieldName = router.query.fieldName as string;

  const [scrolledField, setScrolledField] = useState<string>();
  useEffect(() => {
    if (scrolledField === fieldName) {
      return;
    }

    if (!fieldName) {
      setScrolledField(undefined);
      return;
    }

    const index = props.fields.findIndex((f) => f.name === fieldName);
    if (index === -1) return;

    const offset = items[index]?.start + 150;
    if (!offset) return;

    virtualizer.scrollToOffset(offset, {
      align: "end",
    });

    setScrolledField(fieldName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldName, props.fields, virtualizer]);

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
            {hasUsage && <TableHead />}
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
                      <TypeLink name={field.name} />
                    )}
                    {field.type && <TypeLink name={`: ${field.type}`} />}
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

                                <TypeLink name={`: ${arg.type}`} />
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
                  <TableCell className="flex-shrink-0 text-right align-top">
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
  startLineNo,
  endLineNo,
}: {
  name: string;
  startLineNo: number;
  endLineNo: number;
}) => {
  const router = useRouter();
  const graphData = useContext(GraphContext);
  const { schemaVersionId } = useContext(ExplorerContext);

  const [hideResolvedDiscussions] = useLocalStorage(
    hideResolvedDiscussionsKey,
    false,
  );

  const [newDiscussionLine, setNewDiscussionLine] = useState(-1);

  const applyParams = useApplyParams();

  const { data, isLoading, error, refetch } = useQuery(
    getAllDiscussions,
    {
      targetId: graphData?.graph?.targetId,
      schemaVersionId,
    },
    { enabled: !!graphData?.graph?.targetId },
  );

  const { data: membersData } = useQuery(getOrganizationMembers);

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
  fields?: ParsedGraphQLField[];
  startLineNo?: number;
  endLineNo?: number;
}) => {
  const [hideDiscussions] = useLocalStorage(hideDiscussionsKey, false);

  const router = useRouter();

  const { isMobile } = useWindowSize();

  const { schemaVersionId } = useContext(ExplorerContext);

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
                    <TypeLink name={t} isHeading />
                    {index !== props.interfaces!.length - 1 && (
                      <p className="font-normal text-muted-foreground">&</p>
                    )}
                  </div>
                ))}
            </div>
            <Badge className="w-max">
              <Link
                href={{
                  pathname: `${router.pathname}`,
                  query: {
                    ...router.query,
                    category: props.category,
                    typename: undefined,
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
            {router.query.schemaType === "client" ? (
              <EmptyState
                icon={<PiChat />}
                title="Cannot start discussions here"
                className="my-24 h-auto"
                description={`Discussions can only be started on the router schema`}
              />
            ) : (
              <>
                <TypeDiscussions
                  name={props.name}
                  startLineNo={props.startLineNo!}
                  endLineNo={props.endLineNo!}
                />
                <ThreadSheet schemaVersionId={schemaVersionId} />
              </>
            )}
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
};

const TypeWrapper = ({
  typename,
  category,
}: {
  typename: string;
  category: GraphQLTypeCategory;
}) => {
  const router = useRouter();

  const { ast } = useContext(ExplorerContext);

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
                        <TypeLink name={l.name} />
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
      />
    </div>
  );
};

const SearchDescription = ({ allFields }: { allFields: FieldMatch[] }) => {
  const activeValue = useCommandState((state) => state.value);
  const { ast } = useContext(ExplorerContext);

  if (!activeValue) {
    return null;
  }

  const [category, index, _] = activeValue?.split("-");
  const types = getTypesByCategory(ast, category as any);
  const type = types[Number(index)];

  const [fieldIndex, fieldType, fieldName] = activeValue
    ?.split(".")
    ?.map((v) => v.trim());
  const field = allFields[Number(fieldIndex)]?.field;

  return (
    <div className="hidden w-64 flex-shrink-0 flex-col p-4 md:flex">
      {type ? (
        <>
          <Badge className="w-max">{category}</Badge>
          <p className="mt-4 break-words text-sm text-muted-foreground">
            {type.description || (
              <span className="italic">No description provided</span>
            )}
          </p>
        </>
      ) : field ? (
        <div>
          <div className="flex flex-col gap-y-4 text-sm">
            <p className="break-words text-muted-foreground">
              {field.description || (
                <span className="italic">No description provided</span>
              )}
            </p>
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
        </div>
      ) : (
        <div className="text-sm italic text-muted-foreground">
          No info available
        </div>
      )}
    </div>
  );
};

const SearchType = ({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}) => {
  const router = useRouter();
  const { ast } = useContext(ExplorerContext);

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

  const allFields = getAllFields(ast);

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
          <CommandGroup heading="Fields">
            {allFields.map((f, i) => {
              return (
                <CommandItem
                  onSelect={() => {
                    const newQuery = { ...router.query };
                    newQuery.category = getCategoryForType(
                      ast,
                      f.type.name,
                    ) as string;
                    newQuery.typename = f.type.name;
                    newQuery.fieldName = f.field.name;
                    setOpen(false);
                    router.push({
                      query: newQuery,
                    });
                  }}
                  key={f.field.name}
                  value={`${i} . ${f.type.name} . ${f.field.name}`}
                  className="subpixel-antialiased"
                >
                  <span className="text-primary">{f.type.name}</span>.
                  {f.field.name}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
        <SearchDescription allFields={allFields} />
      </div>
    </CommandDialog>
  );
};

export const GraphSelector = () => {
  const graphData = useContext(GraphContext);
  const router = useRouter();
  const activeFeatureFlag = router.query.featureFlag as string;
  const graphName = router.query.slug as string;
  const schemaType = router.query.schemaType as string;

  const fullPath = router.asPath;
  const pathWithHash = fullPath.split("?")[0];
  const pathname = pathWithHash.split("#")[0];

  const applyParams = useApplyParams();
  const featureFlags =
    graphData?.featureFlagsInLatestValidComposition.map((each) => {
      return {
        name: each.name,
        query: `?featureFlag=${each.name}`,
      };
    }) ?? [];

  const activeGraphWithSDL = {
    title: activeFeatureFlag || graphName,
    targetId: graphData?.graph?.targetId ?? "",
    routingUrl: graphData?.graph?.routingURL ?? "",
  };

  if (featureFlags.length > 0) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          value={activeGraphWithSDL.title}
          className="w-full md:ml-auto md:w-max md:min-w-[200px]"
          asChild
        >
          <div className="flex items-center justify-center">
            <Button
              className="flex w-[220px] text-sm"
              variant="outline"
              asChild
            >
              <div className="flex justify-between">
                <div className="flex">
                  <p className="max-w-[120px] truncate">
                    {activeGraphWithSDL.title}
                  </p>
                  <Badge variant="secondary" className="ml-2">
                    {schemaType === "router" ? "router" : "client"}
                  </Badge>
                </div>
                <ChevronUpDownIcon className="h-4 w-4" />
              </div>
            </Button>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-[220px]">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
              <PiGraphLight className="h-3 w-3" /> Graph
            </DropdownMenuLabel>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {graphData?.graph?.name}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    onValueChange={(query) => router.push(pathname + query)}
                    value={`${
                      !activeFeatureFlag
                        ? `?schemaType=${schemaType}`
                        : undefined
                    }`}
                  >
                    <DropdownMenuRadioItem
                      className="w-[150px] items-center justify-between pl-2"
                      value="?schemaType=client"
                    >
                      Client Schema
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      className="w-[150px] items-center justify-between pl-2"
                      value="?schemaType=router"
                    >
                      Router Schema
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuGroup>
          <Separator className="my-2" />

          <DropdownMenuGroup>
            <DropdownMenuLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
              <MdOutlineFeaturedPlayList className="h-3 w-3" /> Feature Flags
            </DropdownMenuLabel>
            {featureFlags.map(({ name, query }) => {
              return (
                <>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>{name}</DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup
                          value={`?featureFlag=${activeFeatureFlag}&schemaType=${schemaType}`}
                          onValueChange={(query) =>
                            router.push(pathname + query)
                          }
                        >
                          <DropdownMenuRadioItem
                            className="w-[150px] items-center justify-between pl-2"
                            value={`${query}&schemaType=client`}
                          >
                            Client Schema
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem
                            className="w-[150px] items-center justify-between pl-2"
                            value={`${query}&schemaType=router`}
                          >
                            Router Schema
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                </>
              );
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  } else {
    return (
      <Select
        onValueChange={(v) => {
          applyParams({
            schemaType: v,
          });
        }}
        value={(router.query.schemaType as string) || "client"}
      >
        <SelectTrigger className="w-max">
          <SelectValue>
            {sentenceCase((router.query.schemaType as string) || "client")}{" "}
            Schema
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="client">
            Client Schema{" "}
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              The schema available to the clients and through introspection
            </p>
          </SelectItem>
          <Separator />
          <SelectItem value="router">
            Router Schema
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              The full schema used by the router to plan your operations
            </p>
          </SelectItem>
        </SelectContent>
      </Select>
    );
  }
};

const Toolbar = () => {
  const router = useRouter();
  const selectedCategory = (router.query.category as string) ?? "query";
  const [open, setOpen] = useState(false);

  const { ast } = useContext(ExplorerContext);
  const typeCounts = getTypeCounts(ast);

  const analyticsRetention = useFeatureLimit("analytics-retention", 7);

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
      <GraphSelector />
      {ast && (
        <>
          <SearchType open={open} setOpen={setOpen} />
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
          calendarDaysLimit={analyticsRetention}
        />
      )}
      <SchemaSettings />
    </SchemaToolbar>
  );
};

const DeprecatedTypes = () => {
  const { ast } = useContext(ExplorerContext);

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
            />
          </div>
        );
      })}
    </div>
  );
};

const SchemaExplorerPage: NextPageWithLayout = () => {
  const router = useRouter();
  const user = useUser();

  const organizationSlug = user?.currentOrganization.slug;
  const namespace = router.query.namespace as string;
  const graphName = router.query.slug as string;
  const selectedCategory = (router.query.category as string) ?? "query";
  const typename = router.query.typename as string;
  const category = router.query.category as GraphQLTypeCategory;
  const featureFlagName = router.query.featureFlag as string;

  const { data, isLoading, error, refetch } = useQuery(
    getFederatedGraphSDLByName,
    {
      name: graphName,
      namespace,
      featureFlagName: featureFlagName,
    },
  );

  const schema =
    (router.query.schemaType as string) === "router"
      ? data?.sdl
      : data?.clientSchema || data?.sdl;

  const { ast, isParsing } = useParseSchema(schema);

  const isLoadingAST = isLoading || isParsing;

  const typeCounts = ast ? getTypeCounts(ast) : undefined;

  let title = "Schema";
  let breadcrumbs = [];
  if (selectedCategory) {
    title = sentenceCase(selectedCategory);
    breadcrumbs.push(
      <Link
        href={`/${organizationSlug}/${namespace}/graph/${graphName}/schema?schemaType=${
          router.query.schemaType || "client"
        }`}
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
          href={`/${organizationSlug}/${namespace}/graph/${graphName}/schema?category=${selectedCategory}&schemaType=${
            router.query.schemaType || "client"
          }`}
        >
          {sentenceCase(selectedCategory)}
        </Link>,
      );
    }
  }

  return (
    <ExplorerContext.Provider
      value={{
        ast: ast ?? fallback,
        schemaVersionId: data?.versionId ?? "",
      }}
    >
      <GraphPageLayout
        title={title}
        breadcrumbs={breadcrumbs}
        subtitle="Explore schema and field level metrics of your federated graph"
        toolbar={<Toolbar />}
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
                    href={{
                      pathname: `${router.pathname}`,
                      query: {
                        ...router.query,
                        category,
                        typename: sentenceCase(category),
                      },
                    }}
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
                      href={{
                        pathname: `${router.pathname}`,
                        query: {
                          ...router.query,
                          category: gType,
                          typename: undefined,
                        },
                      }}
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
                  href={{
                    pathname: `${router.pathname}`,
                    query: {
                      ...router.query,
                      category: "deprecated",
                      typename: undefined,
                    },
                  }}
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
              data?.response?.code === EnumStatusCode.ERR_NOT_FOUND &&
              !schema && <EmptySchema />}
            {!isLoadingAST && error && (
              <EmptyState
                icon={<ExclamationTriangleIcon />}
                title="Could not retrieve schema"
                description={data?.response?.details || error?.message}
                actions={<Button onClick={() => refetch()}>Retry</Button>}
              />
            )}
            {ast && selectedCategory === "deprecated" && <DeprecatedTypes />}
            {ast && selectedCategory !== "deprecated" && (
              <TypeWrapper typename={typename} category={category} />
            )}
            <FieldUsageSheet />
          </div>
        </div>
      </GraphPageLayout>
    </ExplorerContext.Provider>
  );
};

SchemaExplorerPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Schema Explorer",
  });

export default SchemaExplorerPage;
