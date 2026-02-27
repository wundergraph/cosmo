import { cn } from "@/lib/utils";
import {
  BarChartIcon,
  CheckIcon,
  Cross1Icon,
  GlobeIcon,
} from "@radix-ui/react-icons";
import { FederatedGraphSchemaChange } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import Link from "next/link";
import { useRouter } from "next/router";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "../ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";
import { useOpenUsage } from "./use-open-usage";

export const ComposedSchemaChangesTable = ({
  changes,
  caption,
  trafficCheckDays,
  createdAt,
}: {
  changes: FederatedGraphSchemaChange[];
  caption?: React.ReactNode;
  trafficCheckDays?: number;
  createdAt?: string;
}) => {
  const openUsage = useOpenUsage({ trafficCheckDays, createdAt });

  return (
    <TableWrapper>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">Change</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Federated Graph</TableHead>
            <TableHead className="w-2/12 2xl:w-1/12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {changes.map((c, i) => (
            <Row
              key={i}
              changeType={c.changeType}
              message={c.message}
              isBreaking={c.isBreaking}
              path={c.path}
              federatedGraphName={c.federatedGraphName}
              openUsage={openUsage}
            />
          ))}
        </TableBody>
        {caption && <TableCaption>{caption}</TableCaption>}
      </Table>
    </TableWrapper>
  );
};

const Row = ({
  changeType,
  message,
  isBreaking,
  path,
  federatedGraphName,
  openUsage,
}: {
  changeType: string;
  message: string;
  isBreaking: boolean;
  path?: string;
  federatedGraphName: string;
  openUsage: (changeType: string, path?: string) => void;
}) => {
  const router = useRouter();
  const {
    namespace: { name: namespace },
  } = useWorkspace();
  const organizationSlug = useCurrentOrganization()?.slug;

  return (
    <TableRow key={changeType + message + federatedGraphName} className="group">
      <TableCell
        className={cn(
          isBreaking ? "text-destructive" : "text-muted-foreground",
        )}
      >
        <div className="flex items-center gap-2">
          {isBreaking ? <Cross1Icon /> : <CheckIcon />}
          <span className="block w-[160px] truncate" title={changeType}>
            {changeType}
          </span>
        </div>
      </TableCell>
      <TableCell>{message}</TableCell>
      <TableCell>{federatedGraphName}</TableCell>
      <TableCell>
        <div className="flex items-center gap-x-2">
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              {path ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  asChild
                  className="table-action"
                >
                  <Link
                    href={{
                      pathname: `/[organizationSlug]/[namespace]/graph/[slug]/schema`,
                      query: {
                        organizationSlug,
                        namespace,
                        slug: router.query.slug,
                        typename: path.split(".")[0],
                      },
                    }}
                  >
                    <GlobeIcon />
                  </Link>
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled
                  aria-disabled="true"
                  tabIndex={-1}
                  className="table-action"
                >
                  <GlobeIcon />
                </Button>
              )}
            </TooltipTrigger>
            <TooltipContent>
              {path
                ? "Open in Explorer"
                : "Cannot open in explorer. Path to type unavailable"}
            </TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <Button
                onClick={() => openUsage(changeType, path)}
                variant="ghost"
                size="icon-sm"
                className="table-action"
              >
                <BarChartIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>View Usage</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </TableRow>
  );
};
