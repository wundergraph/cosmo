export type SchemaType = 'client' | 'router';

export interface SchemaSelection {
  featureFlag?: string;
  subgraph?: string;
  schemaType?: SchemaType;
}

/** Query string and dropdown values are plain strings, so narrow them to a `SchemaType`. */
export const toSchemaType = (value: string | undefined): SchemaType => (value === 'router' ? 'router' : 'client');
