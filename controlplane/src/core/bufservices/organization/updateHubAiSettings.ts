import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  HubAgentAllowance,
  HubAiSettings,
  UpdateHubAiSettingsRequest,
  UpdateHubAiSettingsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { HubAiSettingsRepository } from '../../repositories/HubAiSettingsRepository.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { sendGovernanceUpdated } from '../../webhooks/governanceWebhook.js';
import { fetchHubAiModels } from '../../hub/hubAiModels.js';
import type { HubAgentAllowanceDTO, HubAiSettingsDTO, PlainMessage } from '../../../types/index.js';

const MODEL_TARGETS = new Set([
  'schema-change',
  'connect-api',
  'implement-subgraph',
  'router-upgrade',
  'fix-checks',
  'ask-ai',
]);

function normalizeEntries(entries: string[]): string[] {
  const normalized = entries.map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0);
  return [...new Set(normalized)].sort();
}

function normalizeAllowance(allowance: HubAgentAllowance | undefined): HubAgentAllowanceDTO {
  return {
    restricted: allowance?.restricted ?? false,
    entries: allowance?.restricted ? normalizeEntries(allowance.entries) : [],
  };
}

// Trims models, keeps one override per target (the last), and refuses unknown targets and negative caps.
function normalizeSettings(settings: HubAiSettings): HubAiSettingsDTO | string {
  const overrides = new Map<string, string>();
  for (const override of settings.modelOverrides) {
    if (!MODEL_TARGETS.has(override.target)) {
      return `Unknown model target "${override.target}"`;
    }
    const model = override.model.trim();
    if (model.length > 0) {
      overrides.set(override.target, model);
    }
  }

  const caps = [settings.monthlyCapUsd, settings.memberMonthlyCapUsd];
  if (caps.some((cap) => cap !== undefined && cap < 0)) {
    return 'Spending caps cannot be negative';
  }

  return {
    agentsDisabled: settings.agentsDisabled,
    defaultModel: settings.defaultModel.trim(),
    modelOverrides: [...overrides].map(([target, model]) => ({ target, model })),
    monthlyCapUsd: settings.monthlyCapUsd,
    memberMonthlyCapUsd: settings.memberMonthlyCapUsd,
    repositories: normalizeAllowance(settings.repositories),
    hosts: normalizeAllowance(settings.hosts),
    agentHiddenTags: normalizeEntries(settings.agentHiddenTags),
  };
}

// The first model the settings name that Hub does not offer; Hub is only asked when the settings name one.
async function firstUnavailableModel(
  hubApiUrl: string | undefined,
  settings: HubAiSettingsDTO,
): Promise<string | undefined> {
  const named = [settings.defaultModel, ...settings.modelOverrides.map(({ model }) => model)].filter(
    (model) => model !== '',
  );
  if (!hubApiUrl || named.length === 0) {
    return undefined;
  }

  const { models } = await fetchHubAiModels(hubApiUrl);
  const offered = new Set(models.map(({ gatewayModelId }) => gatewayModelId));
  return named.find((model) => !offered.has(model));
}

export function updateHubAiSettings(
  opts: RouterOptions,
  req: UpdateHubAiSettingsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateHubAiSettingsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateHubAiSettingsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const repo = new HubAiSettingsRepository(opts.db);

    if (req.settings) {
      const settings = normalizeSettings(req.settings);
      if (typeof settings === 'string') {
        return {
          response: {
            code: EnumStatusCode.ERR_BAD_REQUEST,
            details: settings,
          },
        };
      }
      const unavailable = await firstUnavailableModel(opts.hubApiUrl, settings);
      if (unavailable) {
        return {
          response: {
            code: EnumStatusCode.ERR_BAD_REQUEST,
            details: `Hub does not offer the model "${unavailable}"; pick one from its list`,
          },
        };
      }
      await repo.set(authContext.organizationId, settings);
    } else {
      await repo.remove(authContext.organizationId);
    }

    await new AuditLogRepository(opts.db).addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'organization.hub_ai_settings_updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableDisplayName: authContext.organizationSlug,
      auditableType: 'organization',
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    sendGovernanceUpdated(opts, {
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      actorId: authContext.userId,
      reason: 'hub_ai_settings',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
