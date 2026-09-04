export type SchemaType = 'client' | 'router';

export interface SchemaSelection {
  featureFlag?: string;
  subgraph?: string;
  schemaType?: string;
}
