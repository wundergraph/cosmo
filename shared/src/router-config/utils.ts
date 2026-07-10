import { RouterConfigSchema } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { fromJson, fromJsonString } from '@bufbuild/protobuf';
import type { RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import type { JsonReadOptions, JsonValue } from '@bufbuild/protobuf';

export function routerConfigFromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RouterConfig {
  options = {
    ...options,
    ignoreUnknownFields: true,
  };
  return fromJson(RouterConfigSchema, jsonValue, options);
}

export function routerConfigFromJsonString(configAsText: string, options?: Partial<JsonReadOptions>): RouterConfig {
  options = {
    ...options,
    ignoreUnknownFields: true,
  };
  return fromJsonString(RouterConfigSchema, configAsText, options);
}
