import { FieldUsageSheet } from "@/components/analytics/field-usage";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useAnalyticsQueryState } from "@/components/analytics/useAnalyticsQueryState";
import {
  DatePickerWithRange,
  DateRangePickerChangeHandler,
} from "@/components/date-picker-with-range";
import { EmptyState } from "@/components/empty-state";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { EmptySchema } from "@/components/schema/empty-schema-state";
import { SchemaToolbar } from "@/components/schema/toolbar";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { Kbd } from "@/components/ui/kbd";
import { Loader } from "@/components/ui/loader";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { TooltipPortal } from "@radix-ui/react-tooltip";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { useUser } from "@/hooks/use-user";
import { useChartData } from "@/lib/insights-helpers";
import { NextPageWithLayout } from "@/lib/page";
import {
  FieldMatch,
  GraphQLTypeCategory,
  GraphQLTypeDefinition,
  ParsedGraphQLField,
  TypeMatch,
  getParsedTypes,
  extractDirectives,
  getAuthenticatedTypes,
  getCategoryDescription,
  getCategoryForType,
  getDeprecatedTypes,
  getRootDescription,
  getTypeCounts,
  getTypesByCategory,
  graphqlRootCategories,
  graphqlTypeCategories,
  mapGraphQLType,
  searchSchema,
  useParseSchema,
} from "@/lib/schema-helpers";
import { cn } from "@/lib/utils";
import { useQuery } from "@connectrpc/connect-query";
import {
  ChevronUpDownIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  LockClosedIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getFederatedGraphSDLByName,
  getFieldUsage,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { sentenceCase } from "change-case";
import { CommandLoading, useCommandState } from "cmdk";
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
  useMemo,
  useRef,
  useState,
} from "react";
import { MdOutlineFeaturedPlayList } from "react-icons/md";
import { PiGraphLight } from "react-icons/pi";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { useDebounce } from "use-debounce";
import { useWorkspace } from "@/hooks/use-workspace";

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
          fieldName: null,
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

  const fieldName = router.query.fieldName as string;
  const filteredFields = useMemo(() => {
    return props.fields.filter((f) =>
      fieldName ? f.name === fieldName : true,
    );
  }, [fieldName, props.fields]);

  const hasArgs = filteredFields.some((f) => !!f.args);
  const hasDetails = filteredFields.some(
    (f) =>
      !!f.description ||
      !!f.deprecationReason ||
      f.authenticated ||
      !f.requiresScopes,
  );
  const hasUsage = !(["scalars", "enums"] as GraphQLTypeCategory[]).includes(
    props.category,
  );

  const parentRef = useRef<HTMLTableElement>(null);
  const count = filteredFields.length;
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
            const field = filteredFields[virtualRow.index];
            const fieldHasArgs = !!field.args;
            const fieldHasDetails =
              !!field.description ||
              !!field.deprecationReason ||
              field.authenticated ||
              !!field.requiresScopes;
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
                {(fieldHasDetails || fieldHasArgs) && (
                  <TableCell
                    className={cn(
                      "my-1.5 w-5/12",
                      router.query.category !== "deprecated" && "w-6/12",
                    )}
                  >
                    <div
                      className={cn("flex flex-col", {
                        "gap-y-4":
                          fieldHasDetails &&
                          field.args &&
                          field.args.length > 0,
                      })}
                    >
                      {(!field.args || field.args?.length === 0) &&
                        !fieldHasDetails && <span>-</span>}
                      {fieldHasDetails && (
                        <div className="flex flex-col gap-y-4">
                          {field.description && (
                            <p className="text-muted-foreground group-hover:text-current">
                              {field.description}
                            </p>
                          )}
                          <DeprecatedBadge reason={field.deprecationReason} />
                          <AuthenticatedBadge
                            isType={false}
                            authenticated={field.authenticated}
                            requiresScopes={field.requiresScopes}
                          />
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
                                  <TooltipPortal>
                                    <TooltipContent>
                                      <div className="flex w-96 flex-col gap-y-4">
                                        {arg.description && (
                                          <p>{arg.description}</p>
                                        )}
                                        <DeprecatedBadge
                                          reason={arg.deprecationReason}
                                        />
                                      </div>
                                    </TooltipContent>
                                  </TooltipPortal>
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
      {filteredFields.length === 0 && (
        <div className="my-4 text-center text-sm text-muted-foreground">
          No fields found
        </div>
      )}
    </TableWrapper>
  );
};

const Type = (props: {
  name: string;
  category: GraphQLTypeCategory;
  description: string;
  authenticated?: boolean;
  requiresScopes?: string[][];
  interfaces?: string[];
  fields?: ParsedGraphQLField[];
  startLineNo?: number;
  endLineNo?: number;
}) => {
  const router = useRouter();
  const isAuthenticatedType = props.authenticated || !!props.requiresScopes?.length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-x-4">
            <div className="flex flex-wrap items-center gap-x-2 text-lg font-semibold tracking-tight">
              <h3 className="flex items-center justify-start gap-x-1">
                {isAuthenticatedType && (
                  <Tooltip>
                    <TooltipTrigger>
                      <LockClosedIcon className="size-4" />
                    </TooltipTrigger>
                    <TooltipContent>Authenticated</TooltipContent>
                  </Tooltip>
                )}

                {props.name}
              </h3>
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

            {props.requiresScopes?.length && (
              <AuthenticatedScopes isType scopes={props.requiresScopes} asChild>
                <button type="button" className={badgeVariants({ className: "w-max" })}>View scopes</button>
              </AuthenticatedScopes>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {props.description || getRootDescription(props.name) || (
              <span className="italic">No description provided</span>
            )}
          </p>
        </div>
      </div>
      {router.query.fieldName && (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="flex w-full max-w-lg items-center gap-x-2 rounded-md border border-dashed px-2 py-1.5 text-sm lg:w-auto lg:max-w-none">
            <div>Filter:</div>
            <Badge variant="muted" className="w-full overflow-hidden">
              <p className="w-full overflow-hidden truncate">
                {router.query.fieldName}
              </p>
            </Badge>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              delete router.query.fieldName;
              router.push({
                pathname: `${router.pathname}`,
                query: {
                  ...router.query,
                },
              });
            }}
          >
            <XMarkIcon className="mr-2 h-4 w-4" />
            Clear
          </Button>
        </div>
      )}
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
                  const directives = extractDirectives(l.astNode);
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
                        <AuthenticatedBadge
                          isType
                          authenticated={directives.authenticated}
                          requiresScopes={directives.requiresScopes}
                        />
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
        authenticated={type.authenticated}
        requiresScopes={type.requiresScopes}
        interfaces={type.interfaces}
        fields={type.fields}
        startLineNo={type.loc?.startToken.line}
        endLineNo={type.loc?.endToken.line}
      />
    </div>
  );
};

const DeprecatedBadge = ({ reason }: { reason: string | undefined | null }) => {
  if (!reason) {
    return null;
  }

  return (
    <p className="flex flex-col items-start gap-x-1">
      <span className="flex items-center gap-x-1 font-semibold">
        <ExclamationTriangleIcon className="h-3 w-3 flex-shrink-0" />
        Deprecated
      </span>
      {reason}
    </p>
  );
};

const AuthenticatedBadge = ({ isType, authenticated, requiresScopes }: {
  isType: boolean;
  authenticated?: boolean;
  requiresScopes?: string[][];
}) => {
  if (!authenticated && !requiresScopes?.length) {
    return null;
  }

  return (
    <p className="flex flex-col items-start gap-x-1">
      <span className="flex items-center gap-1 font-semibold">
        <LockClosedIcon className="h-3 w-3 flex-shrink-0" />
        Authenticated
      </span>
      {!!requiresScopes?.length && <AuthenticatedScopes isType={isType} scopes={requiresScopes} />}
    </p>
  );
};

const AuthenticatedScopes = ({
  isType,
  scopes,
  asChild = true,
  children,
}: {
  isType: boolean;
  scopes: string[][];
  asChild?: boolean;
  children?: React.ReactNode;
}) => {
  return (
    <Popover>
      <PopoverTrigger asChild={asChild}>
        {children
          ? children
          : (
            <Button variant="link" size="sm" className="h-auto p-0">
              View scopes
            </Button>
          )}
      </PopoverTrigger>
      <PopoverContent className="px-0">
        <div className="mb-3 border-b border-border px-4 pb-3">
          The following scope(s) are required to access this {isType ? "type" : "field"}:
        </div>

        {scopes
          .filter((s) => s.length > 0)
          .map((s, i) => (
            <div key={`scope-list-${i}`}>
              {i > 0 && (
                <div className="relative flex items-center py-2 text-xs">
                  <div className="flex-grow border-t border-border"></div>
                  <span className="mx-4 flex-shrink text-muted-foreground">
                    OR
                  </span>
                  <div className="flex-grow border-t border-border"></div>
                </div>
              )}
              <div className="px-4 text-sm">
                {s.length === 1 ? (
                  s[0]
                ) : (
                  <>
                    {s.slice(0, -1).join(", ")}{" "}
                    <span className="font-semibold">AND</span> {s[s.length - 1]}
                  </>
                )}
              </div>
            </div>
          ))}
      </PopoverContent>
    </Popover>
  );
};

const SearchDescription = ({
  results,
}: {
  results: {
    types: TypeMatch[];
    fields: FieldMatch[];
  };
}) => {
  const activeValue = useCommandState((state) => state.value);
  if (!activeValue) {
    return null;
  }

  const [category, index, _] = activeValue?.split("-");
  const matchingType = results.types[Number(index)];
  const type = matchingType?.type;

  const [fieldIndex] = activeValue?.split(".")?.map((v) => v.trim());
  const field = results.fields[Number(fieldIndex)]?.field;
  const parsedField = results.fields[Number(fieldIndex)]?.parsed;

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
          <AuthenticatedBadge
            isType
            authenticated={matchingType?.authenticated}
            requiresScopes={matchingType?.requiresScopes}
          />
        </>
      ) : field ? (
        <div>
          <div className="flex flex-col gap-y-4 text-sm">
            <p className="break-words text-muted-foreground">
              {field.description || (
                <span className="italic">No description provided</span>
              )}
            </p>
            <DeprecatedBadge reason={field.deprecationReason} />
            {parsedField && (
              <AuthenticatedBadge
                isType={false}
                authenticated={parsedField.authenticated}
                requiresScopes={parsedField.requiresScopes}
              />
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

  const [query, setQuery] = useState("");
  const [debouncedSearch, { isPending }] = useDebounce(query, 300);
  const debouncing = isPending();

  const { results, totalResults } = useMemo(() => {
    const results = searchSchema(debouncedSearch, ast);
    const totalResults = results.fields.length + results.types.length;

    return { results, totalResults };
  }, [debouncedSearch, ast]);

  return (
    <CommandDialog
      commandProps={{
        loop: true,
      }}
      className="max-w-2xl"
      open={open}
      onOpenChange={setOpen}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search for a type"
      />
      {debouncing && (
        <CommandLoading>
          <Loader className="my-12" />
        </CommandLoading>
      )}
      <div className={cn("flex divide-x", debouncing && "hidden")}>
        <CommandList className="scrollbar-custom w-full">
          <CommandEmpty>No results found</CommandEmpty>
          <CommandGroup heading="Types">
            {results.types.map(({ type }, i) => {
              const category = getCategoryForType(ast, type.name)!;
              return (
                <CommandItem
                  onSelect={() => {
                    const newQuery = { ...router.query };
                    newQuery.category = category;
                    newQuery.typename = type.name;
                    setOpen(false);
                    router.push({
                      query: newQuery,
                    });
                  }}
                  key={category + type.name + i}
                  value={`${category}-${i}-${type}`}
                >
                  {type.name}
                </CommandItem>
              );
            })}
          </CommandGroup>
          <CommandGroup heading="Fields">
            {results.fields.map((f, i) => {
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
                  key={f.type.name + f.field.name + i}
                  value={`${i} . ${f.type.name} . ${f.field.name}`}
                >
                  <span className="text-primary">{f.type.name}</span>.
                  {f.field.name}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
        <SearchDescription results={results} />
      </div>
      {totalResults > 0 && !debouncing && (
        <>
          <Separator />
          <div className="p-2 text-end text-xs text-muted-foreground">
            {totalResults >= 100
              ? "Showing first 100 results"
              : `Found ${totalResults} results`}
          </div>
        </>
      )}
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

const Toolbar = ({
  typeCounts,
  deprecatedTypesCount,
  authenticatedTypesCount,
}: {
  typeCounts: Record<string, number> | undefined;
  deprecatedTypesCount: number;
  authenticatedTypesCount: number;
}) => {
  const router = useRouter();
  const selectedCategory = (router.query.category as string) ?? "query";
  const [open, setOpen] = useState(false);

  const { ast } = useContext(ExplorerContext);

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
                  {deprecatedTypesCount}
                </Badge>
              )}
            </SelectItem>
            <SelectItem value="authenticated">
              <span>Authentication</span>
              {typeCounts && ast && (
                <Badge variant="secondary" className="ml-2">
                  {authenticatedTypesCount}
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
    </SchemaToolbar>
  );
};

const TypesList = ({
  types,
  emptyTitle,
  emptyDescription,
}: {
  types: GraphQLTypeDefinition[];
  emptyTitle: string;
  emptyDescription: string;
}) => {
  if (types.length === 0) {
    return (
      <EmptyState
        icon={<InformationCircleIcon />}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <div className="flex flex-col gap-y-12 divide-y">
      {types.map((type) => {
        return (
          <div key={type.name} className="pt-12 first:pt-2">
            <Type
              name={type.name}
              category={type.category}
              description={type.description}
              authenticated={type.authenticated}
              requiresScopes={type.requiresScopes}
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

const DeprecatedTypes = ({ types }: { types: GraphQLTypeDefinition[] }) => {
  return (
    <TypesList
      types={types}
      emptyTitle="No deprecated fields found"
      emptyDescription="You can view all deprecated fields or fields with deprecated arguments here"
    />
  );
};

const AuthenticatedTypes = ({
  types,
  isRouterSchema,
}: {
  types: GraphQLTypeDefinition[];
  isRouterSchema: boolean;
}) => {
  return (
    <TypesList
      types={types}
      emptyTitle="No authenticated fields found"
      emptyDescription={
        isRouterSchema
          ? "You can view all authenticated fields here"
          : "To view authenticated fields, switch to the router schema"
      }
    />
  );
};

const SchemaExplorerPage: NextPageWithLayout = () => {
  const router = useRouter();
  const user = useUser();

  const organizationSlug = user?.currentOrganization.slug;
  const { namespace: { name: namespace } } = useWorkspace();
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

  const schemaType = router.query.schemaType as string;
  const schema =
    schemaType === "router" ? data?.sdl : data?.clientSchema || data?.sdl;

  const { ast, doc, isParsing } = useParseSchema(schema);
  const parsedTypes = useMemo(() => (doc ? getParsedTypes(doc) : []), [doc]);

  const typeCounts = useMemo(() => (ast ? getTypeCounts(ast) : undefined), [ast],);
  const [deprecatedTypesCount, deprecatedTypes] = useMemo(() => getDeprecatedTypes(parsedTypes), [parsedTypes]);
  const [authenticatedTypesCount, authenticatedTypes] = useMemo(() => getAuthenticatedTypes(parsedTypes), [parsedTypes]);

  const isLoadingAST = isLoading || isParsing;

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
        toolbar={
          <Toolbar
            typeCounts={typeCounts}
            deprecatedTypesCount={deprecatedTypesCount}
            authenticatedTypesCount={authenticatedTypesCount}
          />
        }
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
                      {deprecatedTypesCount}
                    </Badge>
                  )}
                </Link>
              </Button>

              <Button
                asChild
                variant="ghost"
                className={cn("justify-start px-3", {
                  "bg-accent text-accent-foreground":
                    selectedCategory === "authenticated",
                })}
              >
                <Link
                  href={{
                    pathname: `${router.pathname}`,
                    query: {
                      ...router.query,
                      category: "authenticated",
                      typename: undefined,
                    },
                  }}
                >
                  <span>Authentication</span>
                  {typeCounts && ast && (
                    <Badge
                      variant="secondary"
                      className="ml-auto bg-accent/50 px-1.5"
                    >
                      {authenticatedTypesCount}
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
            {ast && selectedCategory === "deprecated" && (
              <DeprecatedTypes types={deprecatedTypes} />
            )}
            {ast && selectedCategory === "authenticated" && (
              <AuthenticatedTypes
                types={authenticatedTypes}
                isRouterSchema={schemaType === "router"}
              />
            )}
            {ast &&
              !["deprecated", "authenticated"].includes(selectedCategory) && (
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
