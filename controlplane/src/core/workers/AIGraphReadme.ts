import { ConnectionOptions, Job } from 'bullmq';
import pino from 'pino';
import { OpenAIGraphql } from '../openai-graphql/index.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { DB } from '../../db/index.js';
import { BaseQueue, BaseWorker } from './base/index.js';

const QueueName = 'ai.graph-readme-generator';
const WorkerName = 'AIGraphReadmeWorker';

export interface CreateReadmeInputEvent {
  targetId: string;
  organizationId: string;
  type: 'subgraph' | 'federated_graph';
}

export class AIGraphReadmeQueue extends BaseQueue<CreateReadmeInputEvent> {
  constructor(log: pino.Logger, conn: ConnectionOptions) {
    super({
      name: QueueName,
      conn,
      log,
      jobsOptions: {
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 10_000,
        },
      },
    });
  }

  public addJob(job: CreateReadmeInputEvent) {
    return this.queue.add(`targets/${job.targetId}`, job, {
      removeOnComplete: {
        age: 3600, // keep up to 1 hour
        count: 100, // keep up to 100 jobs
      },
      removeOnFail: {
        age: 24 * 3600, // keep up to 24 hours
      },
    });
  }

  public removeJob(job: CreateReadmeInputEvent) {
    return this.queue.remove(job.targetId);
  }

  public getJob(job: CreateReadmeInputEvent) {
    return this.queue.getJob(job.targetId);
  }
}

export class AIGraphReadmeWorker extends BaseWorker<CreateReadmeInputEvent> {
  private readonly openaiGraphql: OpenAIGraphql;

  constructor(
    private input: {
      redisConnection: ConnectionOptions;
      db: DB;
      logger: pino.Logger;
      openAiApiKey: string;
    },
  ) {
    super(WorkerName, QueueName, { connection: input.redisConnection, concurrency: 10 }, input.logger);

    this.openaiGraphql = new OpenAIGraphql({
      openAiApiKey: input.openAiApiKey,
    });
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

  protected async handler(job: Job<CreateReadmeInputEvent>) {
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
