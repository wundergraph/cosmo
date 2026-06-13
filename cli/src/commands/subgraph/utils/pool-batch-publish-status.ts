import {
  GetBatchPublishJobStatusResponse,
  PublishFederatedSubgraphsResponse,
  BatchPublishJobStatus,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Client } from '../../../core/client/client.js';
import { getBaseHeaders } from '../../../core/config.js';

export async function poolBatchPublishStatus(
  client: Client,
  jobId: string,
): Promise<PublishFederatedSubgraphsResponse> {
  let resp: GetBatchPublishJobStatusResponse;

  const headers = getBaseHeaders();
  for (;;) {
    resp = await client.platform.getBatchPublishJobStatus({ jobId }, { headers });
    if (resp.response?.code !== EnumStatusCode.OK) {
      return new PublishFederatedSubgraphsResponse({
        response: resp.response,
      });
    }

    switch (resp.status) {
      case BatchPublishJobStatus.PENDING:
      case BatchPublishJobStatus.PROCESSING: {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        break;
      }
      case BatchPublishJobStatus.FAILED: {
        return new PublishFederatedSubgraphsResponse({
          response: {
            code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            details: resp.failureReason,
          },
        });
      }
      case BatchPublishJobStatus.COMPLETED: {
        return new PublishFederatedSubgraphsResponse({
          response: { code: EnumStatusCode.OK },
          ...resp,
        });
      }
    }
  }
}
