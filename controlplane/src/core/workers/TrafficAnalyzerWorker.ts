import PgBoss from 'pg-boss';

interface RegisterTrafficAnalyzerOptions {
  graphId: string;
}

interface TrafficAnalyzerJob {
  graphId: string;
  type: 'traffic/analyzer';
}

export default class TrafficAnalyzerWorker {
  constructor(private boss: PgBoss) {}

  /**
   * Register a new graph to be analyzed. This method is idempotent.
   * @param opts
   */
  public async register(opts: RegisterTrafficAnalyzerOptions): Promise<void> {
    const queue = `traffic/analyzer/graph/${opts.graphId}`;
    // Create a cron job that runs every 5 minute.
    await this.boss.schedule(queue, '*/5 * * * *', { type: 'traffic', graphId: opts.graphId });
  }

  /**
   * Subscribe to the traffic analyzer queue with a max concurrency of 100
   * and a team size of 10.sc
   */
  public async subscribe(): Promise<void> {
    await this.boss.work<TrafficAnalyzerJob>(
      `traffic/analyzer/graph/*`,
      { teamSize: 10, teamConcurrency: 100 },
      (job) => this.handler(job),
    );
  }

  /**
   * Handle a traffic analyzer job.
   * @param event
   */
  public async handler(event: PgBoss.Job<TrafficAnalyzerJob>): Promise<void> {
    // TODO: Implement me!
    console.log(event);
  }
}
