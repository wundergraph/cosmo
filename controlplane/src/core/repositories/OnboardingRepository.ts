import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../db/schema.js';
import { users } from '../../db/schema.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';

export class OnboardingRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  public async getOnboarding({ userId, organizationId }: { userId: string; organizationId?: string }) {
    const onboarding = await this.db.query.onboarding.findFirst({
      where: eq(users.id, userId),
    });

    return {
      ...onboarding,
      hasDemoFederatedGraph: await this.hasDemoFederatedGraph(organizationId),
    };
  }

  private async hasDemoFederatedGraph(organizationId?: string) {
    if (!organizationId) {
      return false;
    }

    const fedGraphRepo = new FederatedGraphRepository(this.logger, this.db, organizationId);
    return await fedGraphRepo.hasDemoFederatedGraph();
  }
}
