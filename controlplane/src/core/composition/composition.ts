import {
  CompositionOptions,
  NormalizationResult,
  normalizeSubgraphFromString,
  ROUTER_COMPATIBILITY_VERSIONS,
  SupportedRouterCompatibilityVersion,
} from '@wundergraph/composition';

/**
 * Normalizes and builds a GraphQLSchema from a string. It is not the same as buildSchema from graphql-js.
 */
export function buildSchema(
  schema: string,
  noLocation = true,
  version: string,
  options?: CompositionOptions,
): NormalizationResult {
  return normalizeSubgraphFromString({
    noLocation,
    options,
    sdlString: schema,
    version: validateRouterCompatibilityVersion(version),
  });
}

export function validateRouterCompatibilityVersion(version: string): SupportedRouterCompatibilityVersion {
  const castVersion = version as SupportedRouterCompatibilityVersion;
  if (!ROUTER_COMPATIBILITY_VERSIONS.has(castVersion)) {
    throw new Error(
      `Router compatibility version ${version} is not supported by Cosmo.` +
        `Please set one of the following valid versions:\n ` +
        [...ROUTER_COMPATIBILITY_VERSIONS].join(','),
    );
  }
  return castVersion;
}
