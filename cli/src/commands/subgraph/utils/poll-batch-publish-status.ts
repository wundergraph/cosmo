import { create } from '@bufbuild/protobuf';
import {
  type PublishFederatedSubgraphsResponse,
  PublishFederatedSubgraphsResponseSchema,
  BatchPublishJobStatus,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Client } from '../../../core/client/client.js';
import { getBaseHeaders } from '../../../core/config.js';

export async function pollBatchPublishStatus(
  client: Client,
  jobId: string,
  signal: AbortSignal,
): Promise<PublishFederatedSubgraphsResponse> {
  let attempt = 0;
  const headers = getBaseHeaders();
  while (!signal.aborted) {
    const resp = await client.platform.getBatchPublishJobStatus({ jobId }, { headers, signal });
    if (resp.response?.code !== EnumStatusCode.OK) {
      return create(PublishFederatedSubgraphsResponseSchema, {
        response: resp.response,
      });
    }

    switch (resp.status) {
      case BatchPublishJobStatus.PENDING:
      case BatchPublishJobStatus.PROCESSING: {
        await sleep(computeDelay(1000, 5000, attempt++, true), signal);
        break;
      }
      case BatchPublishJobStatus.FAILED: {
        return create(PublishFederatedSubgraphsResponseSchema, {
          response: {
            code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            details: resp.failureReason,
          },
        });
      }
      case BatchPublishJobStatus.COMPLETED: {
        return create(PublishFederatedSubgraphsResponseSchema, {
          response: { code: EnumStatusCode.OK },
          compositionErrors: resp.compositionErrors,
          deploymentErrors: resp.deploymentErrors,
          compositionWarnings: resp.compositionWarnings,
          counts: resp.counts,
          updatedSubgraphNames: resp.updatedSubgraphNames,
        });
      }
    }
  }

  /**
   * The only reason we should realistically get here is due to `signal` being aborted; however, we still need
   * to return a response object
   */
  return create(PublishFederatedSubgraphsResponseSchema, {
    response: {
      code: EnumStatusCode.ERR,
      details: signal.aborted ? 'Operation was cancelled by the user.' : undefined,
    },
  });
}

function computeDelay(base: number, max: number, attempt: number, jitter: boolean): number {
  const delay = Math.min(max, base * 2 ** attempt);
  return jitter ? delay * (0.5 + Math.random() * 0.5) : delay;
}

function sleep(ms: number, signal?: AbortSignal): Promise<'aborted' | 'ok'> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve('aborted');
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve('ok');
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      resolve('aborted');
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
