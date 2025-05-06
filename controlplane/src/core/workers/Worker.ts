import { Job, JobsOptions } from 'bullmq';

export interface IQueue<T> {
  addJob(job: T, opts?: Omit<JobsOptions, 'jobId'>): Promise<Job<T, any, string> | undefined>;
  removeJob(job: T): Promise<number>;
  getJob(job: T): Promise<Job<T, any, string> | undefined>;
}

export interface IWorker {
  handler(job: Job<any>): Promise<void>;
}
