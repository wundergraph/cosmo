import type { OpenAPIV3, OpenAPIV2 } from 'openapi-types';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import { getJSONSchemaOptionsFromOpenAPIOptions } from '@omnigraph/openapi';
import { loadNonExecutableGraphQLSchemaFromJSONSchemas } from '@omnigraph/json-schema';

type OasSource = string | OpenAPIV3.Document | OpenAPIV2.Document;

export type IntrospectOpenApiOptions = {
  source: OasSource;
  name: string;
  cwd?: string;
};

export const introspectOpenApi = async (options: IntrospectOpenApiOptions): Promise<string> => {
  const { cwd = process.cwd(), ...rest } = options;

  // get json schema options describing each path in the spec
  const extraJSONSchemaOptions = await getJSONSchemaOptionsFromOpenAPIOptions(options.name, options);
  // build graphql schema from the json schema options with the directives attached to fields
  const graphQLSchema = await loadNonExecutableGraphQLSchemaFromJSONSchemas(options.name, {
    ...rest,
    ...extraJSONSchemaOptions,
    cwd,
  });

  // as logic of translating api calls stored in the directives we need print schema with directives
  return printSchemaWithDirectives(graphQLSchema);
};
