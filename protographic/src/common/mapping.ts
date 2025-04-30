/**
 * Configuration for mapping GraphQL operations to service calls
 */
export interface ServiceMapping {
  /**
   * Version number to differentiate between configuration versions
   * Not semver, just an integer
   */
  version: number;

  /** Name of the service being mapped */
  service: string;

  /** Mappings for GraphQL operations (Query, Mutation, Subscription) */
  operation_mappings: OperationMapping[];

  /** Mappings for entity types */
  entity_mappings: EntityMapping[];

  /** Mappings for fields within specific types */
  type_field_mappings: TypeFieldMapping[];
}

/**
 * Mapping for a GraphQL operation to a service call
 */
export interface OperationMapping {
  /** Kind of operation in GraphQL terms (Query, Mutation, Subscription) */
  kind: "Query" | "Mutation" | "Subscription";

  /** Original operation name */
  original: string;

  /** Mapped operation name for the service */
  mapped: string;

  /** Name of the request type for this operation */
  request: string;

  /** Name of the response type for this operation */
  response: string;
}

/**
 * Mapping for an entity type to its lookup procedure
 */
export interface EntityMapping {
  /** Name of the entity type */
  type_name: string;

  /** Kind of entity mapping */
  kind: "entity" | "requires";

  /** Key field used to identify the entity */
  key: string;

  /** RPC procedure name for entity lookup */
  rpc: string;

  /** Name of the request type for this entity lookup */
  request: string;

  /** Name of the response type for this entity lookup */
  response: string;
}

/**
 * Mapping for fields within a specific type
 */
export interface TypeFieldMapping {
  /** Original type name */
  type: string;

  /** Field mappings for this type */
  field_mappings: FieldMapping[];
}

/**
 * Mapping for a specific field within a type
 */
export interface FieldMapping {
  /** Original field name */
  original: string;

  /** Mapped field name */
  mapped: string;

  /** Optional mappings for field arguments */
  argument_mappings: ArgumentMapping[];
}

/**
 * Mapping for an argument of a field
 */
export interface ArgumentMapping {
  /** Original argument name */
  original: string;

  /** Mapped argument name */
  mapped: string;
}
