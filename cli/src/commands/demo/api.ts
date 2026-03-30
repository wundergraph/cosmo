import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type { BaseCommandOptions } from '../../core/types/types.js';
import { getBaseHeaders } from '../../core/config.js';

/**
 * Retrieve user information [email] and [organization name]
 */
export async function fetchUserInfo(client: BaseCommandOptions['client']) {
  try {
    const response = await client.platform.whoAmI(
      {},
      {
        headers: getBaseHeaders(),
      },
    );

    switch (response.response?.code) {
      case EnumStatusCode.OK: {
        return {
          userInfo: response,
          error: null,
        };
      }
      default: {
        return {
          userInfo: null,
          error: new Error(response.response?.details ?? 'An unknown error occurred.'),
        };
      }
    }
  } catch (err) {
    return {
      userInfo: null,
      error: err instanceof Error ? err : new Error('An unknown error occurred.'),
    };
  }
}

/**
 * Retrieve onboarding record. Provides information about allowed [status]:
 * [error] | [not-allowed] | [ok]
 * If record exists, returns [onboarding] metadata.
 */
export async function checkExistingOnboarding(client: BaseCommandOptions['client']) {
  const { response, finishedAt, enabled } = await client.platform.getOnboarding(
    {},
    {
      headers: getBaseHeaders(),
    },
  );

  if (response?.code !== EnumStatusCode.OK) {
    return {
      error: new Error(response?.details ?? 'Failed to fetch onboarding metadata.'),
      status: 'error',
    } as const;
  }

  if (!enabled) {
    return {
      status: 'not-allowed',
    } as const;
  }

  return {
    onboarding: {
      finishedAt,
    },
    status: 'ok',
  } as const;
}
