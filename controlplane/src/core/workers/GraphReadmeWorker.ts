import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ConnectionOptions, Job, Worker, Queue } from 'bullmq';
import pino from 'pino';
import * as schema from '../../db/schema.js';
import { OpenAIGraphql } from '../openai-graphql/index.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';

export const QueueName = 'graph-readme';

export interface CreateReadmeInputEvent {
  targetId: string;
  organizationId: string;
  type: 'subgraph' | 'federated_graph';
}

export const createDispatcher = (conn: ConnectionOptions) => {
  const readmeQueue = new Queue<CreateReadmeInputEvent>(QueueName, {
    connection: conn,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: true,
    },
  });
  return readmeQueue;
};

export const GraphReadmeWorker = (input: {
  redisConnection: ConnectionOptions;
  db: PostgresJsDatabase<typeof schema>;
  log: pino.Logger;
  openAiApiKey: string;
}) => {
  const oaig = new OpenAIGraphql({
    openAiApiKey: input.openAiApiKey,
  });

  const handler = async (job: Job<CreateReadmeInputEvent>) => {
    if (job.data.type === 'subgraph') {
      const subgraphRepo = new SubgraphRepository(input.db, job.data.organizationId);
      const subgraph = await subgraphRepo.byTargetId(job.data.targetId);
      if (!subgraph) {
        throw new Error(`Subgraph with target id ${job.data.targetId} not found`);
      }

      const resp = await oaig.generateReadme({
        sdl: subgraph.schemaSDL,
        graphName: subgraph.name,
      });

      await subgraphRepo.updateReadme({
        targetId: subgraph.targetId,
        readme: resp.readme,
      });
    } else if (job.data.type === 'federated_graph') {
      const fedGraphRepo = new FederatedGraphRepository(input.db, job.data.organizationId);
      const graph = await fedGraphRepo.byTargetId(job.data.targetId);
      if (!graph) {
        throw new Error(`Federated Graph with target id ${job.data.targetId} not found`);
      }
      const schema = await fedGraphRepo.getLatestValidSchemaVersion({
        targetId: job.data.targetId,
      });
      if (!schema?.schema) {
        return;
      }
      const resp = await oaig.generateReadme({
        sdl: schema?.schema,
        graphName: graph.name,
      });
      await fedGraphRepo.updateReadme({
        targetId: graph.targetId,
        readme: resp.readme,
      });
    }
  };

  return new Worker<CreateReadmeInputEvent>(QueueName, handler, {
    connection: input.redisConnection,
    concurrency: 10,
  });
};
