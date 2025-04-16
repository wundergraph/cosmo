import { useQuery } from "@connectrpc/connect-query";
import {
  EventMeta,
  OrganizationEventName,
} from "@wundergraph/cosmo-connect/dist/notifications/events_pb";
import { getFederatedGraphs } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { useMemo } from "react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { PartialMessage } from "@bufbuild/protobuf";
import { PiWebhooksLogo } from "react-icons/pi";
import { FaSlack } from "react-icons/fa";
import { Toolbar } from "../ui/toolbar";
import { FederatedGraph } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { SelectGroup, SelectLabel } from "../ui/select";

export type EventsMeta = Array<PartialMessage<EventMeta>>;

type NotificationTab = "webhooks" | "integrations";

export const notificationEvents = [
  {
    id: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
    name: OrganizationEventName[
      OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED
    ],
    label: "Federated Graph Schema Update",
    description: "An update to the schema of any federated graph",
  },
  {
    id: OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED,
    name: OrganizationEventName[OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED],
    label: "Monograph Schema Update",
    description: "An update to the schema of any monograph",
  },
  {
    id: OrganizationEventName.PROPOSAL_STATE_UPDATED,
    name: OrganizationEventName[OrganizationEventName.PROPOSAL_STATE_UPDATED],
    label: "Proposal State Update",
    description: "An update to the state of a proposal",
  },
] as const;

export const SelectGraphs = ({
  meta,
  setMeta,
  type = "federated",
  eventName,
}: {
  meta: EventsMeta;
  setMeta: (meta: EventsMeta) => void;
  type: "federated" | "monograph";
  eventName: OrganizationEventName;
}) => {
  const { data } = useQuery(getFederatedGraphs);

  const graphIds = useMemo(() => {
    const entry = meta.find((m) => m.eventName === eventName);
    if (
      entry?.meta?.case !==
      (eventName === OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED
        ? "federatedGraphSchemaUpdated"
        : eventName === OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED
        ? "monographSchemaUpdated"
        : "proposalStateUpdated")
    ) {
      return [];
    }
    return entry.meta.value.graphIds ?? [];
  }, [eventName, meta]);

  const onCheckedChange = (val: boolean, graphId: string) => {
    const tempMeta: EventsMeta = [...meta];
    const newGraphIds: string[] = [];

    if (val) {
      newGraphIds.push(...Array.from(new Set([...graphIds, graphId])));
    } else {
      newGraphIds.push(...graphIds.filter((g) => g !== graphId));
    }

    const entry: EventsMeta[number] = {
      eventName,
      meta: {
        case:
          eventName === OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED
            ? "federatedGraphSchemaUpdated"
            : eventName === OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED
            ? "monographSchemaUpdated"
            : "proposalStateUpdated",
        value: {
          graphIds: newGraphIds,
        },
      },
    };

    const idx = tempMeta.findIndex((v) => v.eventName === eventName);

    if (idx === -1) {
      tempMeta.push(entry);
    } else {
      tempMeta[idx] = entry;
    }

    setMeta(tempMeta);
  };

  const graphs =
    data?.graphs.filter(
      (g) => g.supportsFederation === (type === "federated"),
    ) || [];

  const groupedGraphs = graphs
    .filter((g) => g.supportsFederation === (type === "federated"))
    .reduce<Record<string, FederatedGraph[]>>((result, graph) => {
      const { namespace, name } = graph;

      if (!result[namespace]) {
        result[namespace] = [];
      }

      result[namespace].push(graph);

      return result;
    }, {});

  if (graphs.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          {graphIds.length > 0
            ? `${graphIds.length} selected`
            : "Select graphs"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="">
        {Object.entries(groupedGraphs ?? {}).map(([namespace, graphs]) => {
          return (
            <SelectGroup key={namespace}>
              <SelectLabel>{namespace}</SelectLabel>
              {graphs.map((graph) => {
                return (
                  <DropdownMenuCheckboxItem
                    key={graph.id}
                    checked={graphIds.includes(graph.id)}
                    onCheckedChange={(val) => onCheckedChange(val, graph.id)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {graph.name}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </SelectGroup>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const Meta = ({
  id,
  meta,
  setMeta,
}: {
  id: OrganizationEventName;
  meta: EventsMeta;
  setMeta: (meta: EventsMeta) => void;
}) => {
  if (
    id === OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED ||
    id === OrganizationEventName.PROPOSAL_STATE_UPDATED
  ) {
    return (
      <SelectGraphs
        meta={meta}
        setMeta={setMeta}
        type="federated"
        eventName={id}
      />
    );
  }

  if (id === OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED) {
    return (
      <SelectGraphs
        meta={meta}
        setMeta={setMeta}
        type="monograph"
        eventName={id}
      />
    );
  }

  return null;
};

export const NotificationToolbar = ({ tab }: { tab: NotificationTab }) => {
  const router = useRouter();

  return (
    <Toolbar>
      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="webhooks" asChild>
            <Link
              href={{
                pathname: `/${router.query.organizationSlug}/webhooks`,
              }}
              className="flex gap-x-[6px]"
            >
              <PiWebhooksLogo />
              Webhooks
            </Link>
          </TabsTrigger>
          <TabsTrigger value="integrations" asChild>
            <Link
              href={{
                pathname: `/${router.query.organizationSlug}/integrations`,
              }}
              className="flex gap-x-2"
            >
              <FaSlack />
              Slack Integration
            </Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </Toolbar>
  );
};
