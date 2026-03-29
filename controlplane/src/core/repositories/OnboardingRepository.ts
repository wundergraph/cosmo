import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../db/schema.js';
import { onboarding } from '../../db/schema.js';
import { OnboardingDTO } from '../../types/index.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';

export class OnboardingRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  public async getOnboarding({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId?: string;
  }): Promise<OnboardingDTO | undefined> {
    const record = await this.db.query.onboarding.findFirst({
      where: and(
        eq(onboarding.userId, userId),
        organizationId ? eq(onboarding.organizationId, organizationId) : undefined,
      ),
    });

    return this.createOnboardingDTO(record);
  }

  public async createOnboarding({
    userId,
    organizationId,
    slack,
    email,
  }: {
    userId: string;
    organizationId: string;
    slack: boolean;
    email: boolean;
  }): Promise<OnboardingDTO | undefined> {
    const [record] = await this.db
      .insert(onboarding)
      .values({
        userId,
        organizationId,
        slack,
        email,
        step: 1,
        version: 'v1',
        updatedAt: new Date(),
      })
      .returning()
      .execute();

    return this.createOnboardingDTO(record);
  }

  private async createOnboardingDTO(record?: typeof onboarding.$inferSelect): Promise<OnboardingDTO | undefined> {
    if (!record) {
      return undefined;
    }

    return {
      ...record,
      nonDemoFederatedGraphsCount: await this.getNonDemoFederatedGraphCount(
        record.organizationId,
        record.federatedGraphId,
      ),
    };
  }

  private async getNonDemoFederatedGraphCount(organizationId?: string, demoFederatedGraphId?: string | null) {
    if (!organizationId) {
      return 0;
    }

    const fedGraphRepo = new FederatedGraphRepository(this.logger, this.db, organizationId);
    const count = await fedGraphRepo.count();

    if (!demoFederatedGraphId) {
      return count;
    }

    return Math.max(count - 1, 0);
  }
}
