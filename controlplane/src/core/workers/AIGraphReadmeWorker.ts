import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ConnectionOptions, Job, Worker, Queue } from 'bullmq';
import pino from 'pino';
import * as schema from '../../db/schema.js';
import { OpenAIGraphql } from '../openai-graphql/index.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { FastifyBaseLogger } from 'fastify';

const QueueName = 'ai.graph-readme-generator';
const WorkerName = 'AIGraphReadmeWorker';

export interface CreateReadmeInputEvent {
  targetId: string;
  organizationId: string;
  type: 'subgraph' | 'federated_graph';
}

export class AIGraphReadmeQueue {
  private readonly queue: Queue<CreateReadmeInputEvent>;
  private readonly logger: pino.Logger;

  constructor(log: pino.Logger, conn: ConnectionOptions) {
    this.logger = log.child({ queue: QueueName });
    this.queue = new Queue<CreateReadmeInputEvent>(QueueName, {
      connection: conn,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 10_000,
        },
      },
    });

    this.queue.on('error', (err) => {
      this.logger.error(err, 'Queue error');
    });
  }

  public async addJob(job: CreateReadmeInputEvent) {
    await this.queue.add(`targets/${job.targetId}`, job);
  }
}

class AIGraphReadmeWorker {
  private readonly openaiGraphql: OpenAIGraphql;

  constructor(
    private input: {
      redisConnection: ConnectionOptions;
      db: PostgresJsDatabase<typeof schema>;
      logger: pino.Logger;
      openAiApiKey: string;
    },
  ) {
    this.openaiGraphql = new OpenAIGraphql({
      openAiApiKey: input.openAiApiKey,
    });
    this.input.logger = input.logger.child({ worker: WorkerName });
  }

  private async generateSubgraphReadme(job: Job<CreateReadmeInputEvent>) {
    const subgraphRepo = new SubgraphRepository(this.input.logger, this.input.db, job.data.organizationId);
    const subgraph = await subgraphRepo.byTargetId(job.data.targetId);
    if (!subgraph) {
      throw new Error(`Subgraph with target id ${job.data.targetId} not found`);
    }

    const resp = await this.openaiGraphql.generateReadme({
      sdl: subgraph.schemaSDL,
      graphName: subgraph.name,
    });

    await subgraphRepo.updateReadme({
      targetId: subgraph.targetId,
      readme: resp.readme,
    });
  }

  private async generateFederatedGraphReadme(job: Job<CreateReadmeInputEvent>) {
    const fedGraphRepo = new FederatedGraphRepository(this.input.logger, this.input.db, job.data.organizationId);
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

    const resp = await this.openaiGraphql.generateReadme({
      sdl: schema?.schema,
      graphName: graph.name,
    });

    await fedGraphRepo.updateReadme({
      targetId: graph.targetId,
      readme: resp.readme,
    });
  }

  public async handler(job: Job<CreateReadmeInputEvent>) {
    try {
      if (job.data.type === 'subgraph') {
        await this.generateSubgraphReadme(job);
      } else if (job.data.type === 'federated_graph') {
        await this.generateFederatedGraphReadme(job);
      } else {
        throw new Error(`Unknown job type ${job.data.type}`);
      }
    } catch (err) {
      this.input.logger.error(
        err,
        `Failed to generate readme for type: ${job.data.type} targetId: ${job.data.targetId}`,
      );
      throw err;
    }
  }
}

export const createAIGraphReadmeWorker = (input: {
  redisConnection: ConnectionOptions;
  db: PostgresJsDatabase<typeof schema>;
  logger: pino.Logger;
  openAiApiKey: string;
}) => {
  const log = input.logger.child({ worker: WorkerName });
  const worker = new Worker<CreateReadmeInputEvent>(QueueName, (job) => new AIGraphReadmeWorker(input).handler(job), {
    connection: input.redisConnection,
    concurrency: 10,
  });
  worker.on('stalled', (job) => {
    log.warn(`Job ${job} stalled`);
  });
  worker.on('error', (err) => {
    input.logger.error(err, 'Worker error');
  });
  return worker;
};
