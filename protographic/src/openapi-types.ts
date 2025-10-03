/**
 * OpenAPI metadata types for GraphQL operations
 * These types represent the metadata that can be specified via the @openapi directive
 */

export interface ExternalDocs {
  description?: string;
  url: string;
}

export interface OpenApiMetadata {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  externalDocs?: ExternalDocs;
}

/**
 * The @openapi directive definition that will be temporarily added to SDL
 */
export const OPENAPI_DIRECTIVE_DEFINITION = `
directive @openapi(
  operationId: String
  summary: String
  description: String
  tags: [String!]
  deprecated: Boolean = false
) repeatable on FIELD_DEFINITION
`;