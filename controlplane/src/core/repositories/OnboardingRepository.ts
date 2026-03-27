import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../db/schema.js';
import { onboarding } from '../../db/schema.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';

export class OnboardingRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  public async getOnboarding({ userId, organizationId }: { userId: string; organizationId?: string }) {
    const onboardingRecord = await this.db.query.onboarding.findFirst({
      where: and(
        eq(onboarding.userId, userId),
        organizationId ? eq(onboarding.organizationId, organizationId) : undefined,
      ),
    });

    return {
      ...onboardingRecord,
      nonDemoFederatedGraphsCount: await this.getNonDemoFederatedGraphCount(
        organizationId,
        onboardingRecord?.federatedGraphId,
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
