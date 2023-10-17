import { EmptyState } from "@/components/empty-state";
import { getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { SchemaToolbar } from "@/components/schema/toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
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
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NextPageWithLayout } from "@/lib/page";
import {
  GraphQLField,
  GraphQLTypeCategory,
  getCategoryForType,
  graphqlRootCategories,
  graphqlTypeCategories,
  mapObjectOrInterfaceGraphQLType,
  parseSchema,
} from "@/lib/schemaParser";
import { cn } from "@/lib/utils";
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getFederatedGraphSDLByName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { sentenceCase } from "change-case";
import { GraphQLSchema, isInterfaceType, isObjectType } from "graphql";
import Link from "next/link";
import { useRouter } from "next/router";

const Fields = (props: { fields: GraphQLField[]; ast: GraphQLSchema }) => {
  const hasArgs = props.fields.some((f) => !!f.args);

  return (
    <Table className="min-w-[1100px] lg:min-w-full">
      <TableHeader>
        <TableRow>
          <TableHead className="w-3/12">Field</TableHead>
          {hasArgs && <TableHead className="w-4/12">Input</TableHead>}
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
                <TypeLink ast={props.ast} name={`: ${field.type}`} />
              </p>
            </TableCell>
            {hasArgs && (
              <TableCell className="flex flex-col gap-y-2 py-4">
                {(!field.args || field.args?.length === 0) && <span>-</span>}
                {field.args?.map((arg) => {
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
                      <TypeLink ast={props.ast} name={`: ${arg.type}`} />
                    </div>
                  );
                })}
              </TableCell>
            )}
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
          "font-semibold text-muted-foreground underline-offset-2 hover:underline",
          {
            "text-xl text-primary-foreground": isHeading,
          }
        )}
      >
        {name}
      </span>
    </Link>
  );
};

const Type = (props: {
  name: string;
  category: GraphQLTypeCategory;
  description: string;
  interfaces: string[];
  fields: GraphQLField[];
  ast: GraphQLSchema;
}) => {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-x-4">
        <div className="flex items-center gap-x-2 text-xl font-semibold tracking-tight">
          <h3>{props.name}</h3>
          {props.interfaces.length > 0 && (
            <div className="font-normal text-muted-foreground">implements</div>
          )}
          {props.interfaces.map((t, index) => (
            <>
              <TypeLink key={index} ast={props.ast} name={t} isHeading />
              {index !== props.interfaces.length - 1 && (
                <p className="font-normal text-muted-foreground">&</p>
              )}
            </>
          ))}
        </div>
        <Badge className="w-max">{props.category}</Badge>
      </div>
      <p className="mt-2 text-muted-foreground">{props.description}</p>
      <div className="mt-6">
        <Fields fields={props.fields} ast={props.ast} />
      </div>
    </div>
  );
};

const TypeWrapper = ({ sdl }: { sdl: string }) => {
  const router = useRouter();
  const ast = parseSchema(sdl);

  const category = router.query.category as string;
  let typename = router.query.typename as string;

  if (category && !typename) {
    return <div>{category}</div>;
  }

  if (!typename) {
    typename = "Query";
  }

  const astType = ast.getType(typename);

  if (!astType)
    return (
      <EmptyState
        className="order-2 h-72 border lg:order-last"
        icon={<InformationCircleIcon />}
        title="No data found"
        description="There is no data for this type or category. Please adjust your filters."
      />
    );

  let content: React.ReactNode;

  if (isObjectType(astType) || isInterfaceType(astType)) {
    const type = mapObjectOrInterfaceGraphQLType(astType);
    content = (
      <Type
        name={type.name}
        category={type.category}
        description={type.description}
        interfaces={type.interfaces}
        fields={type.fields}
        ast={ast}
      />
    );
  }

  return <div className="mt-2 flex-1">{content}</div>;
};

const SchemaExplorerPage: NextPageWithLayout = () => {
  const router = useRouter();
  const graphName = router.query.slug as string;

  const { data, isLoading, error, refetch } = useQuery(
    getFederatedGraphSDLByName.useQuery({
      name: graphName,
    })
  );

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

  return <TypeWrapper sdl={data.sdl ?? ""} />;
};

const Toolbar = () => {
  const router = useRouter();
  const selectedCategory = (router.query.category || "query") as string;

  return (
    <SchemaToolbar tab="explorer">
      <Select
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
        <SelectTrigger
          value={selectedCategory}
          className="w-full md:ml-auto md:w-[200px]"
        >
          <SelectValue aria-label={selectedCategory}>
            {sentenceCase(selectedCategory)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {graphqlRootCategories.map((category) => (
              <SelectItem key={category} value={category}>
                {sentenceCase(category)}
              </SelectItem>
            ))}
          </SelectGroup>
          <Separator className="my-2" />
          <SelectGroup>
            {graphqlTypeCategories.map((gType) => {
              return (
                <SelectItem key={gType} value={gType}>
                  {sentenceCase(gType)}
                </SelectItem>
              );
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
    </SchemaToolbar>
  );
};

SchemaExplorerPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Studio | SDL">
      <TitleLayout
        title="Schema Explorer"
        subtitle="Explore schema and field level metrics of your federated graph"
        toolbar={<Toolbar />}
      >
        {page}
      </TitleLayout>
    </PageHeader>
  );

export default SchemaExplorerPage;
