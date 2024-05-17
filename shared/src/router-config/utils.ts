import { RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import type { JsonReadOptions, JsonValue } from '@bufbuild/protobuf';

export function routerConfigFromJson(jsonValue: JsonValue, options?: Partial<JsonReadOptions>): RouterConfig {
  options = {
    ...options,
    ignoreUnknownFields: true,
  };
  return RouterConfig.fromJson(jsonValue, options);
}

export function routerConfigFromJsonString(configAsText: string, options?: Partial<JsonReadOptions>): RouterConfig {
  options = {
    ...options,
    ignoreUnknownFields: true,
  };
  return RouterConfig.fromJsonString(configAsText, options);
}
