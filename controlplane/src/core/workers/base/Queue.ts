import { ConnectionOptions, Job, JobsOptions, Queue } from 'bullmq';
import pino from 'pino';

const defaultJobOptions: JobsOptions = {
  removeOnComplete: {
    age: 90 * 86_400,
  },
  removeOnFail: {
    age: 90 * 86_400,
  },
  attempts: 6,
  backoff: {
    type: 'exponential',
    delay: 112_000,
  },
};

export type BaseQueueParams = {
  name: string;
  conn: ConnectionOptions;
  log: pino.Logger;
  jobsOptions?: JobsOptions;
};

export abstract class BaseQueue<T> {
  protected readonly queue: Queue<T>;
  protected readonly logger: pino.Logger;

  constructor({ name, conn, log, jobsOptions = defaultJobOptions }: BaseQueueParams) {
    this.logger = log.child({ queue: name });
    this.queue = new Queue<T>(name, {
      connection: conn,
      defaultJobOptions: jobsOptions,
    });

    this.queue.on('error', (err) => {
      this.logger.error(err, `error [Queue: ${name}]`);
    });
  }

  public abstract addJob(job: T, opts?: Omit<JobsOptions, 'jobId'>): Promise<Job<T, any, string> | undefined>;

  public abstract removeJob(job: T): Promise<number>;

  public abstract getJob(job: T): Promise<Job<T, any, string> | undefined>;
}
