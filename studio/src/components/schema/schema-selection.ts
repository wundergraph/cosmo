export type SchemaType = 'client' | 'router';

/** Which schema a graph's schema pages are showing. Unset fields are cleared from the URL. */
export interface SchemaSelection {
  featureFlag?: string;
  subgraph?: string;
  schemaType?: string;
}
