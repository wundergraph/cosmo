import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/webhooks/events_pb';

export interface FederatedGraphSchemaUpdateMeta {
  graphIds: string[];
}

export type EventsMeta = Partial<{
  [OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED]: FederatedGraphSchemaUpdateMeta;
}>;
