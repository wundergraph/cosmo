import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ROUTER_COMPATIBILITY_VERSIONS } from '@wundergraph/composition';
import { ListRouterCompatibilityVersionsResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';

export function listRouterCompatibilityVersions(): PlainMessage<ListRouterCompatibilityVersionsResponse> {
  return {
    response: {
      code: EnumStatusCode.OK,
    },
    versions: [...ROUTER_COMPATIBILITY_VERSIONS],
  };
}
