import { WorkerOptions, Job, Worker } from 'bullmq';
import pino from 'pino';

export abstract class BaseWorker<T> {
  protected readonly logger: pino.Logger;

  constructor(
    protected readonly name: string,
    protected readonly queueName: string,
    protected options: WorkerOptions,
    logger: pino.Logger,
  ) {
    this.logger = logger.child({ worker: name });
  }

  public create(): Worker<T, any, string> {
    const worker = new Worker<T>(this.queueName, (job) => this.handler(job), this.options);

    worker.on('stalled', (jobId) => {
      this.logger.warn({ jobId }, `Job stalled [Worker: ${this.name}]`);
    });

    worker.on('error', (err) => {
      this.logger.error(err, `error [Worker: ${this.name}]`);
    });

    return worker;
  }

  protected abstract handler(job: Job<T>): Promise<void>;
}
