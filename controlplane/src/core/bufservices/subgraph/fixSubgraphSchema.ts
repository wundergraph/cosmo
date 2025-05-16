import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CompositionError,
  FixSubgraphSchemaRequest,
  FixSubgraphSchemaResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Composer } from '../../composition/composer.js';
import { buildSchema } from '../../composition/composition.js';
import { OpenAIGraphql } from '../../openai-graphql/index.js';
import { ContractRepository } from '../../repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GraphCompositionRepository } from '../../repositories/GraphCompositionRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getFederatedGraphRouterCompatibilityVersion, getLogger, handleError } from '../../util.js';

export function fixSubgraphSchema(
  opts: RouterOptions,
  req: FixSubgraphSchemaRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<FixSubgraphSchemaResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<FixSubgraphSchemaResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const contractRepo = new ContractRepository(logger, opts.db, authContext.organizationId);
    const graphCompostionRepo = new GraphCompositionRepository(logger, opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    const composer = new Composer(
      logger,
      opts.db,
      fedGraphRepo,
      subgraphRepo,
      contractRepo,
      graphCompostionRepo,
      opts.chClient,
    );

    req.namespace = req.namespace || DefaultNamespace;

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace "${req.namespace}" not found.`,
        },
        modified: false,
        schema: '',
      };
    }

    const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);
    if (!subgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Subgraph '${req.subgraphName}' not found`,
        },
        modified: false,
        schema: '',
      };
    }

    // check whether the user is authorized to perform the action
    await opts.authorizer.authorize({
      db: opts.db,
      graph: {
        targetId: subgraph.targetId,
        targetType: 'subgraph',
      },
      headers: ctx.requestHeader,
      authContext,
    });

    // Avoid calling OpenAI API if the schema is too big
    if (req.schema.length > 10_000) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The schema is too big to be fixed automatically`,
        },
        modified: false,
        schema: '',
      };
    }

    if (!opts.openaiApiKey) {
      return {
        response: {
          code: EnumStatusCode.ERR_OPENAI_DISABLED,
          details: `Env var 'OPENAI_API_KEY' must be set to use this feature`,
        },
        modified: false,
        schema: '',
      };
    }

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const feature = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'ai',
    });

    if (!feature?.enabled) {
      return {
        response: {
          code: EnumStatusCode.ERR_OPENAI_DISABLED,
          details: `The organization must enable the AI feature to use this feature`,
        },
        modified: false,
        schema: '',
      };
    }

    const newSchemaSDL = req.schema;

    try {
      const federatedGraphs = await fedGraphRepo.bySubgraphLabels({
        labels: subgraph.labels,
        namespaceId: namespace.id,
      });
      // Here we check if the schema is valid as a subgraph
      const result = buildSchema(
        newSchemaSDL,
        true,
        /*
         * If there are any federated graphs for which the subgraph is a constituent, the subgraph will be validated
         * against the first router compatibility version encountered.
         * If no federated graphs have yet been created, the subgraph will be validated against the latest router
         * compatibility version.
         */
        getFederatedGraphRouterCompatibilityVersion(federatedGraphs),
      );
      if (!result.success) {
        return {
          response: {
            code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
            details: result.errors.map((e) => e.toString()).join('\n'),
          },
          modified: false,
          schema: '',
        };
      }
    } catch (e: any) {
      return {
        response: {
          code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
          details: e.message,
        },
        modified: false,
        schema: '',
      };
    }

    const result = await composer.composeWithProposedSDL(
      subgraph.labels,
      subgraph.name,
      subgraph.namespaceId,
      newSchemaSDL,
    );

    const compositionErrors: PlainMessage<CompositionError>[] = [];
    for (const composition of result.compositions) {
      if (composition.errors.length > 0) {
        for (const error of composition.errors) {
          compositionErrors.push({
            message: error.message,
            federatedGraphName: composition.name,
            namespace: composition.namespace,
            featureFlag: '',
          });
        }
      }
    }

    if (compositionErrors.length === 0) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        modified: false,
        schema: '',
      };
    }

    const checkResult = compositionErrors
      .filter((e) => e.federatedGraphName !== req.subgraphName)
      .map((e) => e.message)
      .join('\n\n');

    const ai = new OpenAIGraphql({
      openAiApiKey: opts.openaiApiKey,
    });

    const fixResult = await ai.fixSDL({
      sdl: newSchemaSDL,
      checkResult,
    });

    if (fixResult.sdl === newSchemaSDL) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        modified: false,
        schema: '',
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      modified: true,
      schema: fixResult.sdl,
    };
  });
}
